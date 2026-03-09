import { NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireAuthedUser();
    return NextResponse.json({
      ok: true,
      email: user.email,
      role: user.role,
      ownerNames: user.ownerNames,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "UNAUTHENTICATED";
    const status = msg === "NOT_ALLOWED" ? 403 : 401;
    return NextResponse.json({ error: "Not authorised" }, { status });
  }
}
