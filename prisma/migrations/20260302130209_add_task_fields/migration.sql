-- AlterTable
ALTER TABLE "public"."Task" ADD COLUMN     "dependency" TEXT,
ADD COLUMN     "estHoursPm" TEXT,
ADD COLUMN     "frequency" TEXT;
