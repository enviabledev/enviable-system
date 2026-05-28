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
- `npm run build` (nest build) to compile; `npx tsc --noEmit` to typecheck
  (there is no `typecheck` npm script).
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

# Critical gotchas (digest)

These are the load-bearing one-line rules. The full rationale, war stories, and
verification notes for every item live in `docs/engineering-notes.md` (READ it
before non-trivial work in `src/sync/`, the global interceptors, the
invariant/error-handling paths, or `prisma/`). Several below are silent-failure
traps with no error, so do not skip the doc when you touch those areas.

## Invariant enforcement tiers
Every invariant I-1..I-15 lives in exactly ONE tier: (1) Prisma schema
(`@unique`, relations, enums), (2) raw-SQL migration (partial unique indexes the
DSL can't express), or (3) the service layer (the list above). Pick the tier up
front and mark it inline in `schema.prisma` with `// INVARIANT I-...`.

## Schema rules
- StockMovement / AuditLogEntry / PeriodSnapshot / StockValuationLine /
  SparePartMovement are insert-only (I-9/I-10): no `updatedAt`, no `deletedAt`.
- Soft delete is `deletedAt DateTime?` where deletion is conceivable; status
  fields are Prisma enums, never free-text.
- Intentionally omitted, do NOT "fix": DocumentLink is polymorphic with no DB FKs
  (resolved in app code); no BillOfMaterials/consumables (CKD kits are
  self-contained); spare parts have no sale logic at MVP.

## updatedAt is the offline-mirror spine (load-bearing)
Every mirrored entity has `updatedAt @updatedAt` and every mutation MUST advance
it; a mutation that does not is silently invisible to the mirror (stale reads, no
error). Prisma's `@updatedAt` handles `update`/`updateMany` automatically. Any
path that mutates rows OUTSIDE a Prisma update (raw SQL UPDATE, executeRaw, a
trigger) MUST bump `updatedAt` itself. As of M5 every raw-SQL site in `src/` is
read-only, so the rule reduces to "the column exists and writes go through
Prisma." Child lines carry their own `updatedAt` (parents do not always bump on
child change); append-only tables use `createdAt`/`occurredAt` as mod-time.

## Sync pull (GET /api/sync/pull, SyncPullService.pull)
Two modes off one endpoint: since-mode (`?since=`, returns `updatedAt` in
`(since, serverNow]`) and windowed-mode (`?from=&to=`, returns `[from, to)`;
supplying only one of from/to is a 400). `?scope=type1,type2` filters to the
mirrored entity type names in `ALL_TYPES`. When adding a mirrored entity you MUST
update three places in `sync-pull.service.ts`: `ALL_TYPES`, the `referenceDelta`
empty stub, AND its conditional fetch; the entity needs a reliable `updatedAt`,
or must be append-only and key on its insert-time field (occurredAt/issuedAt).
Cost-stripping (I-8) holds on both modes via the global interceptor (the service
returns full rows). Append-only buckets carry their parent id for offline
timeline reconstruction. All four MVP reports' inputs are mirrored
(complete-but-possibly-stale).

## Global interceptor order is [CostVisibility, Audit] - do NOT swap
Registration order in `app.module.ts`: CostVisibilityInterceptor first, Audit
second. NestJS runs response operators in REVERSE registration order, so Audit
(inner) observes the FULL response (the audit row keeps full truth) while
CostVisibility (outer) strips `landedCost` last (the client without
`costdata.view` gets the stripped version, I-8). Reason about the invariant
(observer inner, transformer outer), never trust array position; verify
adversarially.

## CostVisibilityInterceptor: skip class instances when stripping
The recursive cost-strip walk MUST guard
`if (Object.getPrototypeOf(value) !== Object.prototype) return value;` before any
`{...value}` spread: `Prisma.Decimal` and `Date` lose their prototypes via spread
(Date becomes `{}`, Decimal mangles), silently corrupting money/timestamps for
non-cost-view callers. Same hazard for any new recursing interceptor/transformer.

## class-validator whitelist strips undecorated DTO fields
`whitelist: true` REMOVES any property with no validation decorator.
Deliberately free-form fields (e.g. sync `FieldChangeDto.oldValue/newValue`) MUST
be marked `@Allow()` or they are stripped before the service sees them
(applied-but-not-persisted, no error). Assert persisted DB state for any write,
never trust the response echo.

