"use client";

import React, { useEffect, useMemo, useState } from "react";
import { isBusinessDay, isSaPublicHoliday } from "@/lib/schedule";
import { uploadWorkingPaper } from "@/app/uploadWorkingPaper";

type TaskStatus = "NOT_STARTED" | "IN_PROGRESS" | "WAITING" | "BLOCKED" | "DONE";

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
  updatedAt: string;

  _count?: { attachments: number };
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [period, setPeriod] = useState("2026-02");

  // Filters
  const [filterOwner, setFilterOwner] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterText, setFilterText] = useState<string>("");

  // Bulk reassignment (visible tasks)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOwner, setBulkOwner] = useState("");
  const [closing, setClosing] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);

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
      setError(msg);
    } finally {
      setRetrying(false);
      clearTimeout(t);
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    void refresh();
  }, []);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // keep KPIs reasonably fresh without breaking the React "purity" rule
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const kpis = useMemo(() => {
    const total = tasks.length;
    const doneTasks = tasks.filter((t) => t.status === "DONE");
    const done = doneTasks.length;
    const overdue = tasks.filter(
      (t) => t.status !== "DONE" && t.dueAt && new Date(t.dueAt).getTime() < now
    ).length;
    const dueNext7 = tasks.filter((t) => {
      if (t.status === "DONE" || !t.dueAt) return false;
      const ms = new Date(t.dueAt).getTime() - now;
      return ms >= 0 && ms <= 7 * 24 * 60 * 60 * 1000;
    }).length;
    const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;

    const doneWithDue = doneTasks.filter((t) => Boolean(t.dueAt && t.lastDoneAt));
    const doneOnTime = doneWithDue.filter((t) => {
      // on time if done on/before due date (date-level), not time-of-day strict.
      const dueDay = new Date(t.dueAt!).toISOString().slice(0, 10);
      const doneDay = new Date(t.lastDoneAt!).toISOString().slice(0, 10);
      return doneDay <= dueDay;
    }).length;

    const onTimePct =
      doneWithDue.length === 0 ? null : doneOnTime / doneWithDue.length;

    // Monthly weighted completion by hours
    const monthly = tasks.filter(
      (t) => (t.frequency ?? "").toLowerCase() === "monthly"
    );

    const parseHours = (s: string | null) => {
      if (!s) return null;
      const m = String(s)
        .trim()
        .replace(/hrs?/gi, "")
        .trim();
      const n = Number(m);
      return Number.isFinite(n) ? n : null;
    };

    const monthlyHours = monthly.map((t) => parseHours(t.estHoursPm));
    const monthlyMissingHours = monthlyHours.some((h) => h === null);

    let monthlyWeightedPct: number | null = null;
    if (!monthlyMissingHours && monthly.length > 0) {
      const totalHrs = monthly.reduce(
        (acc, t, i) => acc + (monthlyHours[i] ?? 0),
        0
      );
      const doneHrs = monthly.reduce(
        (acc, t, i) =>
          acc + (t.status === "DONE" ? (monthlyHours[i] ?? 0) : 0),
        0
      );
      monthlyWeightedPct = totalHrs > 0 ? doneHrs / totalHrs : null;
    }

    return {
      total,
      overdue,
      dueNext7,
      inProgress,
      done,
      onTimePct,
      monthlyWeightedPct,
      monthlyMissingHours,
    };
  }, [tasks, now]);

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

  async function createTask() {
    if (!newTitle.trim()) return;

    const owner = newOwner.trim();

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: newTitle.trim(),
        owner: owner ? owner : null,
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error || `Create failed (${res.status})`);
      return;
    }

    setNewTitle("");
    setNewOwner("");
    await refresh();
  }

  async function deleteTask(id: string, title: string) {
    const ok = window.confirm(`Delete task “${title}”? This can’t be undone.`);
    if (!ok) return;

    setError(null);

    // optimistic remove
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setSelectedIds((prev) => prev.filter((x) => x !== id));

    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error || `Delete failed (${res.status})`);
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
    setError(null);

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
      setError(res.error);
      return false;
    }

    // Merge canonical server copy (e.g. rolled fields).
    setTasks((prev) => prev.map((t) => (t.id === id ? res.task : t)));
    return true;
  }

  async function applyBulkOwner(ownerRaw: string) {
    const owner = ownerRaw.trim();
    if (selectedIds.length === 0) return;

    setError(null);

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
        setError(res.error);
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
        setError(data.error || `Month close failed (${res.status})`);
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
            Visibility on finance tasks, owners, and due dates — without chasing people.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
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
        </div>
      </div>

      <div className="rounded-md border border-white/10 bg-white/5 p-4">
        <div className="text-sm text-white/80">KPIs (live)</div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-7">
          <Kpi label="Total" value={String(kpis.total)} />
          <Kpi label="Overdue" value={String(kpis.overdue)} />
          <Kpi label="Due next 7 days" value={String(kpis.dueNext7)} />
          <Kpi label="In progress" value={String(kpis.inProgress)} />
          <Kpi label="Done" value={String(kpis.done)} />
          <Kpi
            label="On-time %"
            value={
              kpis.onTimePct === null
                ? "–"
                : `${Math.round(kpis.onTimePct * 100)}%`
            }
          />
          <Kpi
            label="Monthly % (hrs)"
            value={
              kpis.monthlyMissingHours
                ? "Fill hrs"
                : kpis.monthlyWeightedPct === null
                  ? "–"
                  : `${Math.round(kpis.monthlyWeightedPct * 100)}%`
            }
          />
        </div>

        <OwnerAccordion tasks={tasks} period={period} />
      </div>

      <div className="rounded-md border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Tasks</div>
            <div className="mt-1 text-xs text-white/70">
              Tip: keep Due date for “when it should be done”, and ETA for “when
              it will be done”.
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
            <input
              className="h-10 w-[280px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
              placeholder="New task title…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createTask();
              }}
            />
            <input
              className="h-10 w-[160px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
              placeholder="Owner…"
              value={newOwner}
              list="owner-datalist"
              onChange={(e) => setNewOwner(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createTask();
              }}
            />
            <button
              className="jam-btn jam-btn-primary h-10"
              type="button"
              onClick={() => void createTask()}
            >
              New task
            </button>
          </div>
        </div>

        {/* Owner KPIs moved to KPI section */}

        {error ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
            <div>
              <div className="font-semibold">Couldn’t load tasks</div>
              <div className="text-xs text-red-100/80">{error}</div>
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

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
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
                <th className="py-2 pr-3">Task</th>
                <th className="py-2 pr-3">Owner</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">WP</th>
                <th className="py-2 pr-3">Hrs</th>
                <th className="py-2 pr-3">Dependency</th>
                <th className="py-2 pr-3">Due</th>
                <th className="py-2 pr-3">ETA</th>
                <th className="py-2 pr-3">Comments</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="py-3 text-white/70" colSpan={10}>
                    Loading…
                  </td>
                </tr>
              ) : visibleTasks.length === 0 ? (
                <tr>
                  <td className="py-3 text-white/70" colSpan={10}>
                    No tasks yet.
                  </td>
                </tr>
              ) : (
                <GroupedRows
                  tasks={visibleTasks}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  updateTask={updateTaskOptimistic}
                  deleteTask={deleteTask}
                  setTasks={setTasks}
                  onUpload={async (taskId, file) => {
                    try {
                      setError(null);
                      await uploadWorkingPaper(taskId, file);
                      await refresh();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Upload failed");
                    }
                  }}
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

function isoDayLocal(d: Date) {
  const js = d.getDay(); // 0 Sun .. 6 Sat
  return js === 0 ? 7 : js;
}

function startOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function nextIsoWeekdayLocal(targetIsoDay: number, from = new Date()) {
  const d0 = startOfDayLocal(from);
  const cur = isoDayLocal(d0);
  const delta = (targetIsoDay - cur + 7) % 7; // 0..6
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
      const nextMon = nextIsoWeekdayLocal(1);
      if (isSaPublicHoliday(nextMon)) {
        return `Tuesday${time} (Mon public holiday)`;
      }
      return `Monday${time}`;
    }

    const days = daysRaw.map(dayLabelLong).join(", ");
    return `${days}${time}`;
  }
  if (f === "daily") {
    const time = t.dailyTime ? ` ${t.dailyTime}` : "";
    return `Mon–Fri${time}`;
  }
  return "";
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

  const current = options.find((o) => o.v === value)?.label ?? "–";

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

