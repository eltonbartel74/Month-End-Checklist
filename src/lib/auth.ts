import { prisma } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase/server";

export type AuthedUser = {
  email: string;
  role: "MANAGER" | "STAFF";
  ownerNames: string[];
};

export async function requireAuthedUser(): Promise<AuthedUser> {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user?.email) {
    throw new Error("UNAUTHENTICATED");
  }

  const email = data.user.email.toLowerCase();
  const allowed = await prisma.allowedUser.findUnique({ where: { email } });
  if (!allowed || !allowed.active) {
    throw new Error("NOT_ALLOWED");
  }

  return {
    email,
    role: allowed.role,
    ownerNames: allowed.ownerNames,
  };
}

export function ownerMatchesUser(taskOwner: string | null | undefined, u: AuthedUser) {
  const o = (taskOwner ?? "").trim().toLowerCase();
  if (!o) return false;
  if (o === u.email) return true;
  return (u.ownerNames ?? []).some((n) => n.trim().toLowerCase() === o);
}
