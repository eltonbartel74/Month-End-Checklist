import { prisma } from "@/lib/db";
import { nextMonthly } from "@/lib/schedule";
import { NextResponse } from "next/server";

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

  return NextResponse.json({ ok: true, rolled, nextPeriod });
}
