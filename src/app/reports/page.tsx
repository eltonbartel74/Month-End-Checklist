import { requireAuthedUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import ReportsClient from "./reports-client";

export default async function ReportsPage() {
  const user = await requireAuthedUser().catch(() => null);
  if (!user) redirect("/login");
  if (user.role !== "MANAGER") redirect("/");

  return (
    <div className="jam-container space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-white/70 text-sm">
            Manager-only audit log and KPI snapshots (exportable).
          </p>
        </div>
        <Link className="jam-btn h-9" href="/">
          Home
        </Link>
      </div>

      <ReportsClient />
    </div>
  );
}
