import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const tasks = await prisma.task.findMany({
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    title: string;
    owner?: string;
    status?:
      | "NOT_STARTED"
      | "IN_PROGRESS"
      | "WAITING"
      | "BLOCKED"
      | "DONE";
    dueAt?: string;
    etaAt?: string;
    blocker?: string;
    notes?: string;
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const task = await prisma.task.create({
    data: {
      title: body.title.trim(),
      owner: body.owner?.trim() || null,
      status: body.status ?? "NOT_STARTED",
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      etaAt: body.etaAt ? new Date(body.etaAt) : null,
      blocker: body.blocker?.trim() || null,
      notes: body.notes?.trim() || null,
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
