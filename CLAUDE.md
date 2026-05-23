# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Enviable Inventory & Operations System

Internal back-office system for Enviable Tricycle Auto Parts Ltd, a Nigerian
company that imports TVS King tricycles (locally "keke") as CKD kits, stores and
optionally assembles them, and sells to resellers. This repo is the backend API
plus (later) the web frontend.

## Project conventions

- **Never use em dashes** anywhere: code, comments, docs, commit messages.
- TypeScript everywhere, strict mode on. No `any` unless unavoidable and commented.
- No secrets in the repo. Use `.env` (gitignored); document new vars in `.env.example`.
- Conventional Commits for commit messages.
- Keep modules cohesive: one NestJS module per domain area, clear boundaries.

## Stack (locked)

- Backend: NestJS 10, TypeScript, Node 22 LTS.
- ORM: Prisma 6 (do NOT upgrade to 7; `package.json#prisma` deprecation warning
  is known and deferred).
- DB: PostgreSQL 16, local via Docker on host port 5433 (5432 is used by an
  unrelated container).
- Auth: session cookies via express-session + @nestjs/passport style, argon2id
  hashing. NOT Better-auth, NOT JWT. (Deliberate deviation from the Tech Stack
  doc, which named Better-auth; session cookies are the lower-friction fit for a
  pure NestJS API and deliver the same architecture.)
- Validation: class-validator + class-transformer via the global ValidationPipe.
- Frontend (later): Next.js 15 App Router, PWA, offline-tolerant (Level 1.5).
- Hosting (later): Fly.io Frankfurt, Aiven Postgres, Upstash Redis, Cloudflare R2,
  SendGrid. Cost-conscious posture.

## Architecture rules

- **Auth then RBAC**: global AuthGuard runs first (attaches `req.user`), then
  global PermissionsGuard enforces `@RequirePermissions(...)`.
- **Permissions are the union** of a user's roles' permissions, computed once at
  login and stored in the session. No deny-list. (Invariant I-13.)
- **Every mutation is audited** via the global AuditInterceptor on `@Audit(...)`
  annotated handlers. Reads are not audited (except the one demo endpoint).
