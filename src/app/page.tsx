"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { addBusinessDaysUtc, businessDaysBetweenUtc, isBusinessDay, isSaPublicHoliday } from "@/lib/schedule";
import { supabaseBrowser } from "@/lib/supabase/client";
import { startIdleLogout } from "@/lib/idleLogout";
// (removed) SharePoint integration pending; no in-app working paper uploads for now

type TaskStatus = "NOT_STARTED" | "IN_PROGRESS" | "WAITING" | "BLOCKED" | "DONE";

type ApprovalStatus =
  | "NOT_SUBMITTED"
  | "SUBMITTED"
  | "CHANGES_REQUESTED"
  | "APPROVED";

type Task = {
  id: string;
  title: string;
  owner: string | null;
  status: TaskStatus;
  frequency: string | null;
  estHoursPm: string | null;
  dependency: string | null;

  repeatEnabled: boolean;
  dailyTime: string | null;
  weeklyDays: number[];
  monthlyDay: number | null;
  nextDueAt: string | null;
  lastDoneAt: string | null;

  dueAt: string | null;
  etaAt: string | null;
  blocker: string | null;
  notes: string | null;
  approvalStatus?: ApprovalStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;

  updatedAt: string;

  _count?: { attachments: number };
};

type Me = { email: string; role: "MANAGER" | "STAFF"; ownerNames: string[] };

