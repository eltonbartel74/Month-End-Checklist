import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/auth";
import type { Task } from "@prisma/client";

// Minimal KPI snapshot API (server-side) so we can trend month-on-month.
// POST creates a snapshot for a given period (all owners).
// GET lists snapshots.

function toNumberOrNull(s: string | null | undefined): number | null {
  const x = Number(String(s ?? "").trim());
  return Number.isFinite(x) ? x : null;
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuthedUser();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "UNAUTHENTICATED";
    const status = msg === "NOT_ALLOWED" ? 403 : 401;
    return NextResponse.json({ error: "Not authorised" }, { status });
  }

  // Manager-only by default (this is a reporting/admin action)
  if (user.role !== "MANAGER") {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { period?: string };
  const period = (body.period ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  }

  const tasks = await prisma.task.findMany({ where: { period } });

  // Group by owner
  const ownerKey = (t: Task) => (t.owner ?? "Unassigned").trim() || "Unassigned";
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = ownerKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }

  const now = new Date();

  const snapshots: Array<{ owner: string }> = [];

  for (const [owner, list] of groups.entries()) {
    const total = list.length;
    const notStarted = list.filter((t) => t.status === "NOT_STARTED").length;
    const inProgress = list.filter((t) => t.status === "IN_PROGRESS").length;
    const waiting = list.filter((t) => t.status === "WAITING").length;
    const blocked = list.filter((t) => t.status === "BLOCKED").length;

    const rework = list.filter(
      (t) => (t.frequency ?? "").toLowerCase() === "monthly" && t.approvalStatus === "CHANGES_REQUESTED"
    ).length;

    // Hours
    let budgetedHours: number | null = 0;
    let completedHours: number | null = 0;
    let missingHours = 0;
    for (const t of list) {
      const bh = toNumberOrNull(t.estHoursPm);
      if (bh === null) {
        missingHours++;
        continue;
      }
      budgetedHours! += bh;
      if (t.status === "DONE") completedHours! += bh;
    }

    const progressPct = budgetedHours && budgetedHours > 0 ? completedHours! / budgetedHours : null;

    // Timeliness / lateness is computed via promised date on the UI today.
    // For snapshots we approximate using dueAt/nextDueAt (monthlyDay is period-relative).
    // NOTE: To make this perfect, we should share the dueDateForKpi logic server-side.
    const promisedDate = (t: Task): Date | null => {
      if (t.dueAt) return new Date(t.dueAt);
      if (t.nextDueAt) return new Date(t.nextDueAt);
      return null;
    };

    const dueToDate = list.filter((t) => {
      const due = promisedDate(t);
      return Boolean(due && due.getTime() <= now.getTime());
    });
    const dueToDatePct = dueToDate.length === 0 ? null : dueToDate.filter((t) => t.status === "DONE").length / dueToDate.length;

    const doneWithDue = list.filter((t) => Boolean(promisedDate(t) && t.lastDoneAt));
    const onTimeCount = doneWithDue.filter((t) => {
      const due = promisedDate(t);
      if (!due) return false;
      const dueDay = due.toISOString().slice(0, 10);
      const doneDay = new Date(t.lastDoneAt as Date).toISOString().slice(0, 10);
      return doneDay <= dueDay;
    }).length;
    const onTimePct = doneWithDue.length === 0 ? null : onTimeCount / doneWithDue.length;

    // Lateness (open and done)
    const daysLate = (d1: Date, d2: Date) => Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

    const lateOpen = list
      .filter((t) => t.status !== "DONE")
      .map((t) => {
        const due = promisedDate(t);
        if (!due) return null;
        const dl = daysLate(due, now);
        return dl > 0 ? dl : null;
      })
      .filter((x) => typeof x === "number") as number[];

    const lateDone = list
      .filter((t) => t.status === "DONE" && t.lastDoneAt)
      .map((t) => {
        const due = promisedDate(t);
        if (!due) return null;
        const dl = daysLate(due, new Date(t.lastDoneAt as Date));
        return dl > 0 ? dl : null;
      })
      .filter((x) => typeof x === "number") as number[];

    const allLate = [...lateOpen, ...lateDone];
    const lateAvgDays = allLate.length ? allLate.reduce((a, b) => a + b, 0) / allLate.length : null;
    const lateMaxDays = allLate.length ? Math.max(...allLate) : null;

    const snap = await prisma.kpiSnapshot.create({
      data: {
        period,
        owner,
        snapshotAt: now,

        total,
        notStarted,
        inProgress,
        waiting,
        blocked,

        rework,
        dueToDatePct,
        onTimePct,

        budgetedHours,
        completedHours,
        progressPct,
        missingHours,

        lateOpenCount: lateOpen.length,
        lateDoneCount: lateDone.length,
        lateAvgDays,
        lateMaxDays: lateMaxDays === null ? null : Math.round(lateMaxDays),

        metaJson: { requestedBy: user.email ?? null },
      },
    });

    snapshots.push(snap);
  }

  // Audit entry
  await prisma.auditEvent.create({
    data: {
      action: "BULK_ADMIN",
      period,
      actorEmail: user.email ?? null,
      actorRole: user.role ?? null,
      summary: `KPI snapshot created for ${period} (${snapshots.length} owners)`,
      metaJson: { owners: snapshots.map((s) => s.owner) },
    },
  });

  return NextResponse.json({ period, snapshotsCreated: snapshots.length });
}

export async function GET(req: Request) {
  try {
    const user = await requireAuthedUser();
    if (user.role !== "MANAGER") {
      return NextResponse.json({ error: "Not authorised" }, { status: 403 });
    }

    const url = new URL(req.url);
    const period = url.searchParams.get("period");
    const owner = url.searchParams.get("owner");
    const take = Math.min(500, Math.max(1, Number(url.searchParams.get("take") ?? 200)));

    const snapshots = await prisma.kpiSnapshot.findMany({
      where: {
        ...(period ? { period } : {}),
        ...(owner ? { owner } : {}),
      },
      orderBy: [{ snapshotAt: "desc" }],
      take,
    });

    return NextResponse.json({ snapshots });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "UNAUTHENTICATED";
    const status = msg === "NOT_ALLOWED" ? 403 : 401;
    return NextResponse.json({ error: "Not authorised" }, { status });
  }
}
