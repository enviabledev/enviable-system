-- Backfill: reclassify completed 3-wheeler units from IN_WAREHOUSE_CBU to
-- IN_WAREHOUSE_SKD (decision option (a), operational coherence with the model
-- that 3-wheelers complete to SKD, not CBU). A SEPARATE migration from the enum
-- addition so it can legally use the new IN_WAREHOUSE_SKD value (Postgres
-- forbids using a new enum value in the transaction that added it).
--
-- Scope: only THREE_WHEELER units currently at IN_WAREHOUSE_CBU. 2-wheelers stay
-- CBU (they genuinely complete to CBU). updatedAt is bumped so the offline mirror
-- surfaces the reclassification. In PRODUCTION this touches ZERO rows (greenfield:
-- no completed 3-wheeler assemblies exist; all historical units are CKD), so it is
-- a no-op there and only affects dev fixtures. This is a data reclassification, not
-- a physical transition, so it writes no StockMovement (a migration is not a
-- runtime unit transition).
UPDATE "units"
SET "status" = 'IN_WAREHOUSE_SKD', "updatedAt" = now()
WHERE "status" = 'IN_WAREHOUSE_CBU'
  AND "productVariantId" IN (
    SELECT "id" FROM "product_variants" WHERE "productType" = 'THREE_WHEELER'
  );
