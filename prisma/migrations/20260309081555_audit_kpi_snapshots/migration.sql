-- CreateEnum
CREATE TYPE "public"."AuditAction" AS ENUM ('TASK_CREATE', 'TASK_UPDATE', 'TASK_STATUS_CHANGE', 'TASK_REVIEW_ACTION', 'MONTH_CLOSE', 'BULK_ADMIN');

-- CreateTable
CREATE TABLE "public"."AuditEvent" (
    "id" TEXT NOT NULL,
    "action" "public"."AuditAction" NOT NULL,
    "period" TEXT,
    "taskId" TEXT,
    "actorEmail" TEXT,
    "actorRole" "public"."UserRole",
    "summary" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."KpiSnapshot" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" INTEGER NOT NULL,
    "notStarted" INTEGER NOT NULL,
    "inProgress" INTEGER NOT NULL,
    "waiting" INTEGER NOT NULL,
    "blocked" INTEGER NOT NULL,
    "rework" INTEGER NOT NULL,
    "dueToDatePct" DOUBLE PRECISION,
    "onTimePct" DOUBLE PRECISION,
    "budgetedHours" DOUBLE PRECISION,
    "completedHours" DOUBLE PRECISION,
    "progressPct" DOUBLE PRECISION,
    "missingHours" INTEGER NOT NULL,
    "lateOpenCount" INTEGER NOT NULL,
    "lateDoneCount" INTEGER NOT NULL,
    "lateAvgDays" DOUBLE PRECISION,
    "lateMaxDays" INTEGER,
    "metaJson" JSONB,

    CONSTRAINT "KpiSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_period_idx" ON "public"."AuditEvent"("period");

-- CreateIndex
CREATE INDEX "AuditEvent_taskId_idx" ON "public"."AuditEvent"("taskId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorEmail_idx" ON "public"."AuditEvent"("actorEmail");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "public"."AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "KpiSnapshot_period_owner_idx" ON "public"."KpiSnapshot"("period", "owner");

-- CreateIndex
CREATE INDEX "KpiSnapshot_snapshotAt_idx" ON "public"."KpiSnapshot"("snapshotAt");

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
