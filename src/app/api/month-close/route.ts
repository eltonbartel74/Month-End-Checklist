import { prisma } from "@/lib/db";
import { nextMonthly } from "@/lib/schedule";
import { NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/auth";
import { promisedDateForTask } from "@/lib/dueDate";

function parsePeriod(period: string) {
  const m = /^([0-9]{4})-([0-9]{2})$/.exec(period.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function fmtPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
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

  // Month close is a manager/admin action
  if (user.role !== "MANAGER") {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { period?: string };
  const period = body.period?.trim();
  if (!period) {
    return NextResponse.json({ error: "period is required (YYYY-MM)" }, { status: 400 });
  }

  const p = parsePeriod(period);
  if (!p) {
    return NextResponse.json({ error: "Invalid period. Use YYYY-MM" }, { status: 400 });
  }

  // Monthly tasks = frequency Monthly. We block until all are DONE.
  const remaining = await prisma.task.count({
    where: {
      frequency: { equals: "Monthly", mode: "insensitive" },
      status: { not: "DONE" },
    },
  });

  if (remaining > 0) {
    return NextResponse.json(
      { error: `Can’t close ${period}: ${remaining} monthly task(s) not done.` },
      { status: 409 }
    );
  }

  // Roll monthly repeating tasks forward to next period.
  const { year, month } = p;
  const from = new Date(Date.UTC(year, month, 0, 12, 0, 0)); // last day of period @ midday UTC

  const tasks = await prisma.task.findMany({
    where: {
      frequency: { equals: "Monthly", mode: "insensitive" },
      repeatEnabled: true,
      monthlyDay: { not: null },
    },
    select: { id: true, monthlyDay: true, dailyTime: true },
  });

  const nextPeriod = month === 12 ? fmtPeriod(year + 1, 1) : fmtPeriod(year, month + 1);

  let rolled = 0;
  for (const t of tasks) {
    const nd = nextMonthly(from, t.monthlyDay!, t.dailyTime);
    if (!nd) continue;

    await prisma.task.update({
      where: { id: t.id },
      data: {
        period: nextPeriod,
        nextDueAt: nd,
        status: "NOT_STARTED",
      },
    });
    rolled++;
  }

  // Create KPI snapshots for the closed period.
  // Daily/Weekly tasks are included only if their promised date falls within the closed period month.
  const tasksForSnapshot = await prisma.task.findMany({});

  const periodYear = p.year;
  const periodMonth = p.month;

  const inPeriodMonth = (d: Date) =>
    d.getUTCFullYear() === periodYear && d.getUTCMonth() + 1 === periodMonth;

  // Group tasks by owner
  const groups = new Map<string, typeof tasksForSnapshot>();
  for (const t of tasksForSnapshot) {
    const f = (t.frequency ?? "").toLowerCase();
    const owner = (t.owner ?? "Unassigned").trim() || "Unassigned";

    let include = false;

    if (f === "monthly" || f === "adhoc" || f === "ad hoc" || f === "ad-hoc") {
      include = (t.period ?? "").trim() === period;
    } else if (f === "daily" || f === "weekly") {
      const due = promisedDateForTask(t);
      include = Boolean(due && inPeriodMonth(due));
    } else {
      // Fallback: if period matches, include.
      include = (t.period ?? "").trim() === period;
    }

    if (!include) continue;

    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner)!.push(t);
  }

  const toNumberOrNull = (s: string | null | undefined) => {
    const x = Number(String(s ?? "").trim());
    return Number.isFinite(x) ? x : null;
  };

  const now = new Date();
  const snapshots = [] as Array<{ owner: string }>;

  for (const [owner, list] of groups.entries()) {
    const total = list.length;
    const notStarted = list.filter((t) => t.status === "NOT_STARTED").length;
    const inProgress = list.filter((t) => t.status === "IN_PROGRESS").length;
    const waiting = list.filter((t) => t.status === "WAITING").length;
    const blocked = list.filter((t) => t.status === "BLOCKED").length;

    const rework = list.filter(
      (t) => (t.frequency ?? "").toLowerCase() === "monthly" && t.approvalStatus === "CHANGES_REQUESTED"
    ).length;

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

    const dueToDate = list.filter((t) => {
      const due = promisedDateForTask(t);
      return Boolean(due && due.getTime() <= now.getTime());
    });
    const dueToDatePct =
      dueToDate.length === 0
        ? null
        : dueToDate.filter((t) => t.status === "DONE").length / dueToDate.length;

    const doneWithDue = list.filter((t) => Boolean(promisedDateForTask(t) && t.lastDoneAt));
    const onTimeCount = doneWithDue.filter((t) => {
      const due = promisedDateForTask(t);
      if (!due) return false;
      const dueDay = due.toISOString().slice(0, 10);
      const doneDay = new Date(t.lastDoneAt as Date).toISOString().slice(0, 10);
      return doneDay <= dueDay;
    }).length;
    const onTimePct = doneWithDue.length === 0 ? null : onTimeCount / doneWithDue.length;

    const daysLate = (d1: Date, d2: Date) =>
      Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

    const lateOpen = list
      .filter((t) => t.status !== "DONE")
      .map((t) => {
        const due = promisedDateForTask(t);
        if (!due) return null;
        const dl = daysLate(due, now);
        return dl > 0 ? dl : null;
      })
      .filter((x): x is number => typeof x === "number");

    const lateDone = list
      .filter((t) => t.status === "DONE" && t.lastDoneAt)
      .map((t) => {
        const due = promisedDateForTask(t);
        if (!due) return null;
        const dl = daysLate(due, new Date(t.lastDoneAt as Date));
        return dl > 0 ? dl : null;
      })
      .filter((x): x is number => typeof x === "number");

    const allLate = [...lateOpen, ...lateDone];
    const lateAvgDays = allLate.length ? allLate.reduce((a, b) => a + b, 0) / allLate.length : null;
    const lateMaxDays = allLate.length ? Math.max(...allLate) : null;

    await prisma.kpiSnapshot.create({
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

        metaJson: {
          createdBy: user.email ?? null,
          createdByRole: user.role ?? null,
          scope: "month-close",
        },
      },
    });

    snapshots.push({ owner });
  }

  await prisma.auditEvent.create({
    data: {
      action: "MONTH_CLOSE",
      period,
      actorEmail: user.email ?? null,
      actorRole: user.role ?? null,
      summary: `Month close ${period}: rolled ${rolled} monthly task(s); KPI snapshots ${snapshots.length} owner(s)`,
      metaJson: { rolled, nextPeriod, owners: snapshots.map((s) => s.owner) },
    },
  });

  return NextResponse.json({ ok: true, rolled, nextPeriod, snapshotsCreated: snapshots.length });
}
