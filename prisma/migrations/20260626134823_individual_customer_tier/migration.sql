-- Add the Individual customer tier and backfill existing END_USER customers that
-- have no tier. This closes the gap where END_USER (individual) customers were
-- dead-end records: creatable, but unsaleable because SO creation hard-requires a
-- tier and only the two reseller tiers existed.
--
-- Idempotent and safe on fresh, dev, and production. Pre-deploy snapshot required.
-- The tier upsert is ON CONFLICT DO NOTHING on the fixed id; the backfill only
-- touches END_USER rows that are still null-tiered, so a re-run is a no-op.
--
-- NO Individual price-list entries are created here, by design: individual prices
-- are set explicitly via the price-list UI, preserving the "no PriceListEntry =
-- no sale" semantic that already applies to every tier.

-- 1. Seed the Individual tier (fixed id matching the seed-id convention used for
--    counterparties/products). createdAt/updatedAt are NOT NULL with no DB
--    default on this table, so set them explicitly.
INSERT INTO "customer_tiers" ("id", "name", "description", "status", "createdAt", "updatedAt")
VALUES (
  'seed-tier-individual',
  'Individual',
  'Retail/walk-in individual customers.',
  'ACTIVE',
  NOW(),
  NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- 2. Backfill existing END_USER customers with no tier onto the Individual tier.
--    The updatedAt bump matters: Customer is sync-mirrored, so without it the
--    backfilled assignment would be invisible to offline mirrors.
UPDATE "customers"
SET "tierId" = 'seed-tier-individual', "updatedAt" = NOW()
WHERE "type" = 'END_USER' AND "tierId" IS NULL;
