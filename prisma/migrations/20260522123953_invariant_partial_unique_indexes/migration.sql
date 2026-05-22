-- INVARIANT I-5: at most one ACTIVE Proforma Invoice per Purchase Order.
CREATE UNIQUE INDEX one_active_pi_per_po
  ON proforma_invoices ("purchaseOrderId")
  WHERE "status" = 'ACTIVE';

-- INVARIANT I-11: a Unit can be referenced by at most one active Sales Order
-- Line. (Combine with an app-level guard that frees the unit on SO cancel.)
CREATE UNIQUE INDEX one_active_so_line_per_unit
  ON sales_order_lines ("unitId")
  WHERE "unitId" IS NOT NULL;

-- INVARIANT (price): at most one current price per (variant, tier).
CREATE UNIQUE INDEX one_current_price
  ON price_list_entries ("productVariantId", "customerTierId")
  WHERE "effectiveTo" IS NULL;