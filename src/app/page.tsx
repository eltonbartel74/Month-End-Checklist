"use client";

import React, { useEffect, useMemo, useState } from "react";

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
    const overdue = tasks.filter(
      (t) => t.status !== "DONE" && t.dueAt && new Date(t.dueAt).getTime() < now
    ).length;
    const dueNext7 = tasks.filter((t) => {
      if (t.status === "DONE" || !t.dueAt) return false;
      const ms = new Date(t.dueAt).getTime() - now;
      return ms >= 0 && ms <= 7 * 24 * 60 * 60 * 1000;
    }).length;
    const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
    const done = tasks.filter((t) => t.status === "DONE").length;
    return { overdue, dueNext7, inProgress, done };
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
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
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
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Overdue" value={String(kpis.overdue)} />
          <Kpi label="Due next 7 days" value={String(kpis.dueNext7)} />
          <Kpi label="In progress" value={String(kpis.inProgress)} />
          <Kpi label="Done" value={String(kpis.done)} />
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
                  <td className="py-3 text-white/70" colSpan={8}>
                    Loading…
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td className="py-3 text-white/70" colSpan={8}>
                    No tasks yet.
                  </td>
                </tr>
              ) : (
                <GroupedRows tasks={tasks} updateTask={updateTask} setTasks={setTasks} />
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

function GroupedRows({
  tasks,
  updateTask,
  setTasks,
}: {
  tasks: Task[];
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
}) {
  const daily = tasks.filter((t) => (t.frequency ?? "").toLowerCase() === "daily");
  const weekly = tasks.filter((t) => (t.frequency ?? "").toLowerCase() === "weekly");
  const monthly = tasks.filter((t) => (t.frequency ?? "").toLowerCase() === "monthly");
  const other = tasks.filter((t) =>
    !["daily", "weekly", "monthly"].includes((t.frequency ?? "").toLowerCase())
  );

  const groups: Array<{ label: string; rows: Task[] }> = [
    { label: "Daily", rows: daily },
    { label: "Weekly", rows: weekly },
    { label: "Monthly", rows: monthly },
  ];
  if (other.length) groups.push({ label: "Other", rows: other });

  return (
    <>
      {groups.map((g) => (
        <React.Fragment key={g.label}>
          <tr>
            <td className="pt-4 pb-2 text-xs font-semibold text-white/70" colSpan={8}>
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
              <td className="py-2 pr-3 text-white/80">{t.estHoursPm ?? "–"}</td>
              <td className="py-2 pr-3 text-white/80">{t.dependency ?? "–"}</td>
              <td className="py-2 pr-3">
                <input
                  type="date"
                  className="w-full rounded border border-white/10 bg-black/10 px-2 py-1"
                  value={t.dueAt ? t.dueAt.slice(0, 10) : ""}
                  onChange={(e) =>
                    void updateTask(t.id, {
                      dueAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                />
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
