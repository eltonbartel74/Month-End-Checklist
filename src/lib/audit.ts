import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { UserRole } from "@prisma/client";

export type AuditActor = {
  email: string | null;
  role: UserRole | null;
};

export async function auditEvent(params: {
  action:
    | "TASK_CREATE"
    | "TASK_UPDATE"
    | "TASK_STATUS_CHANGE"
    | "TASK_REVIEW_ACTION"
    | "MONTH_CLOSE"
    | "BULK_ADMIN";
  actor: AuditActor;
  period?: string | null;
  taskId?: string | null;
  summary?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  meta?: Prisma.InputJsonValue;
}) {
  const { action, actor, period, taskId, summary, before, after, meta } = params;

  await prisma.auditEvent.create({
    data: {
      action,
      period: period ?? null,
      taskId: taskId ?? null,
      actorEmail: actor.email ?? null,
      actorRole: actor.role ?? null,
      summary: summary ?? null,
      beforeJson: before === undefined ? undefined : before,
      afterJson: after === undefined ? undefined : after,
      metaJson: meta === undefined ? undefined : meta,
    },
  });
}

export function diffTaskFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[]
) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const f of fields) {
    if (before?.[f] !== after?.[f]) {
      b[f] = (before?.[f] as unknown) ?? null;
      a[f] = (after?.[f] as unknown) ?? null;
    }
  }
  return { before: b, after: a };
}