- **`@CurrentUser()` only where a handler writes an actor column** (e.g.
  `approvedById`, `assembledById`, `cancelledById`, a movement's `actorId`). The
  AuditInterceptor already captures the actor from `req.user` for every audited
  mutation, so do not inject the principal just to "have" the actor. Inject it
  where it is used; rely on the interceptor everywhere else.
- **Audit log and period snapshots are immutable** (Invariants I-9, I-10): create
  only, never update or delete.
- **Every Unit state change writes a StockMovement in the same transaction**
  (Invariant I-3). There is no way to change unit state without a movement.
- **Sales staff never see cost or landed-cost data** (Invariant I-8): gated by the
  `costdata.view` permission, which Sales Officer roles do not hold. The
  `CostVisibilityInterceptor` strips `landedCost` from response bodies for
  callers lacking the permission. **The audit log keeps the full response**
  (cost data included): the audit captures what the system computed, not what
  a particular caller saw. Privacy of cost data in audit rows is achieved by
  gating who can read the audit log, not by sanitising the rows at write time.
- **Build for scale, ship for one**: data model supports multi-warehouse and
  configurable rules, but those features stay off at MVP. Additive later, not a
  rewrite.
- Any value written to a Prisma JSON column must be typed `Prisma.InputJsonValue`,
  never `Record<string, unknown>` (Prisma rejects the latter).

## Database layer (DONE, do not modify under prisma/)

- `prisma/schema.prisma`: 50 models, 37 enums, validated and migrated.
- Migrations applied, including partial unique indexes for invariants I-5, I-11,
  and the one-current-price-per-variant-tier rule.
- `prisma/seed.ts`: idempotent. Seeded 49 permissions, 14 roles, 5 users, 2
  counterparties (TVS manufacturer, VSK supplier), 2 products + 5 variants from
  the real PI, 2 customer tiers, 10 price list entries, 2 payment methods, 1
  warehouse, 3 feature toggles.
- Raw-SQL column names are quoted camelCase (e.g. `"purchaseOrderId"`), NOT
  snake_case. `@@map` renames tables only, not columns.
- Seeded users have a non-authenticating placeholder password hash. Use
  `scripts/set-password.ts` to set a real one before logging in.
- The REVOKE-based immutability statements are deferred until a non-owner
  `enviable_app` DB role exists; they do nothing while connected as the owner.

## Key invariants enforced in the service layer (not the DB)

- I-2/I-3: atomic unit state transition + movement.
- I-4: confirmed payments >= sales order total before RELEASE_AUTHORISED.
- I-6: PO auto-transitions to FULLY_RECEIVED when received == ordered.
- I-7: shipment cannot close with unresolved variances.
- I-8: hide cost data from sales staff.
- I-13: permission union, no deny-list.
- I-14: feature-toggle changes write audit entries.
- I-15: returns only on units in SOLD_AS_CKD or SOLD_AS_CBU.

## Domain model essentials

- A keke is a serialized **Unit** (unique engineNumber + chassisNumber, both
  supplied by TVS, captured at manifest receipt). The system never reasons in
  bare quantities for kekes; always specific Units.
- Procurement chain: internal PO (1:1 with a TVS portal order) -> Proforma
  Invoice from VSK (revisions supported, one ACTIVE at a time) -> Shipment(s)
  (partial shipments allowed) -> manifest receipt -> Units created.
- Two sale paths: CKD (kit sold as-is to a dealer) and CBU (assembled in-house
  first). One SalesOrderLine = one Unit.
- Spare parts are quantity-tracked, received and stored only (no sale at MVP).
- Assembly consumes nothing external; CKD kits are self-contained (no bill of
  materials).
- Money is always `Decimal(18,2)` with a separate currency column. Never Float.
- Internal IDs are cuid(); human-facing identifiers (engineNumber, poNumber,
  soNumber, invoiceNumber) are separate unique columns.

## MVP scope boundaries

IN: procurement + stock-in, historical data load, inventory + movements,
assembly, warehouse-to-reseller sales, payment recording (bank transfer; manual
confirm), documents, audit log, four reports, RBAC with a fixed seeded role set.

OUT (deferred): retail POS, configurable approval-rule and RBAC admin UIs,
returns workflow, period-snapshot lock UI, POS webhook integration, multi-payment
per order, credit sales, spare-parts sale, inter-warehouse transfers, offline
sync UI, mobile-native. Build the data model so these are additive later.

## Build sequence (milestones)

- M0 Foundation: schema + migrations + seed. DONE.
- M1 Spine: auth + RBAC guard + audit interceptor + proof-of-chain endpoint. DONE.
- M2 Procurement + stock-in (incl. Historical Data Load tool). DONE.
- M3 Inventory + assembly. DONE.
- M4 Sales: customers + pricing + SO lifecycle + invoicing + payments +
  release authorisation + delivery + returns + cancel. DONE.
- M5 Reporting + offline sync + observability + production hardening +
  acceptance sign-off. The final milestone. Covers:
  - The four MVP reports.
  - Offline sync layer: wire endpoints over the existing schema scaffolding
    (`IdRangeAllocation`, `ConflictReviewItem`, `ProcessedSyncAction`, and
    the `clientId` fields scattered through transactional models).
  - Observability: structured logging, request IDs, basic metrics.
  - Production hardening: pulls in every entry from the
    `Deferred / hardening backlog` section below (session fixation, the
    `rolling + resave` Redis interaction, the audit/period-snapshot/stock-
    valuation `REVOKE` once a non-owner `enviable_app` role exists, the
    advisory-lock ID-generator concurrency test) plus the VAT rounding
    decision called out there.
  - Acceptance sign-off.

Every controller hangs off three patterns: `@RequirePermissions(...)`,
`@CurrentUser()`, `@Audit(action, entityType)`.

## Commands

- `npm run start:dev` to run the API (global prefix `/api`).
- `npm run build` / `npm run typecheck` to compile / typecheck.
- `npx prisma migrate dev` to apply migrations.
- `npx prisma db seed` to run the idempotent seed.
- `npm run set-password -- <email> <password>` to set a real password.

## Deferred / hardening backlog

These are real, accepted issues parked for later. Do not lose them.

- **Session fixation (M5)**: login should call `req.session.regenerate()` before
  storing the principal, to stop an attacker pre-planting a session ID. Not yet
  done. Land it with the M5 hardening pass.
- **rolling + resave interaction (M5)**: `rolling: true` with `resave: false`
  may not slide store-side expiry once a real session store is used. Moot with
  the in-memory dev store. Revisit when Upstash Redis sessions are wired in M5.
- **ID generators under concurrency (M5)**: `poNumber` and `shipmentReference`
  use `pg_advisory_xact_lock` keyed on distinct constants; correct by
  construction but not verified under contention. Add a focused concurrency
  test before production cutover.
- **Audit-table DB immutability (DONE)**: the `enviable_app` non-owner role and
  the REVOKE UPDATE/DELETE/TRUNCATE on `audit_log_entries`, `period_snapshots`,
  and `stock_valuation_lines` are implemented in migration
  `20260523000000_database_level_immutability`, plus a block-only trigger
  (`enviable_block_immutable_mutation`) on all three that RAISEs on UPDATE/DELETE
  as defence in depth behind the REVOKE. Two layers, each doing one thing: REVOKE
  denies the non-owner app (permission denied before any trigger), the trigger
  denies absolutely (fires for every role, including the owner). No dblink, no
  autonomous-commit logging in the trigger (that approach was considered and
  rejected: a security-critical block must not depend on runtime dblink config,
  and the block, not the log, is the load-bearing guarantee). Migrations still
  run as the OWNER (a non-owner cannot create tables); only the app RUNTIME
  connects as `enviable_app`. Local dev may keep connecting as the owner (the
  REVOKEs simply do not bite on a single-user dev DB); production points
  `DATABASE_URL` at `enviable_app`. The operator sets the role password out of
  band (never committed). REMAINING (deferred, application layer): RECORDING a
  blocked attempt as a `DELETE_BLOCKED` audit entry. When a mutation is rejected,
  the app should catch the error and write a `DELETE_BLOCKED` entry via the
  normal `AuditService.write` INSERT path (a separate, cleanly committing
  transaction that carries the request context the DB trigger lacks). Slot this
  into the observability/error-handling work, not the database.
- **Per-line vs per-invoice VAT rounding (M5, go-live prerequisite)**:
  current implementation rounds VAT once at the order level
  (`(subtotal - discountTotal) * 0.075` to 2dp). Per-line rounded VAT can
  produce a different total by a few kobo when discounts vary across lines.
  Confirm which convention matches the FIRS rule and the customer-facing
  invoice expectation before go-live, align the computation, and add a
  regression test that pins the chosen behaviour.
- **PI totalValue is the all-in CIF figure (go-live confirm)**: a Proforma
  Invoice's `totalValue` is computed as goods + freightAmount + insuranceAmount
  (what is owed the supplier), with freight and insurance also stored in their
  own columns. Landed cost (M2 Prompt 6) separately tracks FREIGHT and
  MARINE_INSURANCE components allocated to units. Before go-live, confirm with
  whoever reconciles supplier invoices whether the landed-cost FREIGHT/
  MARINE_INSURANCE components should EXCLUDE what the PI total already carries,
  so freight/insurance is not double-counted when reconciling paid-vs-costed.
  Likely answer: PI total is the AP figure (CIF owed to supplier), landed cost
  re-states freight/insurance plus the Nigeria-side costs (customs, port,
  clearing, inland) for unit costing, a different purpose, so the overlap is
  intentional, not a bug. Decide deliberately and pin it.
- **Historical bulk load is non-atomic across batches (go-live operations)**:
  the historical unit load validates all-or-nothing pre-commit, but writes in
  500-units-per-transaction batches (a single tx for a multi-thousand-unit load
  would hold a very long lock). If the real go-live load fails mid-stream,
  earlier batches are already persisted. Recovery is NOT a naive re-run of the
  same file (the against-DB duplicate check would reject the already-loaded
  engine/chassis numbers and fail the whole file). Re-run with the already-
  loaded rows removed, or add a skip-present resumption mode before the real
  ~2000-unit load. Operational runbook note, not a code change yet.
- **Dry-run audit rows share the commit action name**: the historical-load
  endpoints audit both dry-runs and commits (a dry-run of a bulk import is an
  operationally significant event; "dry-run writes nothing" is a guarantee
  about domain data, which holds). A dry-run is distinguishable from a commit
  by `afterState.dryRun` (true vs false) on the audit row, but the action name
  (`historical.units` / `historical.spareparts`) is shared. If at-a-glance
  action-name distinction is later wanted, give dry-runs a distinct action;
  for now the row carries the flag in context.
- **TypeScript pinned at ^5.x**: NestJS 10 is incompatible with TS 6 tsconfig
  conventions (`moduleResolution: "node"`, `baseUrl` deprecated). Do not upgrade
  TypeScript to 6.x.
- **Prisma stays on 6.x**: do not upgrade to Prisma 7 during MVP. The
  `package.json#prisma` deprecation warning is known and deferred.

## When in doubt

- Do not modify anything under `prisma/` without explicit instruction.
- Do not add Better-auth, JWT, Auth0, or Clerk.
- Do not introduce a new dependency without noting why.
- Prefer the boring, well-supported option. This is a business system, not a
  research project.

# Supplementary: schema and build gotchas

Things that are easy to get wrong and not visible from the charter above.

## Three-tier invariant enforcement

Every Domain Model invariant (I-1 .. I-15) lives in exactly one of these tiers.
Know which tier before "adding a constraint":

1. **Prisma schema**: `@unique`, `@@unique`, FK relations, enum types. Flagged
   inline in `schema.prisma` with `// INVARIANT I-...`.
2. **Raw SQL migration**: partial unique indexes the DSL cannot express. Flagged
   inline with `// INVARIANT (SQL):` or `// INVARIANT I-... (SQL):`. Currently
   applied: one active PI per PO, one active SO line per unit, one current price
   per (variant, tier).
3. **Application service layer**: the list under "Key invariants enforced in the
   service layer" above. These cannot be moved into the DB.

When adding a new constraint, pick its tier up front and put the inline marker
in `schema.prisma` so future migrations can find it.

## Additional schema rules not in the charter

- StockMovement is conceptually immutable (I-3 / I-10): no `updatedAt`, no
  `deletedAt`. Same treatment as AuditLogEntry, PeriodSnapshot, and
  StockValuationLine.
- Soft delete via `deletedAt DateTime?` is present where deletion is
  conceivable; the audit log records everything regardless.
- State machines are Prisma enums (37 of them). If tempted to add a free-text
  status, make it an enum instead.

## Things intentionally omitted (do not "fix" these)

- **DocumentLink** is polymorphic (`entityType` + `entityId`) with no
  database-level FKs to its targets. Prisma cannot back multiple relations with
  one scalar FK. Resolution is in application code. Do not add target-specific
  FKs.
- **Assembly consumables / BillOfMaterials / ConsumableUsage** are not modelled
  (CKD kits are self-contained).
- **Spare parts** have no sale logic at MVP (Option A from the domain doc).

## Offline-sync layer

`IdRangeAllocation`, `ConflictReviewItem`, `ProcessedSyncAction`, and the
`clientId` fields scattered through transactional models (e.g.
`StockMovement.clientId`) implement domain-doc 7.2.6 idempotent sync. When
adding a new transactional model, decide whether it needs a `clientId @unique`
for sync idempotency.

## tsconfig + nest-cli build gotcha

`nest-cli.json` has `deleteOutDir: true`. If you re-add `incremental: true` to
`tsconfig.json`, the leftover `tsconfig.tsbuildinfo` makes `tsc` skip emit after
`nest build` deletes `dist/`, and you get a silent "success" with exit 0 and no
output. Keep `incremental` off, or scope its build-info file to a path inside
`dist`.

## CostVisibilityInterceptor: skip class instances when stripping

The interceptor recursively walks the response and removes cost fields for
callers without `costdata.view`. The walk MUST NOT spread non-plain objects
into a fresh literal: `Prisma.Decimal` and native `Date` lose their
prototypes via `{...value}` (Date becomes `{}`, Decimal becomes
`{ s, e, d, ... }`), so every cost-bearing response sent to a non-cost-view
caller silently mangles its money and timestamps. Guard with:

```ts
if (Object.getPrototypeOf(value) !== Object.prototype) return value;
```

before the recursive spread. This was latent for several prompts because
every test path until M4 Prompt 2 (pricing) ran as a `costdata.view` holder,
which short-circuits the walk entirely. Any new interceptor or response
transformer that recurses into objects has the same hazard.

## Global interceptor order is `[CostVisibility, Audit]` and is verified

The `APP_INTERCEPTOR` registration order in `app.module.ts` is, deliberately:

```
CostVisibilityInterceptor   (registered first)
AuditInterceptor            (registered second)
```

This is counterintuitive and must not be swapped. NestJS runs interceptor
response operators in REVERSE registration order: the last-registered
interceptor transforms the response first (closest to the handler), the
first-registered transforms last (outermost, closest to the client). The
binding invariant is: the audit row must capture the FULL response while the
client receives the cost-STRIPPED one (Invariant I-8; the audit log is the
system of record and keeps full truth, privacy comes from gating `audit.read`,
not from sanitising stored rows). To get that, `AuditInterceptor` must be inner
(observes the full response first via its `tap`) and `CostVisibilityInterceptor`
must be outer (strips last, so the client gets the stripped version). Inner =
registered LAST, outer = registered FIRST, hence `[CostVisibility, Audit]`.

This was proven empirically in M1: registering in the intuitive `[Audit, Cost]`
order made the audit row for a non-cost caller capture the STRIPPED response
(the exact failure the ordering exists to prevent). The `app.module.ts` comment
carries the do-not-swap warning.

Rule for any future global interceptor (M5 sync, observability, etc.) that must
OBSERVE-then-TRANSFORM a response: reason in terms of the invariant ("what must
see the full response, what must see the transformed one"), not array position,
then place the observer LAST (inner) and the transformer FIRST (outer). Verify
adversarially, do not trust the registration order at face value.

## SO state machine permits CANCELLED past release; the service is the gate

`SO_STATE_TRANSITIONS` (`src/sales-orders/state-machine.ts`) lists
`CANCELLED` in the transitions from `RELEASE_AUTHORISED` and `PICKING` for
a hypothetical admin/override path. The user-facing `POST /sales-orders/:id/cancel`
endpoint does NOT use those transitions: `SalesOrdersService.cancel`
allowlist-checks against `{DRAFT, AWAITING_PAYMENT, PAYMENT_RECEIVED}`
before reaching `assertSoTransition`, because reversing a released order
(units already transitioned to `SOLD_AS_CKD`/`SOLD_AS_CBU` and physically
committed) is the returns/refund flow, not cancellation. If a future
admin-cancel path is added, keep the layering: do not collapse the
service-layer status allowlist into the state-machine map. They check
different things, and merging them would re-open the gap that the cancel
endpoint was added to close.

Cancellation is recorded in BOTH the entity columns AND the audit log; they
are complementary, not alternatives. `SalesOrder` has `cancellationReason`,
`cancelledAt`, and `cancelledById` columns plus the `cancelledBy` relation
(folded into the fresh schema). The cancel endpoint writes these columns
directly, so the reason lives on the entity where reporting and order views
expect to query it. The `AuditInterceptor` additionally records the
cancellation in the immutable audit log via `req.user`, exactly as it does for
every mutation. The columns are the queryable entity-level fact; the audit row
is the immutable event record (I-10). Both happen on every cancel.

This supersedes the prior audit-only rationale, and the reversal is deliberate,
not a forgotten decision. The earlier build worked under a locked Prisma schema,
so the cancel endpoint genuinely could not add columns and stashing the reason
in the audit row's `afterState` was the correct adaptation to that constraint.
This build authored the schema fresh with no lock, so the columns were folded
in on purpose. The constraint changed, so the approach changed: the old design
was right for its constraint, this one is right for ours.

## Unit state machine: DEMO and INTERNAL_USE are round-trip states (ratified)

DEMO and INTERNAL_USE both return to sellable stock by design. A unit pulled
for a demo or for internal use is temporarily diverted, not consumed, so it can
come back to IN_WAREHOUSE_CKD or IN_WAREHOUSE_CBU (or be written off). The
unit-state machine (`src/units/unit-state-machine.ts`) therefore allows:

- DEMO to [IN_WAREHOUSE_CKD, IN_WAREHOUSE_CBU, INTERNAL_USE, WRITTEN_OFF]
- INTERNAL_USE to [IN_WAREHOUSE_CKD, IN_WAREHOUSE_CBU, WRITTEN_OFF]

The return-to-warehouse legs are IT-admin adjustments (movement type RETURN).
This is deliberate and ratified, not map drift: M3 Prompt 4 first modelled
INTERNAL_USE as near-terminal (WRITTEN_OFF only), and Prompt 5 broadened it to
mirror DEMO so the internal-use round-trip the adjustment set requires is
reachable. A diverted asset returns; the system honestly records the diversion
period in the unit's movement history. Whether an internally-used unit is then
sold as "new" is a business and disclosure question, not a system one.

## class-validator whitelist strips undecorated DTO fields

`whitelist: true` (the global ValidationPipe, and any direct `validate()` call)
REMOVES every property that carries no validation decorator. This is correct for
most DTOs, but it silently drops fields meant to hold free-form values. The sync
field-merge `FieldChangeDto.oldValue/newValue` are intentionally `unknown` (a
field patch can carry any value); under whitelist they were stripped before the
merge ran, so the service saw `undefined` and Prisma quietly ignored the
undefined fields. The symptom was the worst kind: applied-but-not-persisted with
no error, the response even reported the field as "applied". Fix: mark a
deliberately free-form field with `@Allow()` so whitelist keeps it. The hazard
applies to any DTO with intentionally typeless fields. It surfaced only because
the verification asserted real DB persistence, not the response shape; assert
the persisted state for any write, never trust the echo.

## Stocks report: in-stock value excludes sold (ratified)

The stocks report's market-value KPI sums `currentMarketPrice` over the on-hand
buckets only (CKD + InAssembly + CBU), excluding Sold and Other. This is the
correct meaning of "stock value": the value of inventory on hand to sell, not
what has already been sold or written off. Each variant row exposes
`inStockCount` so the figure is auditable. A "total sold value" is a different
figure and lives in the revenue report (recognised at release), not here.

## Canonical P2002 (unique-violation) detection

`src/common/prisma-errors.ts` `isUniqueViolationOn(err, { index, fields })` is
the ONE detector for Prisma P2002 unique-constraint violations. Every
unique-violation rewrap to a 409 routes through it (SO line I-11, the active-PI
index, the one-current-price index, the invoice-per-SO and waybill-per-DN
indexes). Do not hand-roll a P2002 check.

It handles both shapes because Prisma 6 reports `meta.target` as a
**field-name array** (e.g. `["unitId"]`), NOT the index name. The helper matches
the field array first and falls back to an index-name match. A detector that
only checked the index name compiles, passes happy-path tests, and silently
lets the violation surface as a 500.

The lesson, which generalises: an invariant verification that only confirms the
happy path does not exercise the error-handling path. The I-5 (active-PI) and
one-current-price detectors were "verified" only in that the invariant held (the
atomic supersede means a real P2002 never fired), so their 409-rewrap was dead
code looking for the wrong meta shape. The first triggerable case
(double-allocation, I-11) exposed it across all three. **Error-handling paths
need a test that actually triggers the violation, not just happy-path invariant
confirmation.** This matters directly for the M5 sync layer's unique-key intake
enforcement: test it by triggering the violation, using `isUniqueViolationOn`.

## PermissionsGuard is AND-only

`@RequirePermissions(...)` requires the caller to hold ALL listed permissions
(AND-semantics). There is no OR. When a route's intent is "permission A OR
permission B", gate on the permission whose holders are the SUPERSET and note
it inline. Example: the returns GET routes want "return.manage OR
salesorder.read"; they gate on `salesorder.read` alone, because every
return.manage holder also holds salesorder.read (verified in the seed), so the
broader permission satisfies the OR. If a route ever needs true OR-of-permissions
that no single permission's holder-set covers, that is a guard enhancement (an
`@RequireAnyPermission` decorator), not something to fake through the AND guard.

## product.read vs pricelist.read (catalogue/pricing split)

`GET /api/products` is gated on `product.read` (the catalogue: variants, SKUs,
attributes, status, and the selling-side `currentMarketPrice` which is treated
as visible to all per Invariant I-8 and the existing reports/pricing
conventions). The actual price-list endpoints under `/api/price-list` keep
`pricelist.read` and `pricelist.manage`.

This split was added during the frontend build when the Procurement Officer
role could not fetch the product catalogue to build PO line items: the role
needs to reference products but legitimately does not hold `pricelist.read`.
The original `pricelist.read` gate on the catalogue was a modelling error
(conflating "see what products exist" with "see the price list"). Every seeded
role now holds `product.read` (each one has at least one product-touching
permission across procurement, inventory, sales, assembly, or reporting). The
catalogue is foundational; pricing is a narrower concern.

If a future role legitimately should NOT see the catalogue, drop `product.read`
from its grant list; the current default is "everyone with any product-touching
permission can see what products exist."

## ts-node service-level checks need --files

A `ts-node` script that imports `AppModule` (e.g. to call a service method like
`resolvePrice` directly) must run with `npx ts-node --files`. The
`express-session` `SessionData` module augmentation (which types `session.userId`
and friends) is an ambient `.d.ts` that `nest build` picks up via the tsconfig
`include`, but `ts-node` does NOT load per-file without `--files`, so the import
fails to typecheck. `nest build` is unaffected; this is a ts-node-only gotcha.

## Prisma raw-SQL column quoting

`@@map` rewrites **table** names to snake_case. It does not rewrite columns. In
raw-SQL migrations, columns are quoted camelCase: `"purchaseOrderId"`, not
`purchase_order_id`. The example SQL in `prisma/README.md` is snake_case and is
wrong for this schema; the correct form lives in
`prisma/migrations/20260520143602_invariant_partial_unique_indexes/migration.sql`.

## Working method for prisma changes

- Read `prisma/README.md` before non-trivial schema changes.
- After editing `schema.prisma`, run `npx prisma format` and `npx prisma validate`.
- For a raw-SQL invariant migration: `npx prisma migrate dev --create-only --name <n>`,
  edit the empty `migration.sql`, then `npx prisma migrate dev` to apply.

## Verify scripts: placeholder-hash precondition

Every `scripts/verify-*.ts` aborts loudly when a test user it touches is not on
the seeded placeholder hash (`$argon2id$PLACEHOLDER_RESET_REQUIRED`). This is
deliberate: it prevents clobbering a real password set by an earlier walkthrough
(e.g. the `src/README.md` proof-of-chain leaves `itadmin` on a real password).

To unblock a verify script after a walkthrough:

```bash
npm run reset-test-passwords
```

This puts the five seeded test accounts (theresa, daniel, ikenna, kelechi,
itadmin) back on the placeholder. It is scoped to those accounts only, never
a blanket reset, and is idempotent. Note that `npx prisma db seed` is **not**
the right tool: its user upsert only refreshes `fullName` on existing rows
(deliberate, so re-seeding never clobbers a real password in deployed
environments).

## Local Postgres container

The dev database runs in a Docker container started during setup:

```
docker run -d --name enviable-postgres \
  -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=enviable \
  -p 5433:5432 postgres:16
```

If 5433 is also occupied on your host, pick another port and update
`DATABASE_URL` in `.env` to match.