## Canonical P2002 (unique-violation) detection
`src/common/prisma-errors.ts` `isUniqueViolationOn(err, { index, fields })` is the
ONE detector; every 409 rewrap routes through it. It matches Prisma 6's
`meta.target` field-name array first, then falls back to the index name (an
index-name-only check silently surfaces as a 500). Error-handling paths need a
test that actually triggers the violation, not just happy-path confirmation.

## Invariant-violation 409s name the offending entity, exhaustively
Rewrapped unique/invariant violations must name the offending entity (engine
number, SKU, SO number) and ALL violations in one response. Pattern (I-11 in
`sales-orders.service.ts`, receipt in `shipments.service.ts`): a pre-flight
collector gathers all violations pre-transaction; the P2002 catch re-runs it as
race enrichment. The DB unique constraints stay the authoritative enforcer; the
pre-flight is usability only. Structured body:
`{ statusCode, error, message, violations: [{ kind, field, value, rows, message }] }`.
Universal across paths INCLUDING the sync intake: `classifyError` in
`sync-actions.service.ts` forwards any ConflictException carrying a `violations`
array as `{status:'conflict', conflict:{kind:'constraint-violations', violations}}`;
string-message conflicts stay `'error'`. A `'conflict'` (like `'error'`) is NOT
recorded by sync idempotency, so a corrected resubmit re-runs cleanly.

## State-machine notes
- SO state machine lists CANCELLED from RELEASE_AUTHORISED/PICKING for a
  hypothetical admin path, but `SalesOrdersService.cancel` allowlist-checks
  `{DRAFT, AWAITING_PAYMENT, PAYMENT_RECEIVED}` first (reversing a released order
  is the returns flow, not cancel). Keep the service allowlist separate from the
  state-machine map. Cancellation writes BOTH entity columns
  (cancellationReason/cancelledAt/cancelledById) AND the audit log.
- Unit DEMO and INTERNAL_USE are round-trip states (return to IN_WAREHOUSE_* or
  WRITTEN_OFF via RETURN movements); ratified, not map drift.

## Permissions / catalogue
- `@RequirePermissions(...)` is AND-only (caller must hold ALL listed). For
  "A OR B", gate on the permission whose holders are the superset and note it
  inline (e.g. returns GET routes gate on `salesorder.read`).
- `GET /api/products` is gated on `product.read` (the catalogue, incl.
  `currentMarketPrice`); price-list endpoints keep `pricelist.read`/`.manage`.
  Every seeded role holds `product.read`.

## Build / tooling
- `nest-cli.json` has `deleteOutDir: true`. Do NOT re-add `incremental: true` to
  `tsconfig.json` (a leftover `.tsbuildinfo` makes `tsc` skip emit after dist/ is
  deleted: silent exit-0, no output).
- ts-node service-level scripts importing AppModule need `npx ts-node --files`
  (the `SessionData` ambient augmentation is not loaded per-file otherwise).
- Raw-SQL columns are quoted camelCase (`"purchaseOrderId"`), NOT snake_case;
  `@@map` renames tables only. Correct example migration:
  `prisma/migrations/20260520143602_invariant_partial_unique_indexes/migration.sql`.
- Prisma changes: read `prisma/README.md` first; after editing `schema.prisma`
  run `npx prisma format` then `npx prisma validate`; raw-SQL invariant migration
  is `migrate dev --create-only`, edit the SQL, then `migrate dev`.

## Test accounts / passwords
Seeded users carry a non-authenticating placeholder hash
(`$argon2id$PLACEHOLDER_RESET_REQUIRED`); `npm run set-password -- <email>
<password>` sets a real one. `npm run reset-test-passwords` puts the five seeded
test accounts (theresa, daniel, ikenna, kelechi, itadmin) back on the placeholder
(scoped, idempotent). `npx prisma db seed` does NOT reset passwords (its user
upsert only refreshes fullName). There is no committed test runner; verification
is via ad-hoc `ts-node --files verify-*.ts` scripts (uncommitted, deleted when
done).

## Local Postgres
Dev DB runs in Docker on host port 5433 (5432 is taken by an unrelated
container): `docker run -d --name enviable-postgres -e POSTGRES_USER=user -e
POSTGRES_PASSWORD=pass -e POSTGRES_DB=enviable -p 5433:5432 postgres:16`. If 5433
is occupied, pick another port and update `DATABASE_URL` in `.env`.
