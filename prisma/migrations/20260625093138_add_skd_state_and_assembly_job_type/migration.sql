-- Structural changes for the SKD unit state and the SKD -> CBU assembly upgrade.
-- This migration only ADDS the IN_WAREHOUSE_SKD enum value and does NOT use it
-- in any DML: Postgres forbids using a newly added enum value in the same
-- transaction that added it, so the data backfill that sets units to
-- IN_WAREHOUSE_SKD lives in the FOLLOWING migration (a separate transaction).
-- Safe and idempotent on fresh, dev, and production.

-- CreateEnum
CREATE TYPE "AssemblyJobType" AS ENUM ('CKD_TO_ASSEMBLED', 'SKD_TO_CBU');

-- AlterEnum: add the SKD warehouse state (idempotent).
ALTER TYPE "UnitStatus" ADD VALUE IF NOT EXISTS 'IN_WAREHOUSE_SKD';

-- AssemblyJob.jobType: existing rows backfill to CKD_TO_ASSEMBLED via the
-- column default (they were all original kit assemblies).
ALTER TABLE "assembly_jobs" ADD COLUMN "jobType" "AssemblyJobType" NOT NULL DEFAULT 'CKD_TO_ASSEMBLED';

-- A unit may now have multiple jobs over its lifetime (original assembly, then a
-- later SKD -> CBU upgrade), so drop the full unique on unitId and replace it
-- with a partial unique that enforces "at most one IN_PROGRESS job per unit".
DROP INDEX "assembly_jobs_unitId_key";
CREATE INDEX "assembly_jobs_unitId_idx" ON "assembly_jobs"("unitId");
CREATE UNIQUE INDEX "assembly_jobs_unitId_in_progress_key"
  ON "assembly_jobs"("unitId")
  WHERE "status" = 'IN_PROGRESS';