function OwnerAccordion({ tasks, period }: { tasks: Task[]; period: string }) {
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
      const overdue = ts.filter(
        (t) =>
          t.status !== "DONE" &&
          t.dueAt &&
          new Date(t.dueAt).getTime() < Date.now()
      ).length;

      const doneWithDue = done.filter((t) => Boolean(t.dueAt && t.lastDoneAt));
      const doneOnTime = doneWithDue.filter((t) => {
        const dueDay = new Date(t.dueAt!).toISOString().slice(0, 10);
        const doneDay = new Date(t.lastDoneAt!).toISOString().slice(0, 10);
        return doneDay <= dueDay;
      }).length;
      const onTimePct = doneWithDue.length ? doneOnTime / doneWithDue.length : null;

      // Workload hours/month
      let missingHours = false;
      let hours = 0;

      for (const t of ts) {
        const h = parseHoursMaybe(t.estHoursPm);
        if (h === null) {
          missingHours = true;
          continue;
        }

        const f = (t.frequency ?? "").toLowerCase();
        if (f === "monthly") {
          hours += h;
        } else if (f === "daily") {
          if (bizDays === null) {
            missingHours = true;
          } else {
            hours += h * bizDays;
          }
        } else if (f === "weekly") {
          const occ = countWeekdayOccurrencesInMonthSa(period, t.weeklyDays ?? []);
          if (occ === null) {
            missingHours = true;
          } else {
            hours += h * occ;
          }
        } else {
          // ignore other frequencies in workload calc for now
        }
      }

      return {
        owner,
        tasks: ts,
        total,
        done: done.length,
        overdue,
        onTimePct,
        workloadHours: hours,
        workloadMissing: missingHours,
      };
    });

    owners.sort((a, b) => a.owner.localeCompare(b.owner));
    return owners;
  }, [tasks, period, bizDays]);

  const totalWorkload = rows.reduce(
    (acc, r) => acc + (r.workloadMissing ? 0 : r.workloadHours),
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
    <details className="mt-4 rounded border border-white/10 bg-black/10">
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
          Workload % uses {period} SA business days (daily = hrs × business days; weekly skips public holidays).
        </div>

        <div className="mt-2 space-y-2">
          {rows.map((r) => {
            const workloadPct =
              !r.workloadMissing && totalWorkload > 0
                ? r.workloadHours / totalWorkload
                : null;

            return (
              <details
                key={r.owner}
                className="rounded border border-white/10 bg-black/10 px-3 py-2"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                    <div className="font-semibold">{r.owner}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/70 sm:ml-6">
                      <span>Total: {r.total}</span>
                      <span>Done: {r.done}</span>
                      <span>Overdue: {r.overdue}</span>
                      <span>
                        On-time: {r.onTimePct === null ? "–" : `${Math.round(r.onTimePct * 100)}%`}
                      </span>
                      <span>
                        Workload: {workloadPct === null ? "Fill hrs" : `${Math.round(workloadPct * 100)}%`}
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
                        <div className="text-xs text-white/60">Hrs: {t.estHoursPm ?? "–"}</div>
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

function GroupedRows({
  tasks,
  selectedIds,
  setSelectedIds,
  updateTask,
  deleteTask,
  setTasks,
  onUpload,
}: {
  tasks: Task[];
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<boolean>;
  deleteTask: (id: string, title: string) => Promise<void>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  onUpload: (taskId: string, file: File) => Promise<void>;
}) {
  const [savingOwnerIds, setSavingOwnerIds] = useState<Set<string>>(() => new Set());
  const [savedOwnerIds, setSavedOwnerIds] = useState<Set<string>>(() => new Set());

  const fx = (t: Task) => (t.frequency ?? "").toLowerCase();
  const daily = tasks.filter((t) => fx(t) === "daily");
  const weekly = tasks.filter((t) => fx(t) === "weekly");
  const monthly = tasks.filter((t) => fx(t) === "monthly");
  const adhoc = tasks.filter((t) => {
    const f = fx(t);
    return (
      f === "adhoc" ||
      f === "ad hoc" ||
      f === "ad-hoc" ||
      (!f || !["daily", "weekly", "monthly"].includes(f))
    );
  });

  const groups: Array<{ label: string; rows: Task[] }> = [
    { label: "Daily", rows: daily },
    { label: "Weekly", rows: weekly },
    { label: "Adhoc", rows: adhoc },
    { label: "Monthly", rows: monthly },
  ];

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleOne = (id: string, on: boolean) => {
    setSelectedIds((prev) => {
      const s = new Set(prev);
      if (on) s.add(id);
      else s.delete(id);
      return Array.from(s);
    });
  };

  return (
    <>
      {groups.map((g) => (
        <React.Fragment key={g.label}>
          <tr>
            <td className="pt-4 pb-2 text-xs font-semibold text-white/70" colSpan={10}>
              {g.label}
              <span className="ml-2 text-white/40">({g.rows.length})</span>
            </td>
          </tr>
          {g.rows.map((t) => (
            <tr key={t.id} className="border-b border-white/10 align-top">
              <td className="py-2 pr-3">
                <input
                  type="checkbox"
                  aria-label={`Select task ${t.title}`}
                  checked={selected.has(t.id)}
                  onChange={(e) => toggleOne(t.id, e.target.checked)}
                />
              </td>
              <td className="py-2 pr-3 relative">
                <input
                  className="w-full min-w-0 rounded border border-white/10 bg-black/10 px-2 py-1 overflow-hidden text-ellipsis whitespace-nowrap focus:absolute focus:left-0 focus:top-0 focus:z-20 focus:w-[520px] focus:bg-black/60 focus:shadow-lg"
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

                    // clear any previous “Saved” flash
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
              <td className="py-2 pr-3">
                <StatusChips
                  value={t.status}
                  onChange={(v) => void updateTask(t.id, { status: v })}
                />
              </td>
              <td className="py-2 pr-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[18px] text-white/70">
                    {t._count?.attachments ? String(t._count.attachments) : "0"}
                  </span>
                  <label className="jam-btn jam-btn-primary h-8 px-3 text-xs">
                    Upload
                    <input
                      type="file"
                      className="hidden"
                      accept="application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          await onUpload(t.id, f);
                        } finally {
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    className="jam-btn h-8 px-3 text-xs border border-red-400/25 text-red-200/80 hover:bg-red-400/10"
                    onClick={() => void deleteTask(t.id, t.title)}
                    title="Delete task"
                  >
                    Delete
                  </button>
                </div>
              </td>
              <td className="py-2 pr-3">
                <input
                  className="w-[90px] rounded border border-white/10 bg-black/10 px-2 py-1 text-white/90"
                  value={t.estHoursPm ?? ""}
                  placeholder="–"
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
              <td className="py-2 pr-3 text-white/80">{t.dependency ?? "–"}</td>
              <td className="py-2 pr-3">
                {(t.frequency ?? "").toLowerCase() === "daily" ? (
                  <div className="text-white/80">{formatSchedule(t) || "–"}</div>
                ) : (t.frequency ?? "").toLowerCase() === "weekly" ? (
                  (t.weeklyDays?.length || t.dailyTime) ? (
                    <div className="text-white/80">{formatSchedule(t) || "–"}</div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="h-8 rounded border border-white/10 bg-black/10 px-2 text-sm"
                        defaultValue={""}
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
                        onBlur={(e) => {
                          const v = e.target.value?.trim();
                          if (!v) return;
                          void updateTask(t.id, { dailyTime: v });
                        }}
                      />
                    </div>
                  )
                ) : (
                  <input
                    type="date"
                    className="w-full rounded border border-white/10 bg-black/10 px-2 py-1"
                    value={t.dueAt ? t.dueAt.slice(0, 10) : ""}
                    onChange={(e) =>
                      void updateTask(t.id, {
                        dueAt: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      })
                    }
                  />
                )}
              </td>
              <td className="py-2 pr-3">
                {((t.frequency ?? "").toLowerCase() === "daily" ||
                  (t.frequency ?? "").toLowerCase() === "weekly") ? (
                  <div className="text-white/60">–</div>
                ) : (
                  <input
                    type="date"
                    className="w-full rounded border border-white/10 bg-black/10 px-2 py-1"
                    value={t.etaAt ? t.etaAt.slice(0, 10) : ""}
                    onChange={(e) =>
                      void updateTask(t.id, {
                        etaAt: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      })
                    }
                  />
                )}
              </td>
              <td className="py-2 pr-3">
                <input
                  className="w-full rounded border border-white/10 bg-black/10 px-2 py-1"
                  value={t.blocker ?? ""}
                  placeholder="–"
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
          ))}
        </React.Fragment>
      ))}
    </>
  );
}
