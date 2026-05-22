# Enviable Inventory & Operations System: Database Schema and Seed

This is the database layer for the MVP: the Prisma schema (translated from the
Domain Model v1.0) and the seed script that populates the fixed reference data.

## Files

- `prisma/schema.prisma`: 50 models, 37 enums. Validated with `prisma validate`.
- `prisma/seed.ts`: idempotent seed (permissions, roles, grants, users, products,
  variants, tiers, prices, payment methods, warehouse, feature toggles).

## Setup (local)

```bash
npm install prisma @prisma/client
# add ts-node for running the TypeScript seed
npm install -D ts-node typescript @types/node

# .env with a real DATABASE_URL pointing at a running Postgres
# (Docker example using a non-default host port to avoid clashes:)
#   DATABASE_URL="postgresql://enviable_app:password@localhost:5433/enviable?schema=public"

npx prisma format
npx prisma validate
npx prisma migrate dev --name init   # creates tables + first migration
npx prisma generate                  # auto-run by migrate dev
```

## Running the seed

Wire the seed into `package.json` so `prisma db seed` finds it:

```json
{
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  }
}
```

Then:

```bash
npx prisma db seed
```

The seed is idempotent: every insert is an upsert keyed on a natural unique
field, so re-running updates rather than duplicates. Safe to run after each
schema change.

> User passwords are NOT set by the seed. Every seeded user gets a placeholder
> hash that cannot authenticate. Set real passwords (IT-Admin-led, per the
> Decisions Log) or run a first-login reset flow before go-live.

## Invariants requiring raw-SQL migrations

Several Domain Model invariants cannot be expressed in Prisma's schema language.
Add them as raw SQL in a follow-up migration:

```bash
npx prisma migrate dev --create-only --name invariant_partial_unique_indexes
# then hand-edit the generated migration.sql with the statements below
npx prisma migrate dev   # applies pending migrations
```

> IMPORTANT: column names in raw SQL are quoted camelCase, NOT snake_case.
> Prisma's `@@map` renames only the table, not the columns (no per-field `@map`
> was used). The column names below match the generated init migration exactly.

```sql
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
```

### Deferred to a role-separation (production-hardening) migration

The immutability REVOKEs require a dedicated, non-owner application role
(`enviable_app`) that the app connects as. They have NO effect while the app
connects as the database owner (the owner can always re-grant to itself), so
they are pointless on a local single-user database. Add them when you set up
the production role separation:

```sql
-- Create the restricted application role first, then:
REVOKE UPDATE, DELETE ON period_snapshots FROM enviable_app;       -- I-9
REVOKE UPDATE, DELETE ON stock_valuation_lines FROM enviable_app;  -- I-9
REVOKE UPDATE, DELETE ON audit_log_entries FROM enviable_app;      -- I-10
```

## Invariants enforced in application code (NestJS service layer)

These need transactional logic, not database constraints:

- I-2 / I-3: atomic unit state transition + stock movement write (one transaction).
- I-4: confirmed payments >= sales order total before RELEASE_AUTHORISED.
- I-6: auto-transition PO to FULLY_RECEIVED when received == ordered.
- I-7: block shipment CLOSED until variances resolved.
- I-8: hide landedCost and cost-derived fields from sales-staff responses
  (the costdata.view permission gates this; RLS is the backstop).
- I-13: permission evaluation as the union of the user's role permissions.
- I-14: feature-toggle changes write audit entries.
- I-15: returns only on units in SOLD_AS_CKD or SOLD_AS_CBU.

## Seeded data summary

- 49 permissions across Procurement, Inventory, Assembly, Sales, Sensitive,
  Reporting, Admin.
- 14 roles, from Managing Director down to IT Admin, each with a curated grant.
  IT Admin holds every permission.
- 5 users (the four named stakeholders plus a System Administrator), with role
  assignments and the known reporting hierarchy (GM and EA report to ED;
  Warehouse Manager reports to GM).
- 2 products (TVS King GS+, TVS King ZS+) and their 5 variants from PI
  ORD0000023649, with structured attributes and market prices.
- 2 customer tiers (ResellerStandard, ResellerVolume) and a current price per
  variant per tier.
- 2 payment methods (Bank Transfer active; POS Terminal placeholder).
- 1 warehouse (Lagos Main).
- 3 feature toggles (discount threshold off, retail POS off, multi-warehouse off).

> Prices in the seed are illustrative starting values. The Sales Manager
> confirms real tier prices before go-live (MVP prerequisite P-4).

## Next steps

1. Apply the invariant migration above.
2. Run the seed.
3. Scaffold the NestJS modules around the generated client: start with Identity
   & Access (the auth guard, RBAC RequirePermissions guard, and the audit
   interceptor), then the domain modules.
