import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (!email.endsWith("@jamieson.com.au")) {
    return NextResponse.json({ error: "Use your @jamieson.com.au email" }, { status: 403 });
  }

  const allowed = await prisma.allowedUser.findUnique({ where: { email } });
  if (!allowed || !allowed.active) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, role: allowed.role });
}
