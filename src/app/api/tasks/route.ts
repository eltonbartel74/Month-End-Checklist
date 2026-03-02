import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const tasks = await prisma.task.findMany({
    orderBy: [{ createdAt: "asc" }],
  });

  const freqRank = (f?: string | null) => {
    const x = (f ?? "").toLowerCase();
    if (x === "daily") return 1;
    if (x === "weekly") return 2;
    if (x === "monthly") return 3;
    return 9;
  };

  tasks.sort((a, b) => {
    const r = freqRank(a.frequency) - freqRank(b.frequency);
    if (r !== 0) return r;
    const na = a.nextDueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const nb = b.nextDueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (na !== nb) return na - nb;
    return a.title.localeCompare(b.title);
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
    frequency?: string;
    estHoursPm?: string;
    dependency?: string;
    repeatEnabled?: boolean;
    dailyTime?: string;
    weeklyDays?: number[];
    monthlyDay?: number;
    nextDueAt?: string;
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
      frequency: body.frequency?.trim() || null,
      estHoursPm: body.estHoursPm?.trim() || null,
      dependency: body.dependency?.trim() || null,

      repeatEnabled: body.repeatEnabled ?? false,
      dailyTime: body.dailyTime?.trim() || null,
      weeklyDays:
        body.weeklyDays?.filter((x) => Number.isFinite(x))?.map((x) => Number(x)) ??
        [],
      monthlyDay: body.monthlyDay ?? null,
      nextDueAt: body.nextDueAt ? new Date(body.nextDueAt) : null,

      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      etaAt: body.etaAt ? new Date(body.etaAt) : null,
      blocker: body.blocker?.trim() || null,
      notes: body.notes?.trim() || null,
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
