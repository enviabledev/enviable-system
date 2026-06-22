-- Production launch-readiness data migration (no schema change).
--
-- Why this exists: the variant auto-create work (commit d144c32) attaches every
-- newly discovered variant to a sentinel product, SENTINEL_PRODUCT_ID =
-- 'seed-product-pending-classification'. That product was added to the dev seed
-- only; production was deployed without it (seed-on-deploy was reverted), so any
-- auto-create in production would FK-violate. Separately, production still holds
-- the 5 variant rows under their OLD placeholder SKUs; the dev seed was realigned
-- to the real VSK-format codes but production was never reseeded. This migration
-- closes both gaps.
--
-- Idempotent by construction, safe on every state:
--   * production (sentinel missing, old SKUs)  -> inserts sentinel, realigns SKUs
--   * dev / already-applied (sentinel present, SKUs at target) -> no-op
--   * fresh env, no seed yet (no rows)          -> inserts sentinel, UPDATEs no-op
-- Run twice in succession and the second run changes nothing.
--
-- Audit note: raw SQL bypasses the @Audit interceptor, so these changes do not
-- appear in audit_log_entries. That is correct: an infrastructure data migration
-- is not a user-driven mutation; this migration file IS its trail.
--
-- The sentinel's manufacturerId is left NULL on purpose (the column is nullable).
-- On a fresh `prisma migrate deploy` this migration runs BEFORE any seed, so the
-- seeded manufacturer (seed-cp-tvs) does not yet exist; referencing it would
-- FK-violate. The sentinel only has to exist for the auto-create FK; it needs no
-- manufacturer.

-- 1. Sentinel product for auto-created variants. updatedAt has no DB default
-- (Prisma sets @updatedAt at the app layer), so it is set explicitly here.
INSERT INTO "products" ("id", "name", "category", "createdAt", "updatedAt")
VALUES (
  'seed-product-pending-classification',
  'Pending Classification',
  'PASSENGER',
  NOW(),
  NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- 2. Realign the 5 seeded variant rows to the real VSK-format supplier SKUs.
-- Guarded by id AND a value mismatch so an already-aligned row is a true no-op
-- (no spurious updatedAt bump). updatedAt is advanced on a real change because
-- ProductVariant is a sync-mirrored entity: a raw-SQL UPDATE that does not
-- advance updatedAt is silently invisible to the offline mirror.
UPDATE "product_variants"
SET "supplierSkuCode" = 'TVS KING GS+ DP CKD EXP10 G YELLOW', "updatedAt" = NOW()
WHERE "id" = 'seed-var-gs-gyellow'
  AND "supplierSkuCode" <> 'TVS KING GS+ DP CKD EXP10 G YELLOW';

UPDATE "product_variants"
SET "supplierSkuCode" = 'TVS KING GS+ DP CKD EXP10 ECO GREEN', "updatedAt" = NOW()
WHERE "id" = 'seed-var-gs-ecogreen'
  AND "supplierSkuCode" <> 'TVS KING GS+ DP CKD EXP10 ECO GREEN';

UPDATE "product_variants"
SET "supplierSkuCode" = 'TVS KING GS+ DP CKD EXP10 NEP BLUE', "updatedAt" = NOW()
WHERE "id" = 'seed-var-gs-nepblue'
  AND "supplierSkuCode" <> 'TVS KING GS+ DP CKD EXP10 NEP BLUE';

UPDATE "product_variants"
SET "supplierSkuCode" = 'TVS KING GS+ DP CKD EXP10 NF WINE RED', "updatedAt" = NOW()
WHERE "id" = 'seed-var-gs-winered'
  AND "supplierSkuCode" <> 'TVS KING GS+ DP CKD EXP10 NF WINE RED';

UPDATE "product_variants"
SET "supplierSkuCode" = 'TVS KING ZS+ DP CKD EXP10 G YELLOW', "updatedAt" = NOW()
WHERE "id" = 'seed-var-zs-gyellow'
  AND "supplierSkuCode" <> 'TVS KING ZS+ DP CKD EXP10 G YELLOW';
