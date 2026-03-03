-- CreateEnum
CREATE TYPE "public"."ApprovalStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED');

-- AlterTable
ALTER TABLE "public"."Task" ADD COLUMN     "approvalStatus" "public"."ApprovalStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
ADD COLUMN     "reviewNotes" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;
