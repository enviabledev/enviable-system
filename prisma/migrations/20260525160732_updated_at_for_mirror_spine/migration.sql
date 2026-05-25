-- Add updatedAt to entities the offline read-mirror needs to key on by
-- date-modified. Three-step per table: add column as nullable so existing
-- rows are accepted; backfill from the most semantic source (own createdAt,
-- parent's createdAt for lines that have no createdAt of their own, or
-- effectiveFrom for the price list); set NOT NULL once every row has a
-- value. The application enforces @updatedAt on subsequent writes (Prisma
-- sets the value, no DB default needed).

-- ----------------------------------------------------------------------
-- invoices.updatedAt (backfill from own createdAt)
-- ----------------------------------------------------------------------
ALTER TABLE "invoices" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "invoices" SET "updatedAt" = "createdAt";
ALTER TABLE "invoices" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ----------------------------------------------------------------------
-- manifest_lines.updatedAt (backfill from parent shipment's createdAt;
-- manifest_lines has no createdAt of its own)
-- ----------------------------------------------------------------------
ALTER TABLE "manifest_lines" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "manifest_lines" AS ml
  SET "updatedAt" = s."createdAt"
  FROM "shipments" AS s
  WHERE ml."shipmentId" = s."id";
ALTER TABLE "manifest_lines" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ----------------------------------------------------------------------
-- payment_methods.updatedAt (backfill from own createdAt)
-- ----------------------------------------------------------------------
ALTER TABLE "payment_methods" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "payment_methods" SET "updatedAt" = "createdAt";
ALTER TABLE "payment_methods" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ----------------------------------------------------------------------
-- payments.updatedAt (backfill from own createdAt)
-- ----------------------------------------------------------------------
ALTER TABLE "payments" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "payments" SET "updatedAt" = "createdAt";
ALTER TABLE "payments" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ----------------------------------------------------------------------
-- price_list_entries.updatedAt (backfill from effectiveFrom, the closest
-- semantic mod-time; PriceListEntry has no createdAt)
-- ----------------------------------------------------------------------
ALTER TABLE "price_list_entries" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "price_list_entries" SET "updatedAt" = "effectiveFrom";
ALTER TABLE "price_list_entries" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ----------------------------------------------------------------------
-- proforma_invoice_lines.updatedAt (backfill from parent PI's createdAt)
-- ----------------------------------------------------------------------
ALTER TABLE "proforma_invoice_lines" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "proforma_invoice_lines" AS pil
  SET "updatedAt" = pi."createdAt"
  FROM "proforma_invoices" AS pi
  WHERE pil."proformaInvoiceId" = pi."id";
ALTER TABLE "proforma_invoice_lines" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ----------------------------------------------------------------------
-- purchase_order_lines.updatedAt (backfill from parent PO's createdAt)
-- ----------------------------------------------------------------------
ALTER TABLE "purchase_order_lines" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "purchase_order_lines" AS pol
  SET "updatedAt" = po."createdAt"
  FROM "purchase_orders" AS po
  WHERE pol."purchaseOrderId" = po."id";
ALTER TABLE "purchase_order_lines" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ----------------------------------------------------------------------
-- sales_order_lines.updatedAt (backfill from parent SO's createdAt)
-- ----------------------------------------------------------------------
ALTER TABLE "sales_order_lines" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "sales_order_lines" AS sol
  SET "updatedAt" = so."createdAt"
  FROM "sales_orders" AS so
  WHERE sol."salesOrderId" = so."id";
ALTER TABLE "sales_order_lines" ALTER COLUMN "updatedAt" SET NOT NULL;
