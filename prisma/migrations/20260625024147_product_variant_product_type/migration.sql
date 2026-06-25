-- Add ProductType to ProductVariant.
--
-- productType is a REQUIRED column with no default (a variant's wheeler type is
-- an explicit, intrinsic property, never silently assumed). On a non-empty table
-- a bare `ADD COLUMN NOT NULL` would fail, so this runs add-nullable -> backfill
-- -> set NOT NULL. Safe on fresh (the backfill UPDATE touches zero rows), dev,
-- and production (5 seeded TVS King variants plus any auto-created variants on
-- the "Pending Classification" sentinel product).
--
-- Backfill is THREE_WHEELER for EVERY existing variant: all real supply to date
-- is TVS King tricycles, including anything auto-created on the sentinel product
-- (the sentinel concerns PRODUCT classification, not wheeler type, and the
-- auto-create default is likewise THREE_WHEELER). New 2-wheeler variants are
-- created explicitly going forward.

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('TWO_WHEELER', 'THREE_WHEELER');

-- AlterTable: add nullable first so existing rows are accepted.
ALTER TABLE "product_variants" ADD COLUMN "productType" "ProductType";

-- Backfill every existing variant to THREE_WHEELER.
UPDATE "product_variants" SET "productType" = 'THREE_WHEELER' WHERE "productType" IS NULL;

-- Now enforce NOT NULL.
ALTER TABLE "product_variants" ALTER COLUMN "productType" SET NOT NULL;
