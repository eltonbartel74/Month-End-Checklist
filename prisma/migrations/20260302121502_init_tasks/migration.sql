-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'DONE');

-- CreateTable
CREATE TABLE "public"."Task" (
    "id" TEXT NOT NULL,
    "period" TEXT,
    "title" TEXT NOT NULL,
    "owner" TEXT,
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "dueAt" TIMESTAMP(3),
    "etaAt" TIMESTAMP(3),
    "blocker" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
