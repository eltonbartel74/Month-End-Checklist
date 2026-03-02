export default function Home() {
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
        <div className="flex gap-3">
          <button className="jam-btn jam-btn-primary" type="button">
            New task
          </button>
        </div>
      </div>

      <div className="rounded-md border border-white/10 bg-white/5 p-4">
        <div className="text-sm text-white/80">
          Tonight’s build: Vercel-hosted prototype (separate app) with Jamieson
          styling + shared password.
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Overdue" value="–" />
          <Kpi label="Due next 7 days" value="–" />
          <Kpi label="In progress" value="–" />
          <Kpi label="Done" value="–" />
        </div>
      </div>

      <div className="rounded-md border border-white/10 bg-white/5 p-4">
        <div className="text-sm font-semibold">Tasks</div>
        <div className="mt-2 text-sm text-white/70">
          Next step: add the data model (Vercel Postgres + Prisma) and the task
          table with status/owner/due/ETA.
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
