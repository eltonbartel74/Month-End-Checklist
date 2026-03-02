"use client";

import React, { useEffect, useMemo, useState } from "react";
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
  const [newTitle, setNewTitle] = useState("");
  const [period, setPeriod] = useState("2026-02");
  const [closing, setClosing] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch("/api/tasks", {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }

      const data = (await res.json()) as { tasks: Task[] };
      setTasks(data.tasks);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === "AbortError"
            ? "Timed out loading tasks."
            : e.message
          : "Failed to load tasks.";
      setError(msg);
    } finally {
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

  async function createTask() {
    if (!newTitle.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    setNewTitle("");
    await refresh();
  }

  async function updateTask(id: string, patch: Partial<Task>) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error || `Update failed (${res.status})`);
      return;
    }

    await refresh();
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
            Month End Close Cockpit
          </h1>
          <p className="mt-1 text-white/80">
            Quick status, overdue tasks, and ETAs — without chasing people.
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
      </div>

      <div className="rounded-md border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Tasks</div>
            <div className="mt-1 text-xs text-white/70">
              Tip: keep Due date for “when it should be done”, and ETA for “when
              it will be done”.
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
            <button
              className="jam-btn jam-btn-primary h-10"
              type="button"
              onClick={() => void createTask()}
            >
              New task
            </button>
          </div>
        </div>

        <OwnerKpis tasks={tasks} />

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
              Retry
            </button>
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-white/70">
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
                  <td className="py-3 text-white/70" colSpan={9}>
                    Loading…
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td className="py-3 text-white/70" colSpan={9}>
                    No tasks yet.
                  </td>
                </tr>
              ) : (
                <GroupedRows
                  tasks={tasks}
                  updateTask={updateTask}
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

function dayLabel(n: number) {
  return (
    {
      1: "Mon",
      2: "Tue",
      3: "Wed",
      4: "Thu",
      5: "Fri",
      6: "Sat",
      7: "Sun",
    } as Record<number, string>
  )[n] ?? String(n);
}

function formatSchedule(t: Task) {
  const f = (t.frequency ?? "").toLowerCase();
  if (f === "weekly") {
    const days = (t.weeklyDays ?? []).map(dayLabel).join(", ");
    const time = t.dailyTime ? ` ${t.dailyTime}` : "";
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
  const options: Array<{ v: TaskStatus; label: string; tone: string }> = [
    {
      v: "NOT_STARTED",
      label: "Not started",
      tone: "border-white/15 text-white/80 hover:bg-white/5",
    },
    {
      v: "IN_PROGRESS",
      label: "In progress",
      tone: "border-yellow-400/40 text-yellow-200 hover:bg-yellow-400/10",
    },
    {
      v: "WAITING",
      label: "Waiting",
      tone: "border-sky-400/40 text-sky-200 hover:bg-sky-400/10",
    },
    {
      v: "BLOCKED",
      label: "Blocked",
      tone: "border-red-400/40 text-red-200 hover:bg-red-400/10",
    },
    {
      v: "DONE",
      label: "Done",
      tone: "border-emerald-400/40 text-emerald-200 hover:bg-emerald-400/10",
    },
  ];

  return (
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
              (active ? `bg-white/10 ${o.tone}` : `bg-black/10 ${o.tone}`)
            }
            aria-pressed={active}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function OwnerKpis({ tasks }: { tasks: Task[] }) {
  const rows = useMemo(() => {
    const byOwner = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = (t.owner ?? "").trim() || "Unassigned";
      if (!byOwner.has(key)) byOwner.set(key, []);
      byOwner.get(key)!.push(t);
    }

    const out = Array.from(byOwner.entries()).map(([owner, ts]) => {
      const total = ts.length;
      const done = ts.filter((t) => t.status === "DONE");
      const doneCount = done.length;
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

      const pct = doneWithDue.length ? doneOnTime / doneWithDue.length : null;
      return { owner, total, done: doneCount, overdue, onTimePct: pct };
    });

    out.sort((a, b) => a.owner.localeCompare(b.owner));
    return out;
  }, [tasks]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4 rounded border border-white/10 bg-black/10 p-3">
      <div className="text-sm font-semibold">By owner</div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs text-white/70">
              <th className="py-2 pr-3">Owner</th>
              <th className="py-2 pr-3">Total</th>
              <th className="py-2 pr-3">Done</th>
              <th className="py-2 pr-3">Overdue</th>
              <th className="py-2 pr-3">On-time %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.owner} className="border-b border-white/10">
                <td className="py-2 pr-3">{r.owner}</td>
                <td className="py-2 pr-3">{r.total}</td>
                <td className="py-2 pr-3">{r.done}</td>
                <td className="py-2 pr-3">{r.overdue}</td>
                <td className="py-2 pr-3">
                  {r.onTimePct === null
                    ? "–"
                    : `${Math.round(r.onTimePct * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupedRows({
  tasks,
  updateTask,
  setTasks,
  onUpload,
}: {
  tasks: Task[];
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  onUpload: (taskId: string, file: File) => Promise<void>;
}) {
  const daily = tasks.filter((t) => (t.frequency ?? "").toLowerCase() === "daily");
  const weekly = tasks.filter((t) => (t.frequency ?? "").toLowerCase() === "weekly");
  const monthly = tasks.filter((t) => (t.frequency ?? "").toLowerCase() === "monthly");
  const groups: Array<{ label: string; rows: Task[] }> = [
    { label: "Daily", rows: daily },
    { label: "Weekly", rows: weekly },
    { label: "Monthly", rows: monthly },
  ];

  return (
    <>
      {groups.map((g) => (
        <React.Fragment key={g.label}>
          <tr>
            <td className="pt-4 pb-2 text-xs font-semibold text-white/70" colSpan={9}>
              {g.label}
              <span className="ml-2 text-white/40">({g.rows.length})</span>
            </td>
          </tr>
          {g.rows.map((t) => (
            <tr key={t.id} className="border-b border-white/10 align-top">
              <td className="py-2 pr-3">
                <input
                  className="w-full rounded border border-white/10 bg-black/10 px-2 py-1"
                  value={t.title}
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
                  placeholder="–"
                  onChange={(e) =>
                    setTasks((prev) =>
                      prev.map((x) =>
                        x.id === t.id ? { ...x, owner: e.target.value } : x
                      )
                    )
                  }
                  onBlur={(e) => void updateTask(t.id, { owner: e.target.value || null })}
                />
              </td>
              <td className="py-2 pr-3">
                <StatusChips
                  value={t.status}
                  onChange={(v) => void updateTask(t.id, { status: v })}
                />
              </td>
              <td className="py-2 pr-3">
                <div className="flex items-center gap-2">
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
                {((t.frequency ?? "").toLowerCase() === "weekly" &&
                  t.weeklyDays?.length) ||
                (((t.frequency ?? "").toLowerCase() === "weekly" ||
                  (t.frequency ?? "").toLowerCase() === "daily") &&
                  t.dailyTime) ? (
                  <div className="text-white/80">
                    {formatSchedule(t)}
                  </div>
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
                <input
                  type="date"
                  className="w-full rounded border border-white/10 bg-black/10 px-2 py-1"
                  value={t.etaAt ? t.etaAt.slice(0, 10) : ""}
                  onChange={(e) =>
                    void updateTask(t.id, {
                      etaAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                />
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
