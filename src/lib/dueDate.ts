import type { Task } from "@prisma/client";
import { isBusinessDay } from "@/lib/schedule";

function addDaysUtc(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function startOfDayUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parsePeriod(period: string | null | undefined) {
  const s = (period ?? "").trim();
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export function firstBusinessDayOfNextMonthSa(period: string) {
  const p = parsePeriod(period);
  if (!p) return null;
  // period is the month being closed; milestone due is 1st business day of the following month.
  const d0 = new Date(Date.UTC(p.year, p.month, 1)); // next month 1st
  let d = d0;
  while (!isBusinessDay(d)) d = addDaysUtc(d, 1);
  return d;
}

export function monthlyDueForPeriodSa(period: string, dayOfMonth: number | null | undefined) {
  const dom = Number(dayOfMonth);
  if (!Number.isFinite(dom) || dom < 1 || dom > 31) return null;
  const p = parsePeriod(period);
  if (!p) return null;

  // Monthly tasks are generally due in the month AFTER the period month.
  const base = new Date(Date.UTC(p.year, p.month - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + 1);

  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();

  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let d = new Date(Date.UTC(y, m, Math.min(dom, lastDay)));
  while (!isBusinessDay(d)) d = addDaysUtc(d, 1);
  return d;
}

export function isBankRecsMilestoneTitle(title: string | null | undefined) {
  const t = (title ?? "").toLowerCase();
  return t.includes("bank") && t.includes("recon") && t.includes("(eom)");
}

/**
 * Server-side promised date for KPI/governance checks.
 * Mirrors the client `dueDateForKpi` rules.
 */
export function promisedDateForTask(t: Pick<Task, "frequency" | "monthlyDay" | "dueAt" | "nextDueAt" | "period" | "title">) {
  const period = (t.period ?? "").trim();
  const f = (t.frequency ?? "").toLowerCase();

  if (period && isBankRecsMilestoneTitle(t.title)) {
    return firstBusinessDayOfNextMonthSa(period);
  }

  if (period && f === "monthly") {
    return monthlyDueForPeriodSa(period, t.monthlyDay);
  }

  if (t.dueAt) return new Date(t.dueAt);
  if (t.nextDueAt) return new Date(t.nextDueAt);
  return null;
}

export function isOverduePromisedDate(t: Parameters<typeof promisedDateForTask>[0], now = new Date()) {
  const due = promisedDateForTask(t);
  if (!due) return false;
  return startOfDayUtc(due).getTime() < startOfDayUtc(now).getTime();
}