export default function Home() {
  const sb = useMemo(() => supabaseBrowser(), []);

  const [me, setMe] = useState<Me | null>(null);
  const canEditPromisedDate = useMemo(() => {
    const email = (me?.email ?? "").trim().toLowerCase();
    return email === "elton.bartel@jamieson.com.au" || email === "kylie.deane@jamieson.com.au";
  }, [me]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [period, setPeriod] = useState("2026-02");

  // New task wizard
  type NewTaskType = "monthly" | "adhoc" | "weekly" | "daily";
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wType, setWType] = useState<NewTaskType>("monthly");
  const wizardDataRef = useRef({
    title: "",
    owner: "",
    hrs: "",
    dueDate: "", // DD/MM/YYYY (adhoc)
    monthlyDay: 7,
    weeklyDay: 1,
    time: "", // HH:MM
  });

  // Filters
  const [filterOwner, setFilterOwner] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterText, setFilterText] = useState<string>("");

  // Persisted UI prefs (filters + expand/collapse)
  const [ownerAccordionOpen, setOwnerAccordionOpen] = useState<boolean>(false);
  const [ownerAccordionExpanded, setOwnerAccordionExpanded] = useState<string[]>([]);

  // Bulk reassignment (visible tasks)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOwner, setBulkOwner] = useState("");
  const [closing, setClosing] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setLoadError(null);

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15_000);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      // Auto-retry transient server errors (e.g., DB cold start) a few times.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          setRetrying(true);
          // 600ms, 1200ms
          await sleep(600 * Math.pow(2, attempt - 1));
        }

        const res = await fetch("/api/tasks", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) {
          // Auth: redirect to login on 401/403
          if (res.status === 401 || res.status === 403) {
            if (typeof window !== "undefined") {
              const next = encodeURIComponent(window.location.pathname || "/");
              window.location.href = `/login?next=${next}`;
              return;
            }
          }

          const body = (await res.json().catch(() => null)) as
            | { error?: string; errorId?: string }
            | null;
          const msg = body?.error
            ? `${body.error}${body.errorId ? ` (id: ${body.errorId})` : ""}`
            : `API error ${res.status}`;

          // Retry only for 5xx
          if (res.status >= 500 && attempt < 2) {
            continue;
          }

          throw new Error(msg);
        }

        const data = (await res.json()) as { tasks: Task[] };
        setTasks(data.tasks);
        return;
      }
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === "AbortError"
            ? "Timed out loading tasks."
            : e.message
          : "Failed to load tasks.";
      setLoadError(msg);
    } finally {
      setRetrying(false);
      clearTimeout(t);
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    void refresh();

    // Restore persisted UI prefs (best-effort; may be reloaded once we know the user email)
    try {
      const raw = window.localStorage.getItem("monthend:prefs");
      if (raw) {
        const p = JSON.parse(raw) as {
          filterOwner?: string;
          filterStatus?: string;
          filterText?: string;
          ownerAccordionOpen?: boolean;
          ownerAccordionExpanded?: string[];
        };
        if (typeof p.filterOwner === "string") setFilterOwner(p.filterOwner);
        if (typeof p.filterStatus === "string") setFilterStatus(p.filterStatus);
        if (typeof p.filterText === "string") setFilterText(p.filterText);
        if (typeof p.ownerAccordionOpen === "boolean") setOwnerAccordionOpen(p.ownerAccordionOpen);
        if (Array.isArray(p.ownerAccordionExpanded)) setOwnerAccordionExpanded(p.ownerAccordionExpanded.map(String));
      }
    } catch {
      // ignore
    }

    // Load current user (role + owner mappings) so we can scope KPIs for staff.
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as
          | { ok: true; email: string; role: "MANAGER" | "STAFF"; ownerNames: string[] }
          | null;
        if (data?.ok) setMe({ email: data.email, role: data.role, ownerNames: data.ownerNames });
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    // Force logout after 12 hours of inactivity.
    // This is client-side inactivity (not absolute session lifetime).
    return startIdleLogout({
      sb,
      idleMs: 12 * 60 * 60 * 1000,
    });
  }, [sb]);

  // If we have user identity, prefer restoring their saved prefs.
  useEffect(() => {
    if (!me?.email) return;
    try {
      const raw = window.localStorage.getItem(`monthend:prefs:${me.email.toLowerCase()}`);
      if (!raw) return;
      const p = JSON.parse(raw) as {
        filterOwner?: string;
        filterStatus?: string;
        filterText?: string;
        ownerAccordionOpen?: boolean;
        ownerAccordionExpanded?: string[];
      };
      if (typeof p.filterOwner === "string") setFilterOwner(p.filterOwner);
      if (typeof p.filterStatus === "string") setFilterStatus(p.filterStatus);
      if (typeof p.filterText === "string") setFilterText(p.filterText);
      if (typeof p.ownerAccordionOpen === "boolean") setOwnerAccordionOpen(p.ownerAccordionOpen);
      if (Array.isArray(p.ownerAccordionExpanded)) setOwnerAccordionExpanded(p.ownerAccordionExpanded.map(String));
    } catch {
      // ignore
    }
  }, [me?.email]);

  // Persist UI prefs (global per user on this device/browser)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const key = me?.email ? `monthend:prefs:${me.email.toLowerCase()}` : "monthend:prefs";
    const payload = {
      filterOwner,
      filterStatus,
      filterText,
      ownerAccordionOpen,
      ownerAccordionExpanded,
    };

    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
      // Also keep a generic copy so we can restore before /api/auth/me resolves.
      window.localStorage.setItem("monthend:prefs", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [me, filterOwner, filterStatus, filterText, ownerAccordionOpen, ownerAccordionExpanded]);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // keep KPIs reasonably fresh without breaking the React "purity" rule
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const kpiTasks = useMemo(() => {
    const monthlyOnly = (xs: Task[]) =>
      xs.filter((t) => (t.frequency ?? "").toLowerCase() === "monthly");

    if (!me || me.role === "MANAGER") return monthlyOnly(tasks);

    const email = (me.email ?? "").trim().toLowerCase();
    const names = (me.ownerNames ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);

    return monthlyOnly(
      tasks.filter((t) => {
        const o = (t.owner ?? "").trim().toLowerCase();
        if (!o) return false;
        if (email && o === email) return true;
        return names.includes(o);
      })
    );
  }, [tasks, me]);

  const kpis = useMemo(() => {
    const total = kpiTasks.length;
    const doneTasks = kpiTasks.filter((t) => t.status === "DONE");
    const done = doneTasks.length;
    const overdue = kpiTasks.filter((t) => {
      if (t.status === "DONE") return false;
      const due = dueDateForKpi(t, period);
      return Boolean(due && due.getTime() < now);
    }).length;

    const dueNext7 = kpiTasks.filter((t) => {
      if (t.status === "DONE") return false;
      const due = dueDateForKpi(t, period);
      if (!due) return false;
      const ms = due.getTime() - now;
      return ms >= 0 && ms <= 7 * 24 * 60 * 60 * 1000;
    }).length;
    const inProgress = kpiTasks.filter((t) => t.status === "IN_PROGRESS").length;

    const doneWithDue = doneTasks.filter((t) => Boolean(dueDateForKpi(t, period) && t.lastDoneAt));
    const doneOnTime = doneWithDue.filter((t) => {
      // on time if done on/before due date (date-level), not time-of-day strict.
      const due = dueDateForKpi(t, period);
      if (!due) return false;
      const dueDay = due.toISOString().slice(0, 10);
      const doneDay = new Date(t.lastDoneAt!).toISOString().slice(0, 10);
      return doneDay <= dueDay;
    }).length;

    const onTimePct = doneWithDue.length === 0 ? null : doneOnTime / doneWithDue.length;

    // Due-to-date %: tasks that are promised on/before today (SA business day logic) and are DONE.
    const dueToDateTasks = kpiTasks.filter((t) => {
      const due = dueDateForKpi(t, period);
      return Boolean(due && due.getTime() <= now);
    });
    const dueToDateTotal = dueToDateTasks.length;
    const dueToDateDone = dueToDateTasks.filter((t) => t.status === "DONE").length;
    const dueToDatePct = dueToDateTotal === 0 ? null : dueToDateDone / dueToDateTotal;

    // Capacity / progress (budgeted vs completed) based on Est Hrs P/M
    const parseHours = (s: string | null) => {
      if (!s) return null;
      const m = String(s).trim().replace(/hrs?/gi, "").trim();
      const n = Number(m);
      return Number.isFinite(n) ? n : null;
    };

    const bizDays = businessDaysInMonthSa(period);

    const budgetHoursForTask = (t: Task): number | null => {
      const h = parseHours(t.estHoursPm);
      if (h === null) return null;
      const f = (t.frequency ?? "").toLowerCase();
      if (f === "monthly") return h;
      if (f === "daily") {
        if (bizDays === null) return null;
        return h * bizDays;
      }
      if (f === "weekly") {
        const occ = countWeekdayOccurrencesInMonthSa(period, t.weeklyDays ?? []);
        if (occ === null) return null;
        return h * occ;
      }
      // adhoc/other: treat as one-off hours
      return h;
    };

    let budgetedHours: number | null = 0;
    let completedHours: number | null = 0;
    let missingHours = 0;

    for (const t of kpiTasks) {
      const bh = budgetHoursForTask(t);
      if (bh === null) {
        missingHours++;
        continue;
      }
      budgetedHours! += bh;
      if (t.status === "DONE") completedHours! += bh;
    }

    if (missingHours > 0) {
      // Keep totals, but flag that they're incomplete.
    }

    const progressPct =
      budgetedHours && budgetedHours > 0 ? completedHours! / budgetedHours : null;

    const rework = kpiTasks.filter(
      (t) =>
        (t.frequency ?? "").toLowerCase() === "monthly" &&
        t.approvalStatus === "CHANGES_REQUESTED"
    ).length;

    // Month-end tracking: show whether we are tracking to a target close date.
    // Target: close completed by the 15th of the month after the period, rolled forward to next SA business day.

    const [yy, mm] = period.split("-").map((x) => Number(x));
    const closeWindowStart =
      Number.isFinite(yy) && Number.isFinite(mm)
        ? new Date(Date.UTC(yy, mm, 1)) // period is YYYY-MM, so this is next month
        : null;

    const targetCloseDate =
      closeWindowStart === null
        ? null
        : (() => {
            // 15th of close month (month after the period), rolled forward
            let d = new Date(Date.UTC(closeWindowStart.getUTCFullYear(), closeWindowStart.getUTCMonth(), 15));
            while (!isBusinessDay(d)) d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
            return d;
          })();

    const todayUtc = new Date(now);

    // Elapsed business days since start of close window (1st of close month)
    const elapsedBusinessDays = closeWindowStart
      ? Math.max(0, businessDaysBetweenUtc(closeWindowStart, todayUtc))
      : null;

    // Expected progress (outer ring): by today, what portion of the TOTAL budgeted hours
    // should be DONE, based on tasks whose Promised date is on/before today.
    // This keeps the comparison apples-to-apples with the inner ring (hours-based).
    let expectedBudgetedHours: number | null = 0;
    let expectedMissingHours = 0;

    for (const t of kpiTasks) {
      const due = dueDateForKpi(t, period);
      if (!due || due.getTime() > todayUtc.getTime()) continue;

      const bh = budgetHoursForTask(t);
      if (bh === null) {
        expectedMissingHours++;
        continue;
      }
      expectedBudgetedHours! += bh;
    }

    if (expectedMissingHours > 0) {
      // Leave expectedBudgetedHours as-is; we still want a directional %.
    }

    const expectedProgressPct =
      budgetedHours && budgetedHours > 0
        ? Math.min(1, Math.max(0, expectedBudgetedHours! / budgetedHours))
        : null;

    const onTrack =
      progressPct === null || expectedProgressPct === null
        ? null
        : progressPct + 0.08 >= expectedProgressPct; // 8% tolerance

    const projectedCloseDate =
      progressPct === null ||
      progressPct <= 0 ||
      expectedProgressPct === null ||
      elapsedBusinessDays === null ||
      elapsedBusinessDays <= 0 ||
      // Hide projection until we have enough signal.
      // Rule: show once we hit 5% progress OR 5 tasks DONE.
      (progressPct < 0.05 && done < 5)
        ? null
        : (() => {
            // Planned-curve projection:
            // - plannedPctToday = expectedProgressPct (outer ring)
            // - delta = actual - planned
            // - if we're ahead/at plan: find the plan date where planned reaches (1 - delta)
            // - if we're behind: extend beyond the plan finish date by the shortfall using the planned pace so far

            const plannedPctToday = expectedProgressPct;
            const delta = progressPct - plannedPctToday;

            // Build a lightweight planned curve from tasks' promised dates (hours-weighted)
            const dueHours: Array<{ ts: number; hours: number }> = [];
            let plannedFinishTs: number | null = null;

            for (const t of kpiTasks) {
              const due = dueDateForKpi(t, period);
              if (!due) continue;
              const bh = budgetHoursForTask(t);
              if (bh === null) continue;

              const ts = due.getTime();
              dueHours.push({ ts, hours: bh });
              plannedFinishTs = plannedFinishTs === null ? ts : Math.max(plannedFinishTs, ts);
            }

            if (!budgetedHours || budgetedHours <= 0 || plannedFinishTs === null) return null;

            dueHours.sort((a, b) => a.ts - b.ts);

            const plannedPctAt = (ts: number) => {
              let sum = 0;
              for (const d of dueHours) {
                if (d.ts <= ts) sum += d.hours;
                else break;
              }
              return Math.min(1, Math.max(0, sum / budgetedHours));
            };

            // If at/above plan, project to the plan date where we hit the remaining requirement.
            if (delta >= 0) {
              const threshold = Math.min(1, Math.max(0, 1 - delta));

              // Walk forward day-by-day from today until we hit the threshold, but never past plan finish.
              let d = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate()));
              const end = new Date(plannedFinishTs);

              for (let i = 0; i < 120; i++) {
                if (plannedPctAt(d.getTime()) >= threshold) return d;
                if (d.getTime() >= end.getTime()) return end;
                d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
              }

              return end;
            }

            // If behind plan, extend beyond plan finish using planned pace-to-date.
            const plannedRatePerBusinessDay = plannedPctToday / elapsedBusinessDays;
            if (!Number.isFinite(plannedRatePerBusinessDay) || plannedRatePerBusinessDay <= 0) {
              return new Date(plannedFinishTs);
            }

            const shortfall = -delta; // how far behind plan we are (0..1)
            const extraDays = Math.ceil(shortfall / plannedRatePerBusinessDay);
            return addBusinessDaysUtc(new Date(plannedFinishTs), extraDays);
          })();

    // targetCloseDate is computed above (15th rolled forward)

    return {
      total,
      overdue,
      dueNext7,
      inProgress,
      done,
      rework,
      onTimePct,
      dueToDatePct,

      budgetedHours,
      completedHours,
      progressPct,
      missingHours,

      onTrack,
      expectedProgressPct,
      projectedCloseDate,
      targetCloseDate,
    };
  }, [kpiTasks, now, period]);

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const v = (t.owner ?? "").trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    const q = filterText.trim().toLowerCase();

    const matchText = (t: Task) => {
      if (!q) return true;
      const hay = [
        t.title,
        t.owner ?? "",
        t.dependency ?? "",
        t.blocker ?? "",
        t.frequency ?? "",
        t.notes ?? "",
      ]
        .join(" | ")
        .toLowerCase();
      return hay.includes(q);
    };

    return tasks.filter((t) => {
      const ownerKey = (t.owner ?? "").trim() || "Unassigned";
      if (filterOwner !== "ALL" && ownerKey !== filterOwner) return false;

      if (filterStatus !== "ALL" && t.status !== filterStatus) return false;

      return matchText(t);
    });
  }, [tasks, filterOwner, filterStatus, filterText]);

  function openWizard() {
    setActionError(null);
    setWizardStep(1);
    setWType("monthly");
    wizardDataRef.current = {
      title: "",
      owner: "",
      hrs: "",
      dueDate: "",
      monthlyDay: 7,
      weeklyDay: 1,
      time: "",
    };
    setWizardOpen(true);
  }

  async function createTaskFromWizard() {
    const title = wizardDataRef.current.title.trim();
    if (!title) {
      setActionError("Task title is required.");
      setWizardStep(1);
      return;
    }

    const owner = wizardDataRef.current.owner.trim();

    const payload: {
      title: string;
      owner: string | null;
      frequency: NewTaskType;
      estHoursPm: string | null;
      weeklyDays?: number[];
      dailyTime?: string | null;
      dueAt?: string | null;
      monthlyDay?: number | null;
    } = {
      title,
      owner: owner ? owner : null,
      frequency: wType,
      estHoursPm: wizardDataRef.current.hrs.trim() ? wizardDataRef.current.hrs.trim() : null,
    };

    // Due / schedule
    if (wType === "weekly") {
      payload.weeklyDays = [wizardDataRef.current.weeklyDay];
      payload.dailyTime = wizardDataRef.current.time.trim() ? wizardDataRef.current.time.trim() : null;
    } else if (wType === "daily") {
      payload.dailyTime = wizardDataRef.current.time.trim() ? wizardDataRef.current.time.trim() : null;
    } else if (wType === "monthly") {
      payload.monthlyDay = Number.isFinite(wizardDataRef.current.monthlyDay)
        ? wizardDataRef.current.monthlyDay
        : null;
      payload.dueAt = null;
    } else {
      // adhoc
      payload.dueAt = wizardDataRef.current.dueDate
        ? parseAuDateToIso(wizardDataRef.current.dueDate)
        : null;
      if (wizardDataRef.current.dueDate && !payload.dueAt) {
        setActionError("Invalid due date. Use DD/MM/YYYY (e.g. 07/03/2026). ");
        setWizardStep(3);
        return;
      }
    }

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(data.error || `Create failed (${res.status})`);
        return;
      }

      setWizardOpen(false);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Create failed (network error).");
    }
  }

  async function deleteTask(id: string, title: string) {
    const ok = window.confirm(`Delete task "${title}"? This can't be undone.`);
    if (!ok) return;

    setActionError(null);

    // optimistic remove
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setSelectedIds((prev) => prev.filter((x) => x !== id));

    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setActionError(data?.error || `Delete failed (${res.status})`);
      await refresh();
    }
  }

  async function updateTaskServer(
    id: string,
    patch: Partial<Task>
  ): Promise<{ ok: true; task: Task } | { ok: false; error: string }> {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await sleep(400 * Math.pow(2, attempt - 1));
      }

      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; errorId?: string }
          | null;

        // Retry only for 5xx
        if (res.status >= 500 && attempt < 2) {
          continue;
        }

        const msg = data?.error
          ? `${data.error}${data.errorId ? ` (id: ${data.errorId})` : ""}`
          : `Update failed (${res.status})`;

        return { ok: false, error: msg };
      }

      const data = (await res.json().catch(() => null)) as { task?: Task } | null;
      if (!data?.task) return { ok: false, error: "Update failed (bad response)." };

      return { ok: true, task: data.task };
    }

    return { ok: false, error: "Update failed (server error)." };
  }

  async function updateTaskOptimistic(id: string, patch: Partial<Task>) {
    setActionError(null);

    // Snapshot current row for rollback.
    let before: Task | null = null;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        before = t;
        return { ...t, ...patch };
      })
    );

    const res = await updateTaskServer(id, patch);
    if (!res.ok) {
      // rollback
      if (before) {
        setTasks((prev) => prev.map((t) => (t.id === id ? before! : t)));
      }
      setActionError(res.error);
      return false;
    }

    // Merge canonical server copy (e.g. rolled fields).
    // Also normalise ordering to promised date so the UI never looks "out of order".
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === id ? res.task : t));

      // PERF: precompute promised-date sort keys once per task, not on every comparator call.
      const dueKey = new Map<string, number>();
      for (const t of next) {
        const key = dueDateForKpi(t, period)?.getTime();
        dueKey.set(t.id, Number.isFinite(key ?? NaN) ? (key as number) : Number.MAX_SAFE_INTEGER);
      }

      const rank = (f: string) =>
        f === "daily" ? 0 : f === "weekly" ? 1 : f === "adhoc" ? 2 : f === "monthly" ? 3 : 4;

      return next
        .slice()
        .sort((a, b) => {
          const ra = rank((a.frequency ?? "").toLowerCase());
          const rb = rank((b.frequency ?? "").toLowerCase());
          if (ra !== rb) return ra - rb;

          const da = dueKey.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const db = dueKey.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          if (da !== db) return da - db;

          return (a.title ?? "").localeCompare(b.title ?? "");
        });
    });
    return true;
  }

  async function applyBulkOwner(ownerRaw: string) {
    const owner = ownerRaw.trim();
    if (selectedIds.length === 0) return;

    setActionError(null);

    // allow clearing to Unassigned via empty string
    const patch: Partial<Task> = { owner: owner ? owner : null };

    // Optimistically update UI first (no jump)
    setTasks((prev) =>
      prev.map((t) => (selectedIds.includes(t.id) ? { ...t, ...patch } : t))
    );

    // Update sequentially to keep db happy.
    for (const id of selectedIds) {
      const res = await updateTaskServer(id, patch);
      if (!res.ok) {
        setActionError(res.error);
        // reconcile by reloading from server
        await refresh();
        return;
      }
      setTasks((prev) => prev.map((t) => (t.id === id ? res.task : t)));
    }

    setSelectedIds([]);
    setBulkOwner("");
  }

  async function closeMonth() {
    setClosing(true);
    try {
      const res = await fetch("/api/month-close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setActionError(data.error || `Month close failed (${res.status})`);
        return;
      }
      await refresh();
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Finance Task Hub
          </h1>
          <p className="mt-1 text-white/80">
            Visibility on finance tasks, owners, and due dates - without chasing people.
          </p>
        </div>

        <div className="flex w-full items-start gap-4 sm:w-[560px] sm:flex-nowrap sm:justify-end">
          <ProgressRing
            sizePx={112}
            progressPct={kpis.progressPct}
            expectedProgressPct={kpis.expectedProgressPct}
            projectedCloseDate={kpis.projectedCloseDate}
            targetCloseDate={kpis.targetCloseDate}
          />

          <div className="flex items-end gap-2 flex-none">
            <div>
              <div className="text-xs text-white/60">Period (YYYY-MM)</div>
              <input
                className="h-10 w-[140px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
            <button
              className="jam-btn jam-btn-primary h-10"
              type="button"
              onClick={() => void closeMonth()}
              disabled={closing}
            >
              {closing ? "Closing…" : "Month Closed"}
            </button>

            <button
              className="jam-btn h-10"
              type="button"
              onClick={async () => {
                try {
                  await sb.auth.signOut();
                } finally {
                  window.location.href = "/login";
                }
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-white/10 bg-white/5 p-4">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-white/80">
              KPIs (monthly tasks){me?.role === "STAFF" ? " – your tasks" : ""}
            </div>
            {me?.role === "MANAGER" ? (
              <a className="jam-btn h-9" href="/reports">
                Reports
              </a>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-white/60">
            Monthly tasks only. Progress is based on budgeted hours vs completed hours.
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-9">
          <Kpi label="Total" value={String(kpis.total)} />
          <Kpi label="Overdue" value={String(kpis.overdue)} />
          <Kpi label="Due next 7 days" value={String(kpis.dueNext7)} />
          <Kpi label="In progress" value={String(kpis.inProgress)} />
          <Kpi label="Done" value={String(kpis.done)} />
          <Kpi label="Rework" value={String(kpis.rework)} />
          <Kpi
            label="Due-to-date %"
            value={
              kpis.dueToDatePct === null
                ? "-"
                : `${Math.round(kpis.dueToDatePct * 100)}%`
            }
          />
          <Kpi
            label="On-time %"
            value={
              kpis.onTimePct === null ? "-" : `${Math.round(kpis.onTimePct * 100)}%`
            }
          />
          <Kpi
            label={`Budgeted hrs (${period})`}
            value={
              kpis.missingHours
                ? "Fill hrs"
                : kpis.budgetedHours === null
                  ? "-"
                  : String(Math.round(kpis.budgetedHours * 10) / 10)
            }
          />
          <Kpi
            label={`Completed hrs (${period})`}
            value={
              kpis.missingHours
                ? "Fill hrs"
                : kpis.completedHours === null
                  ? "-"
                  : String(Math.round(kpis.completedHours * 10) / 10)
            }
          />
          {/* Progress % tile removed (redundant with progress ring) */}
        </div>

        <OwnerAccordion
          tasks={tasks}
          period={period}
          open={ownerAccordionOpen}
          onOpenChange={setOwnerAccordionOpen}
          expandedOwners={ownerAccordionExpanded}
          onExpandedOwnersChange={setOwnerAccordionExpanded}
        />
      </div>

      <div className="rounded-md border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Tasks</div>
            <div className="mt-1 text-xs text-white/70">
              Tip: keep Due date for “when it should be done”, and ETA for “when it will be done”.
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded border border-white/15 bg-black/20 px-2 text-sm outline-none"
                value={filterOwner}
                onChange={(e) => {
                  setSelectedIds([]);
                  setFilterOwner(e.target.value);
                }}
              >
                <option value="ALL">All owners</option>
                <option value="Unassigned">Unassigned</option>
                {ownerOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>

              <select
                className="h-9 rounded border border-white/15 bg-black/20 px-2 text-sm outline-none"
                value={filterStatus}
                onChange={(e) => {
                  setSelectedIds([]);
                  setFilterStatus(e.target.value);
                }}
              >
                <option value="ALL">All statuses</option>
                <option value="NOT_STARTED">Not started</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="WAITING">Waiting</option>
                <option value="DONE">Done</option>
              </select>

              <input
                className="h-9 w-[260px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
                placeholder="Filter… (task, owner, notes, dependency, etc)"
                value={filterText}
                onChange={(e) => {
                  setSelectedIds([]);
                  setFilterText(e.target.value);
                }}
              />

              <button
                className="jam-btn h-9"
                type="button"
                onClick={() => {
                  setSelectedIds([]);
                  setFilterOwner("ALL");
                  setFilterStatus("ALL");
                  setFilterText("");
                }}
              >
                Clear filters
              </button>

              <div className="text-xs text-white/60">
                Showing <span className="font-semibold text-white/80">{visibleTasks.length}</span> of {tasks.length}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* New task wizard modal */}
            {wizardOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-2xl rounded-md border border-slate-200 bg-white/95 p-4 text-slate-900 shadow-xl backdrop-blur">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">New task</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Step {wizardStep} of 3
                      </div>
                    </div>
                    <button
                      className="jam-btn h-9"
                      type="button"
                      onClick={() => setWizardOpen(false)}
                    >
                      Close
                    </button>
                  </div>

                  {wizardStep === 1 ? (
                    <div className="mt-4 space-y-3">
                      <div>
                        <div className="text-xs text-slate-600">Task title</div>
                        <input
                          className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                          defaultValue={wizardDataRef.current.title}
                          onChange={(e) => {
                            wizardDataRef.current.title = e.target.value;
                          }}
                          placeholder="e.g. Accrued expenses"
                          autoFocus
                        />
                      </div>

                      <div>
                        <div className="text-xs text-slate-600">Type</div>
                        <select
                          className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none"
                          value={wType}
                          onChange={(e) => setWType(e.target.value as NewTaskType)}
                        >
                          <option value="monthly">Monthly</option>
                          <option value="weekly">Weekly</option>
                          <option value="daily">Daily</option>
                          <option value="adhoc">Adhoc</option>
                        </select>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Default is Monthly.
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {wizardStep === 2 ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs text-slate-600">Owner (optional)</div>
                        <input
                          className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                          defaultValue={wizardDataRef.current.owner}
                          list="owner-datalist"
                          onChange={(e) => {
                            wizardDataRef.current.owner = e.target.value;
                          }}
                          placeholder="e.g. Kylie"
                          autoFocus
                        />
                      </div>
                      <div>
                        <div className="text-xs text-slate-600">Budget hours (Hrs)</div>
                        <input
                          className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                          defaultValue={wizardDataRef.current.hrs}
                          onChange={(e) => {
                            wizardDataRef.current.hrs = e.target.value;
                          }}
                          placeholder="e.g. 1, 0.5, 2"
                        />
                      </div>
                    </div>
                  ) : null}

                  {wizardStep === 3 ? (
                    <div className="mt-4 space-y-3">
                      {wType === "monthly" ? (
                        <div>
                          <div className="text-xs text-slate-600">Due day of month</div>
                          <select
                            className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none"
                            defaultValue={String(wizardDataRef.current.monthlyDay)}
                            onChange={(e) => {
                              wizardDataRef.current.monthlyDay = Number(e.target.value);
                            }}
                            autoFocus
                          >
                            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                              <option key={d} value={String(d)}>
                                {d}
                              </option>
                            ))}
                          </select>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Monthly tasks repeat - this is the day of the month (e.g. 7 = the 7th).
                          </div>
                        </div>
                      ) : wType === "adhoc" ? (
                        <div>
                          <div className="text-xs text-slate-600">Due date (DD/MM/YYYY)</div>
                          <input
                            className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                            defaultValue={wizardDataRef.current.dueDate}
                            onChange={(e) => {
                              wizardDataRef.current.dueDate = e.target.value;
                            }}
                            placeholder="DD/MM/YYYY"
                            autoFocus
                          />
                        </div>
                      ) : null}

                      {wType === "weekly" ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="text-xs text-slate-600">Day</div>
                            <select
                              className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none"
                              defaultValue={String(wizardDataRef.current.weeklyDay)}
                              onChange={(e) => {
                                wizardDataRef.current.weeklyDay = Number(e.target.value);
                              }}
                              autoFocus
                            >
                              <option value="1">Monday</option>
                              <option value="2">Tuesday</option>
                              <option value="3">Wednesday</option>
                              <option value="4">Thursday</option>
                              <option value="5">Friday</option>
                            </select>
                          </div>
                          <div>
                            <div className="text-xs text-slate-600">Time (optional)</div>
                            <input
                              type="time"
                              className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none"
                              defaultValue={wizardDataRef.current.time}
                              onChange={(e) => {
                                wizardDataRef.current.time = e.target.value;
                              }}
                            />
                          </div>
                        </div>
                      ) : null}

                      {wType === "daily" ? (
                        <div>
                          <div className="text-xs text-slate-600">Time (optional) - runs Mon-Fri</div>
                          <input
                            type="time"
                            className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none"
                            defaultValue={wizardDataRef.current.time}
                            onChange={(e) => {
                              wizardDataRef.current.time = e.target.value;
                            }}
                            autoFocus
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                    <button
                      className="jam-btn h-9"
                      type="button"
                      onClick={() =>
                        setWizardStep((s) => (s === 1 ? 1 : s === 2 ? 1 : 2))
                      }
                      disabled={wizardStep === 1}
                    >
                      Back
                    </button>

                    <div className="flex flex-wrap gap-2">
                      {wizardStep < 3 ? (
                        <button
                          className="jam-btn jam-btn-primary h-9"
                          type="button"
                          onClick={() => setWizardStep((s) => (s === 1 ? 2 : 3))}
                        >
                          Next
                        </button>
                      ) : (
                        <button
                          className="jam-btn jam-btn-primary h-9"
                          type="button"
                          onClick={() => void createTaskFromWizard()}
                        >
                          Create task
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <button
              className="jam-btn jam-btn-primary h-10"
              type="button"
              onClick={() => openWizard()}
            >
              New task
            </button>
          </div>
        </div>

        {/* Owner KPIs moved to KPI section */}

        {loadError ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
            <div>
              <div className="font-semibold">Couldn’t load tasks</div>
              <div className="text-xs text-red-100/80">{loadError}</div>
            </div>
            <button
              className="jam-btn jam-btn-primary h-9"
              type="button"
              onClick={() => void refresh()}
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : null}

        {actionError ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
            <div>
              <div className="font-semibold">Error</div>
              <div className="text-xs text-red-100/80">{actionError}</div>
            </div>
            <button
              className="jam-btn h-9"
              type="button"
              onClick={() => setActionError(null)}
            >
              Clear
            </button>
          </div>
        ) : null}

        {selectedIds.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-black/10 p-3">
            <div className="text-sm text-white/80">
              <span className="font-semibold">{selectedIds.length}</span> selected
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="h-9 w-[220px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
                placeholder="Change owner to… (blank = Unassigned)"
                value={bulkOwner}
                onChange={(e) => setBulkOwner(e.target.value)}
                list="owner-datalist"
              />
              <button
                className="jam-btn jam-btn-primary h-9"
                type="button"
                onClick={() => void applyBulkOwner(bulkOwner)}
              >
                Apply
              </button>
              <button
                className="jam-btn h-9"
                type="button"
                onClick={() => {
                  setSelectedIds([]);
                  setBulkOwner("");
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

        <datalist id="owner-datalist">
          {ownerOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>

        <div className="mt-4 overflow-x-hidden">
          <table className="w-full border-collapse text-left text-sm table-fixed">
            <colgroup>
              <col style={{ width: "3%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "13%" }} />
            </colgroup>
            <thead>
              <tr className="border-b border-white/10 text-xs text-white/70">
                <th className="py-2 pr-3">
                  <input
                    type="checkbox"
                    aria-label="Select all visible tasks"
                    checked={
                      visibleTasks.length > 0 &&
                      visibleTasks.every((t) => selectedIds.includes(t.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(visibleTasks.map((t) => t.id));
                      } else {
                        // only clear visible ids
                        setSelectedIds((prev) =>
                          prev.filter((id) => !visibleTasks.some((t) => t.id === id))
                        );
                      }
                    }}
                  />
                </th>
                <th className="py-2 pr-3">Owner</th>
                <th className="py-2 pr-3">Task</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Review</th>
                <th className="py-2 pr-3">Hrs</th>
                <th className="py-2 pr-3">Dependency</th>
                <th className="py-2 pr-3">Promised date</th>
                <th className="py-2 pr-3">ETA</th>
                <th className="py-2 pr-3">Comments</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="py-3 text-white/70" colSpan={11}>
                    Loading…
                  </td>
                </tr>
              ) : visibleTasks.length === 0 ? (
                <tr>
                  <td className="py-3 text-white/70" colSpan={11}>
                    No tasks yet.
                  </td>
                </tr>
              ) : (
                <GroupedRows
                  tasks={visibleTasks}
                  allTasks={tasks}
                  period={period}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  updateTask={updateTaskOptimistic}
                  deleteTask={deleteTask}
                  setTasks={setTasks}
                  canEditPromisedDate={canEditPromisedDate}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/10 p-3">
      <div className="text-xs text-white/70">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function ProgressRing({
  sizePx = 56,
  progressPct,
  expectedProgressPct,
  projectedCloseDate,
  targetCloseDate,
}: {
  sizePx?: number;
  progressPct: number | null;
  expectedProgressPct: number | null;
  projectedCloseDate: Date | null;
  targetCloseDate: Date | null;
}) {
  const pct = progressPct === null ? null : Math.max(0, Math.min(1, progressPct));
  const expected =
    expectedProgressPct === null ? null : Math.max(0, Math.min(1, expectedProgressPct));

  const pctText = pct === null ? "-" : `${Math.round(pct * 100)}%`;

  const delta = pct === null || expected === null ? null : pct - expected;

  const tier: "neutral" | "green" | "amber" | "red" =
    delta === null
      ? "neutral"
      : delta >= -0.08
        ? "green"
        : delta >= -0.15
          ? "amber"
          : "red";

  const statusText =
    tier === "neutral"
      ? ""
      : tier === "green"
        ? "On track"
        : tier === "amber"
          ? "Slightly behind"
          : "At risk";

  const accent =
    tier === "neutral"
      ? "#94a3b8" // slate
      : tier === "green"
        ? "#34d399" // green
        : tier === "amber"
          ? "#fbbf24" // amber
          : "#fb7185"; // red

  const track = "rgba(255,255,255,0.12)";
  const expectedColour = "rgba(255,255,255,0.55)";

  // Outer ring = expected, inner ring = actual.
  const outerStyle: React.CSSProperties =
    expected === null
      ? { background: `conic-gradient(${track} 0deg, ${track} 360deg)` }
      : { background: `conic-gradient(${expectedColour} ${Math.round(expected * 360)}deg, ${track} 0deg)` };

  const innerStyle: React.CSSProperties =
    pct === null
      ? { background: `conic-gradient(${track} 0deg, ${track} 360deg)` }
      : { background: `conic-gradient(${accent} ${Math.round(pct * 360)}deg, ${track} 0deg)` };

  const ringInset = Math.max(6, Math.round(sizePx * 0.11));

  return (
    <div className="flex items-start gap-3">
      <div className="relative flex-none" style={{ width: sizePx, height: sizePx }} title={statusText}>
        {/* Outer expected ring */}
        <div className="absolute inset-0 rounded-full p-[3px]" style={outerStyle}>
          <div className="h-full w-full rounded-full bg-slate-950/60" />
        </div>

        {/* Inner actual ring */}
        <div className="absolute rounded-full p-[3px]" style={{ ...innerStyle, inset: ringInset }}>
          <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-950/60">
            <div
              className={
                "font-semibold " + (sizePx >= 96 ? "text-base" : "text-xs")
              }
              style={{ color: accent }}
            >
              {pctText}
            </div>
          </div>
        </div>
      </div>

      <div className="text-xs text-white/70 pt-[2px] leading-[1.15]">
        <div
          className={
            tier === "neutral"
              ? "text-white/70"
              : tier === "green"
                ? "text-emerald-200"
                : tier === "amber"
                  ? "text-amber-200"
                  : "text-rose-200"
          }
        >
          {statusText || "Progress"}
        </div>
        <div className="text-white/60">
          Target close: {targetCloseDate ? formatAuDate(targetCloseDate.toISOString()) : "-"}
        </div>
        <div className="text-white/60">
          Projected close: {projectedCloseDate ? formatAuDate(projectedCloseDate.toISOString()) : "-"}
        </div>
      </div>
    </div>
  );
}

function dayLabelLong(n: number) {
  return (
    {
      1: "Monday",
      2: "Tuesday",
      3: "Wednesday",
      4: "Thursday",
      5: "Friday",
      6: "Saturday",
      7: "Sunday",
    } as Record<number, string>
  )[n] ?? String(n);
}

function formatTime12h(hhmm: string) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const mm = m[2];
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = ((h + 11) % 12) + 1;
  return mm === "00" ? `${h12}${suffix}` : `${h12}:${mm}${suffix}`;
}

function startOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function mondayOfCurrentWeekLocal(from = new Date()) {
  const d0 = startOfDayLocal(from);
  const js = d0.getDay(); // 0 Sun .. 6 Sat
  const iso = js === 0 ? 7 : js; // 1=Mon .. 7=Sun
  const delta = 1 - iso; // move back to Monday
  const cand = new Date(d0);
  cand.setDate(cand.getDate() + delta);
  return cand;
}

function formatSchedule(t: Task) {
  const f = (t.frequency ?? "").toLowerCase();
  if (f === "weekly") {
    const daysRaw = (t.weeklyDays ?? []).filter((x) => x >= 1 && x <= 7);
    const time = t.dailyTime ? ` ${formatTime12h(t.dailyTime)}` : "";

    // Display-only rule: if it's a Monday-only weekly task and Monday is a SA public holiday,
    // show Tuesday instead.
    if (daysRaw.length === 1 && daysRaw[0] === 1) {
      const monThisWeek = mondayOfCurrentWeekLocal();
      if (isSaPublicHoliday(monThisWeek)) {
        return `Tuesday${time} (Mon public holiday)`;
      }
      return `Monday${time}`;
    }

    const days = daysRaw.map(dayLabelLong).join(", ");
    return `${days}${time}`;
  }
  if (f === "daily") {
    const time = t.dailyTime ? ` ${t.dailyTime}` : "";
    return `Mon-Fri${time}`;
  }
  return "";
}

function monthlyGateInfo(t: Task): { label: string; title: string; tone: "neutral" | "warn" } | null {
  const f = (t.frequency ?? "").toLowerCase();
  if (f !== "monthly") return null;

  const title = (t.title ?? "").toLowerCase().trim().replace(/\s+/g, " ");

  const isLockPostingPeriods =
    title.includes("lock") && title.includes("posting") && title.includes("period");

  const isMonthlyGateReport =
    title.includes("jamieson group monthly reporting model") ||
    title.includes("monthly management board report pack finalised") ||
    title.includes("report pack");

  const isTaxEndTask =
    title.includes("bas lodgement") ||
    title.includes("bas reconciliation") ||
    title.includes("diesel fuel credit") ||
    title.includes("fbt accrual");

  if (isLockPostingPeriods) {
    return {
      tone: "warn",
      label: "Gated",
      title: "Can't be marked DONE until all other monthly tasks are DONE.",
    };
  }

  if (isMonthlyGateReport) {
    return {
      tone: "warn",
      label: "Gated",
      title:
        "Can't be marked DONE until all other monthly tasks are DONE (excluding Lock Posting Periods + BAS/DFC/FBT).",
    };
  }

  if (isTaxEndTask) {
    return {
      tone: "warn",
      label: "Gated",
      title:
        "Can't be marked DONE until all other monthly tasks are DONE (excluding Lock Posting Periods + BAS/DFC/FBT).",
    };
  }

  return null;
}

function StatusChips({
  value,
  onChange,
}: {
  value: TaskStatus;
  onChange: (v: TaskStatus) => void;
}) {
  const options: Array<{
    v: TaskStatus;
    label: string;
    inactive: string;
    active: string;
  }> = [
    {
      v: "NOT_STARTED",
      label: "Not started",
      inactive: "border-white/15 text-white/60 hover:bg-white/5",
      active: "border-white/40 bg-white/15 text-white",
    },
    {
      v: "IN_PROGRESS",
      label: "In progress",
      inactive: "border-yellow-400/25 text-yellow-200/70 hover:bg-yellow-400/10",
      active: "border-yellow-300/60 bg-yellow-400/20 text-yellow-100",
    },
    {
      v: "WAITING",
      label: "Waiting",
      inactive: "border-sky-400/25 text-sky-200/70 hover:bg-sky-400/10",
      active: "border-sky-300/60 bg-sky-400/20 text-sky-100",
    },
    // BLOCKED removed
    {
      v: "DONE",
      label: "Done",
      inactive: "border-emerald-400/25 text-emerald-200/70 hover:bg-emerald-400/10",
      active: "border-emerald-300/60 bg-emerald-400/20 text-emerald-100",
    },
  ];

  const current = options.find((o) => o.v === value)?.label ?? "-";

  return (
    <div>
      <div className="mb-1 text-[11px] text-white/60">
        Status: <span className="font-semibold text-white/90">{current}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const active = o.v === value;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              className={
                "rounded-full border px-2 py-1 text-xs leading-none transition " +
                (active ? o.active : `bg-black/10 ${o.inactive}`)
              }
              aria-pressed={active}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function parsePeriod(period: string) {
  const m = /^([0-9]{4})-([0-9]{2})$/.exec(period.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function addDaysUtc(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function firstBusinessDayOfNextMonthSa(period: string) {
  const p = parsePeriod(period);
  if (!p) return null;
  // First day of the month after the period month
  let d = new Date(Date.UTC(p.year, p.month, 1));
  while (!isBusinessDay(d)) d = addDaysUtc(d, 1); // roll forward to business day
  return d;
}

function monthlyDueForPeriodSa(period: string, monthlyDay: number | null) {
  // Period is the month being closed (e.g. 2026-02). Monthly task due dates are in the *following* month.
  const p = parsePeriod(period);
  if (!p) return null;
  if (!Number.isFinite(monthlyDay ?? NaN)) return null;
  const dom = Number(monthlyDay);
  if (dom < 1 || dom > 31) return null;

  const base = new Date(Date.UTC(p.year, p.month - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + 1); // move to next month
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();

  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let d = new Date(Date.UTC(y, m, Math.min(dom, lastDay)));
  while (!isBusinessDay(d)) d = addDaysUtc(d, 1); // roll forward to business day
  return d;
}

function isBankRecsMilestone(t: Task) {
  const title = (t.title ?? "").toLowerCase();
  return title.includes("bank") && title.includes("recon") && title.includes("(eom)");
}

function isMonthEndWindow(period: string) {
  // Enforce stricter rules only when closing the most recent month (i.e., last month)
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  const last = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const lastPeriod = `${last.y}-${String(last.m).padStart(2, "0")}`;
  return period === lastPeriod;
}

function isMonthEndBankRecsUploadRequiredTask(t: Task) {
  const title = (t.title ?? "").toLowerCase();
  return (
    title.includes("cash at bank accounts reconciled") ||
    title.includes("commonwealth bank credit card reconciliations") ||
    title.includes("nab credit card reconciliations") ||
    title.includes("westpac credit card transactions")
  );
}

function dueDateForKpi(t: Task, period: string) {
  const f = (t.frequency ?? "").toLowerCase();

  // Special-case milestone: bank recs should be completed on the first available (business) day
  // of the month after the period month.
  if (isBankRecsMilestone(t)) {
    return firstBusinessDayOfNextMonthSa(period);
  }

  if (f === "monthly") {
    return monthlyDueForPeriodSa(period, t.monthlyDay);
  }
  // Adhoc/monthly historical uses dueAt
  if (t.dueAt) return new Date(t.dueAt);
  // If backend has computed nextDueAt, use it
  if (t.nextDueAt) return new Date(t.nextDueAt);
  return null;
}

function formatAuDate(iso: string | null) {
  if (!iso) return "";
  // Expect ISO string; take date portion.
  const d = iso.slice(0, 10);
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(d);
  if (!m) return d;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function parseDependencies(depRaw: string | null | undefined) {
  const s = (depRaw ?? "").trim();
  if (!s) return [] as string[];
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr.map((x) => String(x).trim()).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  // Back-compat: treat as a single title string.
  return [s];
}

function stringifyDependencies(deps: string[]) {
  const clean = deps.map((x) => x.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0]; // keep simple
  return JSON.stringify(Array.from(new Set(clean)));
}

function parseAuDateToIso(ddmmyyyy: string) {
  const s = ddmmyyyy.trim();
  if (!s) return null;
  const m = /^([0-3]?\d)[\/\-]([01]?\d)[\/\-]([12]\d{3})$/.exec(s);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  // Use UTC ISO, date only.
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  // Basic sanity: if JS rolled the date (e.g. 31/02), reject.
  if (
    dt.getUTCFullYear() !== yyyy ||
    dt.getUTCMonth() !== mm - 1 ||
    dt.getUTCDate() !== dd
  ) {
    return null;
  }
  return dt.toISOString();
}

function businessDaysInMonthSa(period: string) {
  const p = parsePeriod(period);
  if (!p) return null;
  const { year, month } = p;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  let count = 0;
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (isBusinessDay(d)) count++;
  }
  return count;
}

function isoDay(d: Date) {
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}

function countWeekdayOccurrencesInMonthSa(period: string, isoWeekdays: number[]) {
  const p = parsePeriod(period);
  if (!p) return null;
  const { year, month } = p;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const set = new Set(isoWeekdays.filter((x) => x >= 1 && x <= 7));
  let count = 0;
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!isBusinessDay(d)) continue; // weekly skip holidays
    if (set.has(isoDay(d))) count++;
  }
  return count;
}

function parseHoursMaybe(s: string | null) {
  if (!s) return null;
  const m = String(s).trim().replace(/hrs?/gi, "").trim();
  const n = Number(m);
  return Number.isFinite(n) ? n : null;
}

function OwnerAccordion({
  tasks,
  period,
  open,
  onOpenChange,
  expandedOwners,
  onExpandedOwnersChange,
}: {
  tasks: Task[];
  period: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expandedOwners: string[];
  onExpandedOwnersChange: (v: string[]) => void;
}) {
  const bizDays = businessDaysInMonthSa(period);

  const rows = useMemo(() => {
    const byOwner = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = (t.owner ?? "").trim() || "Unassigned";
      if (!byOwner.has(key)) byOwner.set(key, []);
      byOwner.get(key)!.push(t);
    }

    const owners = Array.from(byOwner.entries()).map(([owner, ts]) => {
      const total = ts.length;
      const done = ts.filter((t) => t.status === "DONE");
      const overdue = ts.filter((t) => {
        if (t.status === "DONE") return false;
        const due = dueDateForKpi(t, period);
        return Boolean(due && due.getTime() < Date.now());
      }).length;

      const doneWithDue = done.filter((t) => Boolean(dueDateForKpi(t, period) && t.lastDoneAt));
      const doneOnTime = doneWithDue.filter((t) => {
        const due = dueDateForKpi(t, period);
        if (!due) return false;
        const dueDay = due.toISOString().slice(0, 10);
        const doneDay = new Date(t.lastDoneAt!).toISOString().slice(0, 10);
        return doneDay <= dueDay;
      }).length;
      const onTimePct = doneWithDue.length ? doneOnTime / doneWithDue.length : null;

      // Budgeted vs completed hours (period capacity)
      let missingHours = false;
      let budgetHours = 0;
      let doneHours = 0;

      for (const t of ts) {
        const h = parseHoursMaybe(t.estHoursPm);
        if (h === null) {
          missingHours = true;
          continue;
        }

        const f = (t.frequency ?? "").toLowerCase();
        let bh: number | null = null;
        if (f === "monthly") {
          bh = h;
        } else if (f === "daily") {
          if (bizDays === null) {
            bh = null;
          } else {
            bh = h * bizDays;
          }
        } else if (f === "weekly") {
          const occ = countWeekdayOccurrencesInMonthSa(period, t.weeklyDays ?? []);
          if (occ === null) {
            bh = null;
          } else {
            bh = h * occ;
          }
        } else {
          // adhoc/other: treat as one-off hours
          bh = h;
        }

        if (bh === null) {
          missingHours = true;
          continue;
        }

        budgetHours += bh;
        if (t.status === "DONE") doneHours += bh;
      }

      return {
        owner,
        tasks: ts,
        total,
        done: done.length,
        overdue,
        onTimePct,
        budgetHours,
        doneHours,
        hoursMissing: missingHours,
      };
    });

    owners.sort((a, b) => a.owner.localeCompare(b.owner));
    return owners;
  }, [tasks, period, bizDays]);

  const totalBudgetHours = rows.reduce(
    (acc, r) => acc + (r.hoursMissing ? 0 : r.budgetHours),
    0
  );

  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (acc, r) => {
      acc.total += r.total;
      acc.done += r.done;
      acc.overdue += r.overdue;
      return acc;
    },
    { total: 0, done: 0, overdue: 0 }
  );

  return (
    <details
      className="mt-4 rounded border border-white/10 bg-black/10"
      open={open}
      onToggle={(e) => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">By owner</div>
            <div className="text-xs text-white/60">
              Owners: {rows.length} • Total: {totals.total} • Done: {totals.done} • Overdue: {totals.overdue}
            </div>
          </div>
          <div className="text-xs text-white/60">Show / hide</div>
        </div>
      </summary>

      <div className="px-3 pb-3">
        <div className="text-xs text-white/60">
          Budgeted vs completed uses {period} SA business days (daily = hrs × business days; weekly skips public holidays).
        </div>

        <div className="mt-2 space-y-2">
          {rows.map((r) => {
            const progressPct =
              !r.hoursMissing && r.budgetHours > 0
                ? r.doneHours / r.budgetHours
                : null;

            const budgetSharePct =
              !r.hoursMissing && totalBudgetHours > 0
                ? r.budgetHours / totalBudgetHours
                : null;

            return (
              <details
                key={r.owner}
                className="rounded border border-white/10 bg-black/10 px-3 py-2"
                open={expandedOwners.includes(r.owner)}
                onToggle={(e) => {
                  const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                  onExpandedOwnersChange(
                    isOpen
                      ? Array.from(new Set([...expandedOwners, r.owner]))
                      : expandedOwners.filter((x) => x !== r.owner)
                  );
                }}
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                    <div className="font-semibold">{r.owner}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/70 sm:ml-6">
                      <span>Total: {r.total}</span>
                      <span>Done: {r.done}</span>
                      <span>Overdue: {r.overdue}</span>
                      <span>
                        On-time: {r.onTimePct === null ? "-" : `${Math.round(r.onTimePct * 100)}%`}
                      </span>
                      <span>
                        Budget hrs: {r.hoursMissing ? "Fill hrs" : String(Math.round(r.budgetHours * 10) / 10)}
                      </span>
                      <span>
                        Done hrs: {r.hoursMissing ? "Fill hrs" : String(Math.round(r.doneHours * 10) / 10)}
                      </span>
                      <span>
                        Progress: {progressPct === null ? "-" : `${Math.round(progressPct * 100)}%`}
                      </span>
                      <span>
                        Budget share: {budgetSharePct === null ? "-" : `${Math.round(budgetSharePct * 100)}%`}
                      </span>
                    </div>
                  </div>
                </summary>

                <div className="mt-3 text-sm text-white/80">
                  {r.tasks
                    .slice()
                    .sort((a, b) => a.title.localeCompare(b.title))
                    .map((t) => (
                      <div
                        key={t.id}
                        className="flex items-start justify-between gap-3 border-t border-white/10 py-2"
                      >
                        <div>
                          <div className="font-medium">{t.title}</div>
                          <div className="text-xs text-white/60">
                            {(t.frequency ?? "").toLowerCase()} • {t.status.toLowerCase().replaceAll("_", " ")}
                          </div>
                        </div>
                        <div className="text-xs text-white/60">Hrs: {t.estHoursPm ?? "-"}</div>
                      </div>
                    ))}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </details>
  );
}

type Attachment = {
  id: string;
  taskId: string;
  url: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

const GroupedRows = React.memo(function GroupedRows({
  tasks,
  allTasks,
  period,
  selectedIds,
  setSelectedIds,
  updateTask,
  deleteTask,
  setTasks,
  canEditPromisedDate,
}: {
  tasks: Task[];
  allTasks: Task[];
  period: string;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<boolean>;
  deleteTask: (id: string, title: string) => Promise<void>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  canEditPromisedDate: boolean;
}) { 
  const [savingOwnerIds, setSavingOwnerIds] = useState<Set<string>>(() => new Set());
  const [savedOwnerIds, setSavedOwnerIds] = useState<Set<string>>(() => new Set());
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);

  // Working papers are assumed to be saved in SharePoint (integration TBD).
  // We keep the approval/rework fields; attachment upload/view is disabled for now.
  const [wpTask, setWpTask] = useState<Task | null>(null);
  const [wpLoading] = useState(false);
  const [wpError] = useState<string | null>(null);
  const [wpAttachments] = useState<Attachment[]>([]);
  const [reviewerName, setReviewerName] = useState("Manager");
  const [reviewNotes, setReviewNotes] = useState("");

  const fx = (t: Task) => (t.frequency ?? "").toLowerCase();

  const depOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasks) {
      const title = (t.title ?? "").trim();
      if (title) set.add(title);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allTasks]);

  // (removed) dueByTitle cache (was unused)

  const daily = tasks
    .filter((t) => fx(t) === "daily")
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title));

  const weekly = tasks
    .filter((t) => fx(t) === "weekly")
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title));

  const toTimeSafe = (d: Date | null) => {
    if (!d) return Number.MAX_SAFE_INTEGER;
    const t = d.getTime();
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };

  const monthly = tasks
    .filter((t) => fx(t) === "monthly")
    .slice()
    .sort((a, b) => {
      const da = toTimeSafe(dueDateForKpi(a, period));
      const db = toTimeSafe(dueDateForKpi(b, period));
      if (da !== db) return da - db;

      // When promised dates are identical (common after business-day rollforward),
      // keep the UI feeling ordered by the selected day-of-month.
      const ma = a.monthlyDay ?? 99;
      const mb = b.monthlyDay ?? 99;
      if (ma !== mb) return ma - mb;

      return (a.title ?? "").localeCompare(b.title ?? "");
    });

  const adhoc = tasks
    .filter((t) => {
      const f = fx(t);
      return (
        f === "adhoc" ||
        f === "ad hoc" ||
        f === "ad-hoc" ||
        (!f || !["daily", "weekly", "monthly"].includes(f))
      );
    })
    .slice()
    .sort((a, b) => {
      const da = toTimeSafe(dueDateForKpi(a, period));
      const db = toTimeSafe(dueDateForKpi(b, period));
      if (da !== db) return da - db;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });

  const groups: Array<{ label: string; rows: Task[] }> = [
    { label: "Daily", rows: daily },
    { label: "Weekly", rows: weekly },
    { label: "Adhoc", rows: adhoc },
    { label: "Monthly", rows: monthly },
  ];

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Daily: false,
    Weekly: false,
    Adhoc: false,
    Monthly: true,
  });

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const toggleOne = (id: string, on: boolean) => {
    setSelectedIds((prev) => {
      const s = new Set(prev);
      if (on) s.add(id);
      else s.delete(id);
      return Array.from(s);
    });
  };

  // Working paper viewer removed for now (SharePoint integration TBD).

  const isMonthly = (t: Task) => (t.frequency ?? "").toLowerCase() === "monthly";

  return (
    <>
      {wpTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded border border-white/15 bg-slate-950 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Working papers</div>
                <div className="mt-1 text-xs text-white/60">
                  {wpTask.title} • {wpTask.owner ?? "Unassigned"}
                </div>
              </div>
              <button className="jam-btn h-9" type="button" onClick={() => setWpTask(null)}>
                Close
              </button>
            </div>

            {isMonthly(wpTask) ? (
              <div className="mt-4 rounded border border-white/10 bg-black/10 p-3">
                <div className="text-xs text-white/60">Approval (monthly tasks)</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="text-xs text-white/70">
                    Status: <span className="font-semibold text-white/80">{wpTask.approvalStatus ?? "NOT_SUBMITTED"}</span>
                  </div>
                  <input
                    className="h-9 w-[180px] rounded border border-white/10 bg-black/10 px-2 text-sm"
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                    placeholder="Reviewer"
                  />
                </div>
                <textarea
                  className="mt-2 w-full rounded border border-white/10 bg-black/10 p-2 text-sm"
                  rows={3}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Review notes / changes required…"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="jam-btn jam-btn-primary h-9"
                    type="button"
                    onClick={async () => {
                      await updateTask(wpTask.id, {
                        approvalStatus: "APPROVED",
                        reviewedBy: reviewerName || null,
                        reviewedAt: new Date().toISOString(),
                        reviewNotes: reviewNotes || null,
                      });
                      setWpTask((prev) =>
                        prev
                          ? {
                              ...prev,
                              approvalStatus: "APPROVED",
                              reviewedBy: reviewerName || null,
                              reviewedAt: new Date().toISOString(),
                              reviewNotes: reviewNotes || null,
                            }
                          : prev
                      );
                    }}
                  >
                    Approve
                  </button>
                  <button
                    className="jam-btn h-9"
                    type="button"
                    onClick={async () => {
                      await updateTask(wpTask.id, {
                        approvalStatus: "CHANGES_REQUESTED",
                        reviewedBy: reviewerName || null,
                        reviewedAt: new Date().toISOString(),
                        reviewNotes: reviewNotes || null,
                      });
                      setWpTask((prev) =>
                        prev
                          ? {
                              ...prev,
                              approvalStatus: "CHANGES_REQUESTED",
                              reviewedBy: reviewerName || null,
                              reviewedAt: new Date().toISOString(),
                              reviewNotes: reviewNotes || null,
                            }
                          : prev
                      );
                    }}
                  >
                    Request changes
                  </button>
                  <button
                    className="jam-btn h-9"
                    type="button"
                    onClick={async () => {
                      await updateTask(wpTask.id, {
                        approvalStatus: "SUBMITTED",
                        reviewedBy: null,
                        reviewedAt: null,
                      });
                      setWpTask((prev) =>
                        prev
                          ? {
                              ...prev,
                              approvalStatus: "SUBMITTED",
                              reviewedBy: null,
                              reviewedAt: null,
                            }
                          : prev
                      );
                    }}
                    title="Reset to Submitted"
                  >
                    Mark submitted
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4">
              {wpLoading ? (
                <div className="text-sm text-white/70">Loading…</div>
              ) : wpError ? (
                <div className="text-sm text-red-200/80">{wpError}</div>
              ) : wpAttachments.length === 0 ? (
                <div className="text-sm text-white/60">No working papers uploaded.</div>
              ) : (
                <div className="space-y-2">
                  {wpAttachments.map((a) => (
                    <div
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-black/10 p-2"
                    >
                      <div>
                        <div className="text-sm text-white/85">{a.filename}</div>
                        <div className="text-xs text-white/50">
                          {new Date(a.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <a
                          className="jam-btn h-9"
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {groups.map((g) => (
        <React.Fragment key={g.label}>
          <tr>
            <td className="pt-4 pb-2 text-xs font-semibold text-white/70" colSpan={11}>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-left hover:text-white/90"
                  onClick={() => toggleGroup(g.label)}
                >
                  {g.label}
                  <span className="ml-2 text-white/40">({g.rows.length})</span>
                </button>
                <span className="text-xs text-white/0">.</span>
              </div>
            </td>
          </tr>
          {openGroups[g.label]
            ? g.rows.map((t) => (
                <tr key={t.id} className="border-b border-white/10 align-top">
              <td className="py-2 pr-3">
                <input
                  type="checkbox"
                  aria-label={`Select task ${t.title}`}
                  checked={selected.has(t.id)}
                  onChange={(e) => toggleOne(t.id, e.target.checked)}
                />
              </td>
              <td className="py-2 pr-3">
                <input
                  className="w-full rounded border border-white/10 bg-black/10 px-2 py-1"
                  value={t.owner ?? ""}
                  placeholder="Unassigned"
                  list="owner-datalist"
                  onChange={(e) =>
                    setTasks((prev) =>
                      prev.map((x) =>
                        x.id === t.id ? { ...x, owner: e.target.value } : x
                      )
                    )
                  }
                  onBlur={async (e) => {
                    const next = e.target.value.trim() ? e.target.value : null;

                    // clear any previous "Saved" flash
                    setSavedOwnerIds((prev) => {
                      const s = new Set(prev);
                      s.delete(t.id);
                      return s;
                    });

                    setSavingOwnerIds((prev) => {
                      const s = new Set(prev);
                      s.add(t.id);
                      return s;
                    });

                    const ok = await updateTask(t.id, { owner: next });

                    setSavingOwnerIds((prev) => {
                      const s = new Set(prev);
                      s.delete(t.id);
                      return s;
                    });

                    if (ok) {
                      setSavedOwnerIds((prev) => {
                        const s = new Set(prev);
                        s.add(t.id);
                        return s;
                      });
                      setTimeout(() => {
                        setSavedOwnerIds((prev) => {
                          const s = new Set(prev);
                          s.delete(t.id);
                          return s;
                        });
                      }, 1200);
                    }
                  }}
                />
                <div className="mt-1 text-[11px]">
                  {savingOwnerIds.has(t.id) ? (
                    <span className="text-white/60">Saving…</span>
                  ) : savedOwnerIds.has(t.id) ? (
                    <span className="text-emerald-200/80">Saved</span>
                  ) : (
                    <span className="text-white/0">.</span>
                  )}
                </div>
              </td>
              <td className="py-2 pr-3 relative">
                <textarea
                  rows={2}
                  className="w-full min-w-0 rounded border border-white/10 bg-black/10 px-2 py-1 leading-snug text-white/90 resize-none whitespace-normal break-words focus:absolute focus:left-0 focus:top-0 focus:z-20 focus:w-[640px] focus:bg-black/60 focus:shadow-lg"
                  value={t.title}
                  title={t.title}
                  onChange={(e) =>
                    setTasks((prev) =>
                      prev.map((x) =>
                        x.id === t.id ? { ...x, title: e.target.value } : x
                      )
                    )
                  }
                  onBlur={(e) => void updateTask(t.id, { title: e.target.value })}
                />
              </td>
              <td className="py-2 pr-3">
                {(() => {
                  const g = monthlyGateInfo(t);
                  if (!g) return null;
                  const cls =
                    g.tone === "warn"
                      ? "border-amber-300/40 bg-amber-400/10 text-amber-100"
                      : "border-white/15 bg-black/10 text-white/70";
                  return (
                    <div className="mb-1 inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px]" title={g.title}>
                      <span className={cls + " rounded-full px-1.5 py-0.5"}>{g.label}</span>
                      <span className="text-white/60">Month-end completion gate</span>
                    </div>
                  );
                })()}

                <StatusChips
                  value={t.status}
                  onChange={(v) => {
                    const next = String(v ?? "");

                    if (next === "DONE") {
                      const title = (t.title ?? "").toLowerCase();

                      // Month-end rule: for selected bank rec tasks, require an upload before marking DONE
                      // but only when we're closing the most recent period ("month end window").
                      if (
                        isMonthEndWindow(period) &&
                        isMonthEndBankRecsUploadRequiredTask(t) &&
                        !(t._count?.attachments && t._count.attachments > 0)
                      ) {
                        if (typeof window !== "undefined") {
                          window.alert(
                            `Can't complete "${t.title}" until a working paper is uploaded (month-end only).`
                          );
                        }
                        return;
                      }

                      const isLockPostingPeriods =
                        title.includes("lock") &&
                        title.includes("posting") &&
                        title.includes("period");

                      const isMonthlyGateReport =
                        title.includes("jamieson group monthly reporting model") ||
                        title.includes("monthly management board report pack finalised") ||
                        title.includes("report pack");

                      const isTaxEndTask =
                        title.includes("bas lodgement") ||
                        title.includes("bas reconciliation") ||
                        title.includes("diesel fuel credit") ||
                        title.includes("fbt accrual");

                      // Gate 1: "Lock Posting Periods" cannot be marked DONE until all other monthly tasks are DONE
                      if (isLockPostingPeriods) {
                        const remaining = tasks.filter((x) => {
                          if (x.id === t.id) return false;
                          const f = (x.frequency ?? "").toLowerCase();
                          return f === "monthly" && x.status !== "DONE";
                        });
                        if (remaining.length) {
                          if (typeof window !== "undefined") {
                            window.alert(
                              `Can't complete "${t.title}": ${remaining.length} monthly task(s) still not DONE.`
                            );
                          }
                          return;
                        }
                      }

                      const monthlyRemainingExcludingLockAndTax = () =>
                        tasks.filter((x) => {
                          if (x.id === t.id) return false;
                          const f = (x.frequency ?? "").toLowerCase();
                          if (f !== "monthly") return false;
                          const xt = (x.title ?? "").toLowerCase();

                          const xIsLock =
                            xt.includes("lock") &&
                            xt.includes("posting") &&
                            xt.includes("period");
                          if (xIsLock) return false;

                          const xIsTax =
                            xt.includes("bas lodgement") ||
                            xt.includes("bas reconciliation") ||
                            xt.includes("diesel fuel credit") ||
                            xt.includes("fbt accrual");
                          if (xIsTax) return false;

                          return x.status !== "DONE";
                        });

                      // Gate 2: reporting tasks can't be marked DONE until all other monthly tasks are DONE
                      // (excluding "Lock Posting Periods" + tax end tasks)
                      if (isMonthlyGateReport) {
                        const remaining = monthlyRemainingExcludingLockAndTax();
                        if (remaining.length) {
                          if (typeof window !== "undefined") {
                            window.alert(
                              `Can't complete "${t.title}": ${remaining.length} other monthly task(s) still not DONE (excluding Lock Posting Periods + BAS/DFC/FBT).`
                            );
                          }
                          return;
                        }
                      }

                      // Gate 3: BAS/DFC/FBT tasks can't be marked DONE until all other monthly tasks are DONE
                      // (excluding "Lock Posting Periods" + these tax end tasks)
                      if (isTaxEndTask) {
                        const remaining = monthlyRemainingExcludingLockAndTax();
                        if (remaining.length) {
                          if (typeof window !== "undefined") {
                            window.alert(
                              `Can't complete "${t.title}": ${remaining.length} other monthly task(s) still not DONE (excluding Lock Posting Periods + BAS/DFC/FBT).`
                            );
                          }
                          return;
                        }
                      }
                    }

                    // Prevent starting/completing tasks until all dependencies are DONE
                    if (next === "IN_PROGRESS" || next === "DONE") {
                      const deps = parseDependencies(t.dependency);
                      if (deps.length) {
                        const norm = (s: string) =>
                          s
                            .toLowerCase()
                            .trim()
                            .replace(/\s+/g, " ");

                        const byTitle = new Map(
                          tasks.map((x) => [norm(x.title ?? ""), x])
                        );

                        const isBankRecsEom = (s: string) => {
                          const t = norm(s);
                          return t.includes("bank") && t.includes("recon") && t.includes("eom");
                        };

                        const findBankRecsEom = () =>
                          tasks.find((x) => isBankRecsEom(x.title ?? "")) ?? null;

                        const incomplete = deps
                          .map((dRaw) => {
                            const d = (dRaw ?? "").trim();
                            if (!d) return null;

                            // Exact (normalised) match first
                            const exact = byTitle.get(norm(d));
                            if (exact) return exact.status === "DONE" ? null : d;

                            // Fallback for the special milestone (titles have varied a bit)
                            if (isBankRecsEom(d)) {
                              const t = findBankRecsEom();
                              if (t) return t.status === "DONE" ? null : d;
                            }

                            // If we can't find the dependency task at all, treat as incomplete (safer)
                            return d;
                          })
                          .filter(Boolean) as string[];

                        if (incomplete.length) {
                          if (typeof window !== "undefined") {
                            window.alert(
                              `Can't start this task until dependency is complete: ${incomplete.join(
                                ", "
                              )}`
                            );
                          }
                          return;
                        }
                      }
                    }

                    void updateTask(t.id, { status: v });
                  }}
                />
              </td>
              <td className="py-2 pr-3">
                {((t.frequency ?? "").toLowerCase() === "monthly") ? (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="jam-btn h-8 px-3 text-xs border border-emerald-300/30 text-emerald-100 hover:bg-emerald-500/10"
                        onClick={() =>
                          void updateTask(t.id, {
                            approvalStatus: "APPROVED",
                            reviewedBy: "Manager",
                            reviewedAt: new Date().toISOString(),
                          })
                        }
                        title="Manager confirms working paper has been reviewed"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="jam-btn h-8 px-3 text-xs border border-amber-300/30 text-amber-100 hover:bg-amber-500/10"
                        onClick={() => {
                          const note =
                            typeof window !== "undefined"
                              ? window.prompt(
                                  "What rework/corrections are required?",
                                  t.reviewNotes ?? ""
                                )
                              : null;
                          void updateTask(t.id, {
                            approvalStatus: "CHANGES_REQUESTED",
                            reviewedBy: "Manager",
                            reviewedAt: new Date().toISOString(),
                            reviewNotes: note === null ? (t.reviewNotes ?? null) : note || null,
                          });
                        }}
                        title="Record that rework/corrections are required"
                      >
                        Rework required
                      </button>

                      <button
                        type="button"
                        className="jam-btn h-8 px-3 text-xs border border-red-400/25 text-red-200/80 hover:bg-red-400/10"
                        onClick={() => void deleteTask(t.id, t.title)}
                        title="Delete task"
                      >
                        Delete
                      </button>
                    </div>

                    {(t.frequency ?? "").toLowerCase() === "monthly" ? (
                      <div className="text-[11px] text-white/60">
                        Review: {(t.approvalStatus ?? "NOT_SUBMITTED").replaceAll("_", " ")}
                        {t.reviewedAt
                          ? ` • ${new Date(t.reviewedAt).toLocaleDateString()}`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="jam-btn h-8 px-3 text-xs border border-red-400/25 text-red-200/80 hover:bg-red-400/10"
                      onClick={() => void deleteTask(t.id, t.title)}
                      title="Delete task"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </td>
              <td className="py-2 pr-3 min-w-0">
                <input
                  className="w-full min-w-0 rounded border border-white/10 bg-black/10 px-2 py-1 text-white/90"
                  value={t.estHoursPm ?? ""}
                  placeholder="-"
                  onChange={(e) =>
                    setTasks((prev) =>
                      prev.map((x) =>
                        x.id === t.id ? { ...x, estHoursPm: e.target.value } : x
                      )
                    )
                  }
                  onBlur={(e) =>
                    void updateTask(t.id, { estHoursPm: e.target.value || null })
                  }
                />
              </td>
              <td className="py-2 pr-3 min-w-0">
                {(() => {
                  const deps = parseDependencies(t.dependency);
                  const myDue = dueDateForKpi(t, period);

                  const norm = (s: string) =>
                    s
                      .toLowerCase()
                      .trim()
                      .replace(/\s+/g, " ");

                  const byTitle = new Map(allTasks.map((x) => [norm(x.title ?? ""), x]));

                  const isBankRecsEom = (s: string) => {
                    const t = norm(s);
                    return t.includes("bank") && t.includes("recon") && t.includes("eom");
                  };

                  const findBankRecsEom = () =>
                    allTasks.find((x) => isBankRecsEom(x.title ?? "")) ?? null;

                  const depDues = deps
                    .map((d) => {
                      const dep = (d ?? "").trim();
                      const exact = byTitle.get(norm(dep));
                      if (exact) return { title: d, due: dueDateForKpi(exact, period) };

                      if (isBankRecsEom(dep)) {
                        const t = findBankRecsEom();
                        if (t) return { title: d, due: dueDateForKpi(t, period) };
                      }

                      return { title: d, due: null };
                    })
                    .filter((x) => Boolean(x.due)) as Array<{ title: string; due: Date }>;

                  const latestDep = depDues.sort((a, b) => b.due.getTime() - a.due.getTime())[0];
                  const warn = Boolean(latestDep && myDue && myDue.getTime() < latestDep.due.getTime());

                  const depStatuses = deps.map((d) => {
                    const dep = (d ?? "").trim();
                    const exact = byTitle.get(norm(dep));
                    if (exact) return { title: d, status: exact.status ?? null };

                    if (isBankRecsEom(dep)) {
                      const t = findBankRecsEom();
                      if (t) return { title: d, status: t.status ?? null };
                    }

                    return { title: d, status: null };
                  });

                  const allDone = deps.length > 0 && depStatuses.every((x) => x.status === "DONE");

                  const chipClassFor = (status: string | null) => {
                    if (status === "DONE")
                      return "border-emerald-300/50 bg-emerald-500/15 text-emerald-100";
                    if (status === "IN_PROGRESS")
                      return "border-amber-300/50 bg-amber-500/15 text-amber-100";
                    if (status === "WAITING")
                      return "border-sky-300/40 bg-sky-500/10 text-sky-100";
                    return "border-white/15 bg-black/10 text-white/80";
                  };

                  const statusLabel = (status: string | null) => {
                    if (!status) return "Not found";
                    return status.toLowerCase().replaceAll("_", " ");
                  };

                  return (
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-1">
                        {depStatuses.map((d) => (
                          <button
                            key={d.title}
                            type="button"
                            className={
                              "rounded-full border px-2 py-1 text-xs hover:bg-white/5 " +
                              chipClassFor(d.status)
                            }
                            title={`Dependency status: ${statusLabel(d.status)} (click to remove)`}
                            onClick={() => {
                              const next = deps.filter((x) => x !== d.title);
                              const depStr = stringifyDependencies(next);
                              setTasks((prev) =>
                                prev.map((x) =>
                                  x.id === t.id ? { ...x, dependency: depStr } : x
                                )
                              );
                              void updateTask(t.id, { dependency: depStr });
                            }}
                          >
                            {d.status === "DONE" ? "✓ " : ""}
                            {d.title} <span className="opacity-60">×</span>
                          </button>
                        ))}
                      </div>

                      {allDone ? (
                        <div className="text-[11px] text-emerald-200/90">Unblocked ✓</div>
                      ) : deps.length ? (
                        <div className="text-[11px] text-white/50">
                          Blocked until all dependencies are DONE
                        </div>
                      ) : null}

                      <input
                        className="w-full rounded border border-white/10 bg-black/10 px-2 py-1 text-white/90"
                        placeholder={deps.length ? "Add dependency…" : "-"}
                        list={`dep-datalist-${t.id}`}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const raw = (e.currentTarget.value ?? "").trim();
                          if (!raw) return;
                          const next = Array.from(new Set([...deps, raw]));
                          const depStr = stringifyDependencies(next);
                          setTasks((prev) =>
                            prev.map((x) =>
                              x.id === t.id ? { ...x, dependency: depStr } : x
                            )
                          );
                          void updateTask(t.id, { dependency: depStr });
                          e.currentTarget.value = "";
                        }}
                        onBlur={(e) => {
                          const raw = (e.currentTarget.value ?? "").trim();
                          if (!raw) return;
                          const next = Array.from(new Set([...deps, raw]));
                          const depStr = stringifyDependencies(next);
                          setTasks((prev) =>
                            prev.map((x) =>
                              x.id === t.id ? { ...x, dependency: depStr } : x
                            )
                          );
                          void updateTask(t.id, { dependency: depStr });
                          e.currentTarget.value = "";
                        }}
                      />

                      <datalist id={`dep-datalist-${t.id}`}>
                        {depOptions
                          .filter((x) => x !== t.title)
                          .slice(0, 200)
                          .map((x) => (
                            <option key={x} value={x} />
                          ))}
                      </datalist>

                      {warn && latestDep && myDue ? (
                        <div className="text-[11px] text-amber-200/80">
                          Warning: due {formatAuDate(myDue.toISOString())} is before latest dependency ({latestDep.title}: {formatAuDate(
                            latestDep.due.toISOString()
                          )}).
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </td>
              <td className="py-2 pr-3">
                {(t.frequency ?? "").toLowerCase() === "daily" ? (
                  <div className="text-white/80">{formatSchedule(t) || "-"}</div>
                ) : (t.frequency ?? "").toLowerCase() === "weekly" ? (
                  editingScheduleId === t.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="h-8 rounded border border-white/10 bg-black/10 px-2 text-sm"
                        value={String(t.weeklyDays?.[0] ?? "")}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          void updateTask(t.id, { weeklyDays: [v] });
                        }}
                      >
                        <option value="">Set day…</option>
                        <option value={1}>Monday</option>
                        <option value={2}>Tuesday</option>
                        <option value={3}>Wednesday</option>
                        <option value={4}>Thursday</option>
                        <option value={5}>Friday</option>
                      </select>
                      <input
                        type="time"
                        className="h-8 rounded border border-white/10 bg-black/10 px-2 text-sm"
                        value={t.dailyTime ?? ""}
                        onChange={(e) =>
                          setTasks((prev) =>
                            prev.map((x) =>
                              x.id === t.id ? { ...x, dailyTime: e.target.value } : x
                            )
                          )
                        }
                        onBlur={(e) => {
                          const v = e.target.value?.trim();
                          void updateTask(t.id, { dailyTime: v || null });
                        }}
                      />
                      <button
                        type="button"
                        className="jam-btn h-8 px-3 text-xs"
                        onClick={() => setEditingScheduleId(null)}
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="text-white/80">{formatSchedule(t) || "-"}</div>
                      <button
                        type="button"
                        className="text-xs text-white/60 underline hover:text-white/80"
                        onClick={() => setEditingScheduleId(t.id)}
                      >
                        Edit
                      </button>
                    </div>
                  )
                ) : (t.frequency ?? "").toLowerCase() === "monthly" ? (
                  <div className="space-y-1">
                    {(() => {
                      const due = dueDateForKpi(t, period);
                      const overdue = t.status !== "DONE" && !!due && due.getTime() < Date.now();
                      return (
                        <>
                          <select
                            className={
                              "w-full rounded border px-2 py-1 " +
                              (overdue
                                ? "border-red-300 bg-red-500/35 text-white"
                                : "border-white/10 bg-white text-slate-900")
                            }
                            value={String(t.monthlyDay ?? 7)}
                            disabled={!canEditPromisedDate}
                            title={
                              canEditPromisedDate
                                ? ""
                                : "Promised date is locked (only Kylie and Elton can update)."
                            }
                            onChange={(e) => {
                              if (!canEditPromisedDate) return;
                              const v = Number(e.target.value);
                              // Immediate UI update (then server sync)
                              setTasks((prev) =>
                                prev.map((x) =>
                                  x.id === t.id
                                    ? {
                                        ...x,
                                        monthlyDay: Number.isFinite(v) ? v : x.monthlyDay,
                                        dueAt: null,
                                      }
                                    : x
                                )
                              );
                              void updateTask(t.id, {
                                monthlyDay: Number.isFinite(v) ? v : null,
                                dueAt: null,
                              });
                            }}
                          >
                            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                              <option key={d} value={String(d)}>
                                {d}
                              </option>
                            ))}
                          </select>
                          <div
                            key={`monthlyDue_${t.id}_${period}_${String(t.monthlyDay ?? "")}`}
                            className={
                              "text-[11px] " +
                              (overdue ? "text-red-200/90" : "text-white/50")
                            }
                          >
                            {(() => {
                              const dom = t.monthlyDay ?? 7;

                              // Milestone: bank recs uses its own date rule
                              if (isBankRecsMilestone(t)) {
                                const d = dueDateForKpi(t, period);
                                return d
                                  ? `Milestone → Promised date: ${formatAuDate(d.toISOString())}`
                                  : "";
                              }

                              const d = monthlyDueForPeriodSa(period, dom);
                              if (!d) return "";

                              const unadjusted = new Date(
                                Date.UTC(
                                  Number(period.slice(0, 4)),
                                  Number(period.slice(5, 7)),
                                  dom
                                )
                              );
                              const adjusted = d;
                              const wasAdjusted =
                                unadjusted.toISOString().slice(0, 10) !==
                                adjusted.toISOString().slice(0, 10);

                              return wasAdjusted
                                ? `${dom} (falls on weekend/holiday) → Promised date: ${formatAuDate(adjusted.toISOString())}`
                                : `${dom} → Promised date: ${formatAuDate(adjusted.toISOString())}`;
                            })()}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <input
                    key={`due_${t.id}_${t.updatedAt}`}
                    className={
                      "w-full rounded border px-2 py-1 " +
                      (() => {
                        const due = dueDateForKpi(t, period);
                        const overdue = t.status !== "DONE" && !!due && due.getTime() < Date.now();
                        return overdue
                          ? "border-red-300 bg-red-500/35 text-white placeholder:text-red-100"
                          : "border-white/10 bg-black/10 text-white";
                      })()
                    }
                    defaultValue={formatAuDate(t.dueAt)}
                    placeholder="DD/MM/YYYY"
                    readOnly={!canEditPromisedDate}
                    title={
                      canEditPromisedDate
                        ? ""
                        : "Promised date is locked (only Kylie and Elton can update)."
                    }
                    onBlur={(e) => {
                      if (!canEditPromisedDate) {
                        e.target.value = formatAuDate(t.dueAt);
                        return;
                      }
                      const raw = e.target.value;
                      if (!raw.trim()) {
                        void updateTask(t.id, { dueAt: null });
                        return;
                      }
                      const iso = parseAuDateToIso(raw);
                      if (!iso) {
                        // reset display back to last known value
                        e.target.value = formatAuDate(t.dueAt);
                        return;
                      }
                      void updateTask(t.id, { dueAt: iso });
                    }}
                  />
                )}
              </td>
              <td className="py-2 pr-3">
                {((t.frequency ?? "").toLowerCase() === "daily" ||
                  (t.frequency ?? "").toLowerCase() === "weekly") ? (
                  <div className="text-white/60">-</div>
                ) : (
                  <input
                    key={`eta_${t.id}_${t.updatedAt}`}
                    className="w-full rounded border border-white/10 bg-black/10 px-2 py-1"
                    defaultValue={formatAuDate(t.etaAt)}
                    placeholder="DD/MM/YYYY"
                    onBlur={(e) => {
                      const raw = e.target.value;
                      if (!raw.trim()) {
                        void updateTask(t.id, { etaAt: null });
                        return;
                      }
                      const iso = parseAuDateToIso(raw);
                      if (!iso) {
                        e.target.value = formatAuDate(t.etaAt);
                        return;
                      }
                      void updateTask(t.id, { etaAt: iso });
                    }}
                  />
                )}
              </td>
              <td className="py-2 pr-3">
                <textarea
                  rows={3}
                  className="w-full min-w-0 rounded border border-white/10 bg-black/10 px-2 py-1 text-white/90 leading-snug resize-y"
                  value={t.blocker ?? ""}
                  placeholder="-"
                  onChange={(e) =>
                    setTasks((prev) =>
                      prev.map((x) =>
                        x.id === t.id ? { ...x, blocker: e.target.value } : x
                      )
                    )
                  }
                  onBlur={(e) => void updateTask(t.id, { blocker: e.target.value || null })}
                />
              </td>
            </tr>
              ))
            : null}
        </React.Fragment>
      ))}
    </>
  );
});
