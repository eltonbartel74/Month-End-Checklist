"use client";

import React, { useMemo, useState } from "react";

type Snapshot = {
  id: string;
  period: string;
  owner: string;
  snapshotAt: string;

  total: number;
  notStarted: number;
  inProgress: number;
  waiting: number;
  blocked: number;

  rework: number;

  dueToDatePct: number | null;
  onTimePct: number | null;

  budgetedHours: number | null;
  completedHours: number | null;
  progressPct: number | null;
  missingHours: number;

  lateOpenCount: number;
  lateDoneCount: number;
  lateAvgDays: number | null;
  lateMaxDays: number | null;
};

type AuditEvent = {
  id: string;
  action: string;
  period: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  summary: string | null;
  createdAt: string;
  task?: { id: string; title: string; owner: string | null; period: string | null } | null;
};

function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Array.from(
    rows.reduce((s, r) => {
      Object.keys(r).forEach((k) => s.add(k));
      return s;
    }, new Set<string>())
  );

  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[\n\r,\"]/g.test(s)) return `"${s.replace(/\"/g, '""')}"`;
    return s;
  };

  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => esc(r[h])).join(","));
  }
  return lines.join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsClient() {
  const [tab, setTab] = useState<"snapshots" | "audit">("snapshots");

  // Snapshots filters
  const [snapPeriod, setSnapPeriod] = useState("");
  const [snapOwner, setSnapOwner] = useState("");
  const [snapTake, setSnapTake] = useState(200);
  const [snapRows, setSnapRows] = useState<Snapshot[]>([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);

  // Audit filters
  const [auditPeriod, setAuditPeriod] = useState("");
  const [auditOwner, setAuditOwner] = useState("");
  const [auditActor, setAuditActor] = useState("");
  const [auditTake, setAuditTake] = useState(200);
  const [auditRows, setAuditRows] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  async function loadSnapshots() {
    setSnapLoading(true);
    setSnapError(null);
    try {
      const url = new URL(window.location.origin + "/api/reports/kpi-snapshot");
      if (snapPeriod.trim()) url.searchParams.set("period", snapPeriod.trim());
      if (snapOwner.trim()) url.searchParams.set("owner", snapOwner.trim());
      url.searchParams.set("take", String(snapTake));

      const res = await fetch(url.toString());
      const data = (await res.json().catch(() => null)) as { snapshots?: Snapshot[]; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || "Failed to load snapshots");
      setSnapRows(data?.snapshots ?? []);
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : "Failed to load snapshots");
    } finally {
      setSnapLoading(false);
    }
  }

  async function loadAudit() {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const url = new URL(window.location.origin + "/api/reports/audit");
      if (auditPeriod.trim()) url.searchParams.set("period", auditPeriod.trim());
      if (auditOwner.trim()) url.searchParams.set("owner", auditOwner.trim());
      if (auditActor.trim()) url.searchParams.set("actorEmail", auditActor.trim());
      url.searchParams.set("take", String(auditTake));

      const res = await fetch(url.toString());
      const data = (await res.json().catch(() => null)) as { events?: AuditEvent[]; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || "Failed to load audit log");
      setAuditRows(data?.events ?? []);
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : "Failed to load audit log");
    } finally {
      setAuditLoading(false);
    }
  }

  const snapCsv = useMemo(() => {
    return toCsv(
      snapRows.map((s) => ({
        snapshotAt: s.snapshotAt,
        period: s.period,
        owner: s.owner,
        total: s.total,
        notStarted: s.notStarted,
        inProgress: s.inProgress,
        waiting: s.waiting,
        blocked: s.blocked,
        rework: s.rework,
        dueToDatePct: s.dueToDatePct === null ? "" : Math.round(s.dueToDatePct * 100),
        onTimePct: s.onTimePct === null ? "" : Math.round(s.onTimePct * 100),
        budgetedHours: s.budgetedHours ?? "",
        completedHours: s.completedHours ?? "",
        progressPct: s.progressPct === null ? "" : Math.round(s.progressPct * 100),
        missingHours: s.missingHours,
        lateOpenCount: s.lateOpenCount,
        lateDoneCount: s.lateDoneCount,
        lateAvgDays: s.lateAvgDays ?? "",
        lateMaxDays: s.lateMaxDays ?? "",
      }))
    );
  }, [snapRows]);

  const auditCsv = useMemo(() => {
    return toCsv(
      auditRows.map((e) => ({
        createdAt: e.createdAt,
        action: e.action,
        period: e.period ?? "",
        actorEmail: e.actorEmail ?? "",
        actorRole: e.actorRole ?? "",
        taskId: e.task?.id ?? "",
        taskTitle: e.task?.title ?? "",
        taskOwner: e.task?.owner ?? "",
        summary: e.summary ?? "",
      }))
    );
  }, [auditRows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          className={"jam-btn h-9 " + (tab === "snapshots" ? "jam-btn-primary" : "")}
          type="button"
          onClick={() => setTab("snapshots")}
        >
          KPI snapshots
        </button>
        <button
          className={"jam-btn h-9 " + (tab === "audit" ? "jam-btn-primary" : "")}
          type="button"
          onClick={() => setTab("audit")}
        >
          Audit log
        </button>
      </div>

      {tab === "snapshots" ? (
        <div className="rounded-md border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <div className="text-xs text-white/60">Period (YYYY-MM)</div>
              <input
                className="h-9 w-[140px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
                value={snapPeriod}
                onChange={(e) => setSnapPeriod(e.target.value)}
                placeholder="2026-02"
              />
            </div>
            <div>
              <div className="text-xs text-white/60">Owner</div>
              <input
                className="h-9 w-[180px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
                value={snapOwner}
                onChange={(e) => setSnapOwner(e.target.value)}
                placeholder="Samantha"
              />
            </div>
            <div>
              <div className="text-xs text-white/60">Rows</div>
              <input
                className="h-9 w-[90px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
                type="number"
                value={snapTake}
                onChange={(e) => setSnapTake(Number(e.target.value))}
              />
            </div>

            <button className="jam-btn jam-btn-primary h-9" type="button" onClick={() => void loadSnapshots()}>
              {snapLoading ? "Loading…" : "Run"}
            </button>

            <button
              className="jam-btn h-9"
              type="button"
              onClick={() => downloadCsv(`kpi-snapshots-${snapPeriod || "all"}.csv`, snapCsv)}
              disabled={!snapRows.length}
            >
              Export CSV
            </button>
          </div>

          {snapError ? <div className="text-sm text-rose-200">{snapError}</div> : null}

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-white/70">
                  <th className="py-2 pr-3">Snapshot</th>
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3">Progress%</th>
                  <th className="py-2 pr-3">Due-to-date%</th>
                  <th className="py-2 pr-3">On-time%</th>
                  <th className="py-2 pr-3">Reworks</th>
                  <th className="py-2 pr-3">Late (open/done)</th>
                  <th className="py-2 pr-3">Late avg/max days</th>
                </tr>
              </thead>
              <tbody>
                {snapRows.map((s) => (
                  <tr key={s.id} className="border-t border-white/10">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(s.snapshotAt).toLocaleString()}</td>
                    <td className="py-2 pr-3">{s.period}</td>
                    <td className="py-2 pr-3">{s.owner}</td>
                    <td className="py-2 pr-3">{s.progressPct === null ? "-" : `${Math.round(s.progressPct * 100)}%`}</td>
                    <td className="py-2 pr-3">{s.dueToDatePct === null ? "-" : `${Math.round(s.dueToDatePct * 100)}%`}</td>
                    <td className="py-2 pr-3">{s.onTimePct === null ? "-" : `${Math.round(s.onTimePct * 100)}%`}</td>
                    <td className="py-2 pr-3">{s.rework}</td>
                    <td className="py-2 pr-3">{s.lateOpenCount}/{s.lateDoneCount}</td>
                    <td className="py-2 pr-3">{s.lateAvgDays === null ? "-" : s.lateAvgDays.toFixed(1)}/{s.lateMaxDays ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <div className="text-xs text-white/60">Period (YYYY-MM)</div>
              <input
                className="h-9 w-[140px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
                value={auditPeriod}
                onChange={(e) => setAuditPeriod(e.target.value)}
                placeholder="2026-02"
              />
            </div>
            <div>
              <div className="text-xs text-white/60">Owner</div>
              <input
                className="h-9 w-[180px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
                value={auditOwner}
                onChange={(e) => setAuditOwner(e.target.value)}
                placeholder="Samantha"
              />
            </div>
            <div>
              <div className="text-xs text-white/60">Actor email</div>
              <input
                className="h-9 w-[220px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
                value={auditActor}
                onChange={(e) => setAuditActor(e.target.value)}
                placeholder="elt@jamieson.com.au"
              />
            </div>
            <div>
              <div className="text-xs text-white/60">Rows</div>
              <input
                className="h-9 w-[90px] rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
                type="number"
                value={auditTake}
                onChange={(e) => setAuditTake(Number(e.target.value))}
              />
            </div>

            <button className="jam-btn jam-btn-primary h-9" type="button" onClick={() => void loadAudit()}>
              {auditLoading ? "Loading…" : "Run"}
            </button>

            <button
              className="jam-btn h-9"
              type="button"
              onClick={() => downloadCsv(`audit-${auditPeriod || "all"}.csv`, auditCsv)}
              disabled={!auditRows.length}
            >
              Export CSV
            </button>
          </div>

          {auditError ? <div className="text-sm text-rose-200">{auditError}</div> : null}

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-white/70">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Task</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3">Actor</th>
                  <th className="py-2 pr-3">Summary</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((e) => (
                  <tr key={e.id} className="border-t border-white/10">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-3">{e.action}</td>
                    <td className="py-2 pr-3">{e.period ?? ""}</td>
                    <td className="py-2 pr-3">{e.task?.title ?? ""}</td>
                    <td className="py-2 pr-3">{e.task?.owner ?? ""}</td>
                    <td className="py-2 pr-3">{e.actorEmail ?? ""}</td>
                    <td className="py-2 pr-3">{e.summary ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
