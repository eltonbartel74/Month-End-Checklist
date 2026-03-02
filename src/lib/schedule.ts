import Holidays from "date-holidays";

// Australia / South Australia
const hd = new Holidays("AU", "SA");

export function isSaPublicHoliday(d: Date) {
  return Boolean(hd.isHoliday(d));
}

export function isBusinessDay(d: Date) {
  const day = d.getDay(); // 0 Sun .. 6 Sat
  if (day === 0 || day === 6) return false;
  if (isSaPublicHoliday(d)) return false;
  return true;
}

function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUtc(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

// ISO day: 1=Mon .. 7=Sun
function isoDay(d: Date) {
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}

export function applyDailyTime(dateUtc: Date, dailyTime?: string | null) {
  if (!dailyTime) return dateUtc;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(dailyTime.trim());
  if (!m) return dateUtc;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const x = new Date(dateUtc);
  x.setUTCHours(hh, mm, 0, 0);
  return x;
}

// DAILY: next business day after `from` (skips weekends + SA PH). "Skip" behaviour is natural.
export function nextDaily(from: Date, dailyTime?: string | null) {
  const d0 = startOfDay(from);
  let d = addDaysUtc(d0, 1);
  while (!isBusinessDay(d)) d = addDaysUtc(d, 1);
  return applyDailyTime(d, dailyTime);
}

// WEEKLY: pick next date matching selected ISO weekdays, skipping holidays by moving to next selected weekday.
export function nextWeekly(from: Date, isoWeekdays: number[], dailyTime?: string | null) {
  const days = [...new Set(isoWeekdays)].filter((x) => x >= 1 && x <= 7).sort((a, b) => a - b);
  if (days.length === 0) return null;

  const d = startOfDay(from);
  for (let i = 1; i <= 21; i++) {
    const cand = addDaysUtc(d, i);
    if (!days.includes(isoDay(cand))) continue;
    if (!isBusinessDay(cand)) continue; // this is the "skip" rule
    return applyDailyTime(cand, dailyTime);
  }
  return null;
}

// MONTHLY: day-of-month, but if weekend/holiday then roll forward to next business day.
export function nextMonthly(from: Date, dayOfMonth: number, dailyTime?: string | null) {
  if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;

  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();

  function makeCandidate(year: number, month: number) {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const dom = Math.min(dayOfMonth, lastDay);
    let cand = new Date(Date.UTC(year, month, dom));
    while (!isBusinessDay(cand)) cand = addDaysUtc(cand, 1); // roll forward
    return applyDailyTime(cand, dailyTime);
  }

  const thisMonth = makeCandidate(y, m);
  if (thisMonth.getTime() > from.getTime()) return thisMonth;

  // next month
  return makeCandidate(y, m + 1);
}
