-- AlterTable
ALTER TABLE "public"."Task" ADD COLUMN     "dailyTime" TEXT,
ADD COLUMN     "lastDoneAt" TIMESTAMP(3),
ADD COLUMN     "monthlyDay" INTEGER,
ADD COLUMN     "nextDueAt" TIMESTAMP(3),
ADD COLUMN     "repeatEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weeklyDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
