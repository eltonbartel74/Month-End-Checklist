import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    // Any authed user can view; if you want manager-only we can lock it down.
    await requireAuthedUser();

    const url = new URL(req.url);
    const period = url.searchParams.get("period");
    const owner = url.searchParams.get("owner"); // filters by task.owner
    const actorEmail = url.searchParams.get("actorEmail");
    const take = Math.min(500, Math.max(1, Number(url.searchParams.get("take") ?? 200)));

    const events = await prisma.auditEvent.findMany({
      where: {
        ...(period ? { period } : {}),
        ...(actorEmail ? { actorEmail } : {}),
        ...(owner
          ? {
              task: {
                owner,
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take,
      include: {
        task: { select: { id: true, title: true, owner: true, period: true } },
      },
    });

    return NextResponse.json({ events });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "UNAUTHENTICATED";
    const status = msg === "NOT_ALLOWED" ? 403 : 401;
    return NextResponse.json({ error: "Not authorised" }, { status });
  }
}
