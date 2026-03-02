import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    dueAt?: string | null;
    etaAt?: string | null;
    blocker?: string | null;
    notes?: string | null;
  };

  const task = await prisma.task.update({
    where: { id },
    data: {
      title: body.title?.trim(),
      owner: body.owner === null ? null : body.owner?.trim(),
      status: body.status,
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
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
