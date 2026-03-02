"use client";

import { useEffect, useMemo, useState } from "react";

type TaskStatus = "NOT_STARTED" | "IN_PROGRESS" | "WAITING" | "BLOCKED" | "DONE";

type Task = {
  id: string;
  title: string;
  owner: string | null;
  status: TaskStatus;
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

  async function refresh() {
    setLoading(true);
    const res = await fetch("/api/tasks", { cache: "no-store" });
    const data = (await res.json()) as { tasks: Task[] };
    setTasks(data.tasks);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const now = Date.now();
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

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-white/70">
                <th className="py-2 pr-3">Task</th>
                <th className="py-2 pr-3">Owner</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Due</th>
                <th className="py-2 pr-3">ETA</th>
                <th className="py-2 pr-3">Blocker</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="py-3 text-white/70" colSpan={6}>
                    Loading…
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td className="py-3 text-white/70" colSpan={6}>
                    No tasks yet.
                  </td>
                </tr>
              ) : (
                tasks.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-white/10 align-top"
                  >
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
                        onBlur={(e) =>
                          void updateTask(t.id, { owner: e.target.value || null })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="w-full rounded border border-white/10 bg-black/10 px-2 py-1"
                        value={t.status}
                        onChange={(e) =>
                          void updateTask(t.id, {
                            status: e.target.value as TaskStatus,
                          })
                        }
                      >
                        <option value="NOT_STARTED">Not started</option>
                        <option value="IN_PROGRESS">In progress</option>
                        <option value="WAITING">Waiting</option>
                        <option value="BLOCKED">Blocked</option>
                        <option value="DONE">Done</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
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
                    </td>
                    <td className="py-2 pr-3">
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
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="w-full rounded border border-white/10 bg-black/10 px-2 py-1"
                        value={t.blocker ?? ""}
                        placeholder="–"
                        onChange={(e) =>
                          setTasks((prev) =>
                            prev.map((x) =>
                              x.id === t.id
                                ? { ...x, blocker: e.target.value }
                                : x
                            )
                          )
                        }
                        onBlur={(e) =>
                          void updateTask(t.id, { blocker: e.target.value || null })
                        }
                      />
                    </td>
                  </tr>
                ))
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
