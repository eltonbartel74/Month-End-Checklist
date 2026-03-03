import { prisma } from "@/lib/db";
import { nextDaily, nextWeekly } from "@/lib/schedule";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const errorId = `task_patch_${Date.now()}`;
  try {
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
    };

  const current = await prisma.task.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const statusRequested = body.status ?? current.status;
  const repeatEnabled =
    body.repeatEnabled === null
      ? null
      : body.repeatEnabled === undefined
        ? current.repeatEnabled
        : body.repeatEnabled;

  // Enforce working paper upload before completing.
  const transitionedToDone = current.status !== "DONE" && statusRequested === "DONE";
  if (transitionedToDone) {
    const attCount = await prisma.attachment.count({ where: { taskId: id } });
    if (attCount === 0) {
      return NextResponse.json(
        { error: "Upload a working paper (PDF/Excel) before marking Done." },
        { status: 409 }
      );
    }
  }

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

  const task = await prisma.task.update({
    where: { id },
    data: {
      title: body.title?.trim(),
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
            ? body.weeklyDays.map((x) => Number(x)).filter((x) => Number.isFinite(x))
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
    },
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
  const { id } = await params;
  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
