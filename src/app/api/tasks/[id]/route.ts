import { prisma } from "@/lib/db";
import { nextDaily, nextWeekly } from "@/lib/schedule";
import { NextResponse } from "next/server";
import { ownerMatchesUser, requireAuthedUser } from "@/lib/auth";
import { diffTaskFields } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import { isOverduePromisedDate } from "@/lib/dueDate";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const errorId = `task_patch_${Date.now()}`;
  try {
    let user;
    try {
      user = await requireAuthedUser();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "UNAUTHENTICATED";
      const status = msg === "NOT_ALLOWED" ? 403 : 401;
      return NextResponse.json({ error: "Not authorised" }, { status });
    }

    const { id } = await params;

    const body = (await req.json()) as {
      title?: string;
      owner?: string | null;
      status?:
        | "NOT_STARTED"
        | "IN_PROGRESS"
        | "WAITING"
        | "BLOCKED"
        | "DONE";
      frequency?: string | null;
      estHoursPm?: string | null;
      dependency?: string | null;

      repeatEnabled?: boolean | null;
      dailyTime?: string | null;
      weeklyDays?: number[] | null;
      monthlyDay?: number | null;
      nextDueAt?: string | null;

      dueAt?: string | null;
      etaAt?: string | null;
      blocker?: string | null;
      notes?: string | null;

      approvalStatus?: "NOT_SUBMITTED" | "SUBMITTED" | "CHANGES_REQUESTED" | "APPROVED" | null;
      reviewedBy?: string | null;
      reviewedAt?: string | null;
      reviewNotes?: string | null;
    };

  const current = await prisma.task.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only the task owner can change status
  if (body.status && body.status !== current.status) {
    if (!ownerMatchesUser(current.owner, user)) {
      return NextResponse.json(
        { error: "Only the task owner can change the status." },
        { status: 403 }
      );
    }

    // If promised date is overdue and ETA is blank, require ETA when changing status.
    const overdue = isOverduePromisedDate(current, new Date());
    const etaAfter =
      body.etaAt === undefined ? current.etaAt : body.etaAt ? new Date(body.etaAt) : null;

    if (overdue && body.status !== "DONE" && !etaAfter) {
      return NextResponse.json(
        { error: "ETA is required when the promised date is overdue." },
        { status: 400 }
      );
    }
  }

  // Manager-only controls for monthly review actions
  if (body.approvalStatus || body.reviewNotes !== undefined || body.reviewedAt || body.reviewedBy) {
    if (user.role !== "MANAGER") {
      return NextResponse.json({ error: "Not authorised" }, { status: 403 });
    }

    // Can't approve/rework your own tasks (based on owner mapping)
    if (ownerMatchesUser(current.owner, user)) {
      return NextResponse.json(
        { error: "Managers cannot approve/rework their own tasks." },
        { status: 403 }
      );
    }

    const freq = (current.frequency ?? "").toLowerCase();
    if (freq !== "monthly") {
      return NextResponse.json(
        { error: "Approval/rework is only used for monthly tasks." },
        { status: 400 }
      );
    }
  }

  const statusRequested = body.status ?? current.status;
  const repeatEnabled =
    body.repeatEnabled === null
      ? null
      : body.repeatEnabled === undefined
        ? current.repeatEnabled
        : body.repeatEnabled;

  const transitionedToDone = current.status !== "DONE" && statusRequested === "DONE";

  // If marking DONE on a repeating task, roll nextDueAt according to rules:
  // - Daily/Weekly: skip public holidays (no catch-up)
  // - Monthly: roll forward to next business day if holiday/weekend
  let rolledStatus: typeof statusRequested | undefined;
  let rolledNextDueAt: Date | null | undefined;
  let rolledLastDoneAt: Date | null | undefined;

  if (transitionedToDone) {
    rolledLastDoneAt = new Date();
  }

  if (statusRequested === "DONE" && repeatEnabled) {
    const from = new Date();
    const freq = (body.frequency ?? current.frequency ?? "").toLowerCase();
    const dailyTime =
      body.dailyTime === null
        ? null
        : body.dailyTime === undefined
          ? current.dailyTime
          : body.dailyTime;

    if (freq === "daily") {
      rolledNextDueAt = nextDaily(from, dailyTime);
      rolledStatus = "NOT_STARTED";
      rolledLastDoneAt = new Date();
    } else if (freq === "weekly") {
      const days =
        body.weeklyDays === null
          ? []
          : body.weeklyDays === undefined
            ? current.weeklyDays
            : body.weeklyDays;
      rolledNextDueAt = nextWeekly(from, days, dailyTime);
      rolledStatus = "NOT_STARTED";
      rolledLastDoneAt = new Date();
    } else if (freq === "monthly") {
      // Monthly tasks roll forward only when you click the Month Closed button.
      rolledLastDoneAt = new Date();
    }
  }

  const task = await prisma.$transaction(async (tx) => {
    const newTitle = body.title === undefined ? undefined : body.title.trim();
    const oldTitle = (current.title ?? "").trim();

    const updated = await tx.task.update({
      where: { id },
      data: {
        title: newTitle,
        owner: body.owner === null ? null : body.owner?.trim(),

        status: rolledStatus ?? body.status,

        frequency: body.frequency === null ? null : body.frequency?.trim(),
        estHoursPm: body.estHoursPm === null ? null : body.estHoursPm?.trim(),
        dependency: body.dependency === null ? null : body.dependency?.trim(),

        repeatEnabled: body.repeatEnabled === null ? undefined : body.repeatEnabled,
        dailyTime: body.dailyTime === null ? null : body.dailyTime?.trim(),
        weeklyDays:
          body.weeklyDays === null
            ? []
            : body.weeklyDays
              ? body.weeklyDays
                  .map((x) => Number(x))
                  .filter((x) => Number.isFinite(x))
              : undefined,
        monthlyDay: body.monthlyDay === null ? null : body.monthlyDay,

        nextDueAt:
          rolledNextDueAt ??
          (body.nextDueAt === null
            ? null
            : body.nextDueAt
              ? new Date(body.nextDueAt)
              : undefined),
        lastDoneAt: rolledLastDoneAt ?? undefined,

        dueAt:
          body.dueAt === null
            ? null
            : body.dueAt
              ? new Date(body.dueAt)
              : undefined,
        etaAt:
          body.etaAt === null
            ? null
            : body.etaAt
              ? new Date(body.etaAt)
              : undefined,
        blocker: body.blocker === null ? null : body.blocker?.trim(),
        notes: body.notes === null ? null : body.notes?.trim(),

        approvalStatus:
          body.approvalStatus === null
            ? undefined
            : body.approvalStatus
              ? body.approvalStatus
              : undefined,
        reviewedBy: body.reviewedBy === null ? null : body.reviewedBy?.trim(),
        reviewedAt:
          body.reviewedAt === null
            ? null
            : body.reviewedAt
              ? new Date(body.reviewedAt)
              : undefined,
        reviewNotes: body.reviewNotes === null ? null : body.reviewNotes?.trim(),
      },
    });

    // Audit log (diff-based)
    const fields = [
      "title",
      "owner",
      "status",
      "frequency",
      "estHoursPm",
      "dependency",
      "repeatEnabled",
      "dailyTime",
      "weeklyDays",
      "monthlyDay",
      "nextDueAt",
      "dueAt",
      "etaAt",
      "blocker",
      "notes",
      "approvalStatus",
      "reviewedBy",
      "reviewedAt",
      "reviewNotes",
      "lastDoneAt",
    ];

    const { before, after } = diffTaskFields(
      current as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      fields
    );
    const hasChanges = Object.keys(after).length > 0;

    if (hasChanges) {
      const statusChanged = (before as Record<string, unknown>).status !== undefined;
      const reviewChanged =
        (before as Record<string, unknown>).approvalStatus !== undefined ||
        (before as Record<string, unknown>).reviewNotes !== undefined ||
        (before as Record<string, unknown>).reviewedAt !== undefined ||
        (before as Record<string, unknown>).reviewedBy !== undefined;

      const action = reviewChanged
        ? "TASK_REVIEW_ACTION"
        : statusChanged
          ? "TASK_STATUS_CHANGE"
          : "TASK_UPDATE";

      await tx.auditEvent.create({
        data: {
          action,
          period: updated.period ?? null,
          taskId: updated.id,
          actorEmail: user.email ?? null,
          actorRole: user.role ?? null,
          summary: `${action}: ${updated.title}`,
          beforeJson: before as unknown as Prisma.InputJsonValue,
          afterJson: after as unknown as Prisma.InputJsonValue,
        },
      });
    }

    // If a task title changes, update dependency references that use titles.
    if (typeof newTitle === "string" && newTitle && oldTitle && newTitle !== oldTitle) {
      const candidates = await tx.task.findMany({
        where: {
          dependency: {
            contains: oldTitle,
            mode: "insensitive",
          },
        },
        select: { id: true, dependency: true },
      });

      const parseDeps = (raw: string | null) => {
        if (!raw) return [] as string[];
        const s = raw.trim();
        if (!s) return [] as string[];
        if (s.startsWith("[")) {
          try {
            const arr = JSON.parse(s);
            return Array.isArray(arr) ? arr.map(String) : [];
          } catch {
            return [];
          }
        }
        return [s];
      };

      const stringifyDeps = (deps: string[]) => {
        const clean = deps.map((d) => String(d).trim()).filter(Boolean);
        if (clean.length === 0) return null;
        if (clean.length === 1) return clean[0];
        return JSON.stringify(clean);
      };

      for (const c of candidates) {
        const deps = parseDeps(c.dependency);
        if (!deps.length) continue;
        const next = deps.map((d) => (d.trim() === oldTitle ? newTitle : d));
        const nextRaw = stringifyDeps(next);
        if ((nextRaw ?? null) === (c.dependency ?? null)) continue;
        await tx.task.update({
          where: { id: c.id },
          data: { dependency: nextRaw },
        });
      }
    }

    return updated;
  });

    return NextResponse.json({ task });
  } catch (err) {
    console.error("/api/tasks/[id] PATCH failed", { errorId, err });
    return NextResponse.json(
      {
        error:
          "Update failed (server error). This is usually a database connection issue — try again in 30 seconds.",
        errorId,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireAuthedUser();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "UNAUTHENTICATED";
    const status = msg === "NOT_ALLOWED" ? 403 : 401;
    return NextResponse.json({ error: "Not authorised" }, { status });
  }

  if (user.role !== "MANAGER") {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  const { id } = await params;
  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
