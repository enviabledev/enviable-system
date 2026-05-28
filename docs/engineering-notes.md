# Engineering notes: schema and build gotchas

Companion to `CLAUDE.md`. `CLAUDE.md` carries the load-bearing one-line rules
(its "Critical gotchas (digest)" section); this file is the full rationale, war
stories, and verification notes behind each one. Read this before non-trivial
work in `src/sync/`, the global interceptors, the invariant/error-handling
paths, or `prisma/`. Things that are easy to get wrong and not visible from the
charter.

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

## `updatedAt` is the offline-mirror spine: must advance on every mutation

The offline read-mirror keys every entity on `updatedAt`: window queries bound
by it, delta sync continues from it, and offline-read freshness is disclosed
from it. So `updatedAt` is load-bearing: a mutation that doesn't advance the
row's `updatedAt` is silently invisible to the mirror, the worst failure mode
(no error, the clerk reads stale data believing it current).

**The rule:** every mirrored entity has `updatedAt @updatedAt` and every
mutation path advances it. Prisma's `@updatedAt` does this automatically for
`prisma.<model>.update(...)` / `updateMany`; if you ever write a path that
mutates rows OUTSIDE Prisma's update operation (raw SQL `UPDATE`, an
`executeRaw`/`queryRaw` that modifies, a DB trigger that mutates) you MUST
explicitly bump `updatedAt` on that path. As of M5 every raw-SQL site in
`src/` is read-only (SELECT or `pg_advisory_xact_lock`); migrations are DDL
or block-only triggers (no raw UPDATE on mirrored entities). So in this
codebase the rule reduces to "make sure the column exists and writes go
through Prisma." If a future path bypasses Prisma for performance or any
other reason, the bumping is the caller's responsibility, not the ORM's.

**Child entities (lines) need their own `updatedAt`.** Parents do not
necessarily bump on child changes (verified case: `receiveUnits` updates
`ManifestLine.quantityReceived` without touching `Shipment`). The mirror
queries child tables directly on their own `updatedAt`, sidestepping the
parent-bumps-on-child question entirely. PurchaseOrderLine,
ProformaInvoiceLine, ManifestLine, and SalesOrderLine all carry
`updatedAt @updatedAt` for exactly this reason; back-filled from their
parent's createdAt at migration time (the closest semantic for "modified at
or after this moment").

**Append-only tables use createdAt as effective modified-time.**
`AuditLogEntry`, `StockMovement`, `PeriodSnapshot`, `StockValuationLine`,
and `SparePartMovement` are insert-only by invariant (I-9/I-10); they have
no UPDATE path, so their `createdAt` IS their definitive mod-time. The
mirror queries these by `createdAt > since`; no `updatedAt` is required or
meaningful.

**Decided cases that were M5 fallbacks:** PriceListEntry and PaymentMethod
both received real `updatedAt` columns (backfilled from `effectiveFrom` and
`createdAt` respectively) for spine uniformity, so every mirrored entity is
queryable by the same field. `effectiveFrom`/`effectiveTo` remain the
semantic mod-time for prices; `updatedAt` is the consistent key.

## Sync pull: since-mode and windowed-mode

`GET /api/sync/pull` (`SyncPullService.pull`) serves two modes off the same
endpoint:

- **since-mode** (default): `?since=<iso>` returns everything with
  `updatedAt > since` and `<= serverNow`. Used by the ongoing reconciling
  delta sync (a device that has been online recently catches up from where it
  left off to the present). Omitting `since` means epoch (first-ever sync).
- **windowed-mode**: `?from=<iso>&to=<iso>` returns everything with
  `updatedAt` in `[from, to)`. Used by the offline read-mirror's initial
  90-day download in 7-day windows. Half-open at `to` so adjacent windows
  don't double-count rows on the boundary. Providing only one of `from`/`to`
  is a 400.

Response shape is the same for both modes (so the client uses one parser):
`{ mode, window: {from, to}, since, serverTime, nextSince, truncated, cursor,
referenceData: { ... 20 entity buckets ... }, units: [...] }`. The `mode`
field tells the client which mode the server ran; `window.from`/`window.to`
are the authoritative bounds in either mode (in since-mode, `from = since`
and `to = serverTime`).

Reference data and transactional entities are returned in full per window
(small at this business's scale for 7-day windows: a typical 7-day window
of shipments/POs/PIs/SOs/payments is on the order of tens to low hundreds
of rows). Units are the large set, paged by `limit` (default 500, max
1000) with a keyset continuation cursor; the client re-pulls with the same
window plus the cursor until `truncated: false`, then adopts `nextSince`.
On continuation pages reference data is the empty stub (not re-fetched).

`nextSince` is anchored to `window.from` while truncated (so the client
re-pulls the same window); once the page is complete, it advances to
`serverTime` (since-mode) or `window.to` (windowed-mode) so the client
can hand it back as the next call's `since` or use it to compute the next
window.

Cost-stripping (I-8) holds on both modes automatically: the global
`CostVisibilityInterceptor` strips `landedCost` from any unit (or
landed-cost row) in the response when the caller lacks `costdata.view`.
The service returns full rows; the interceptor sanitises per-caller. This
was verified empirically on the windowed path: a Sales Officer's windowed
pull returns units with no `landedCost` key, while a Procurement Officer's
returns the cost intact.

Scope filter `?scope=type1,type2,...` accepts any of the 26 mirrored entity
type names (see `ALL_TYPES` in `sync-pull.service.ts`). Omitted means all.
When adding a new mirrored entity, update `ALL_TYPES` AND the `referenceDelta`
return object (both the empty stub and the conditional fetch); the entity
must either have a reliable `updatedAt` per the spine rule above, or be
append-only and key on its insert-time field (occurredAt/issuedAt/etc.).

### Buckets and their key fields

Most buckets key on `updatedAt`. The exceptions are append-only event/auth
streams that have no `updatedAt` by invariant; they key on their natural
insert-time field:

- `stockMovements` keys on `occurredAt` (I-9/I-10 immutable; insert-only).
  Carries `unitId` so a unit-detail timeline reconstructs offline by
  filtering movements to that unit.
- `sparePartMovements` keys on `occurredAt`. Carries `sparePartId` for the
  spare-part timeline.
- `auditLogEntries` keys on `occurredAt`. Carries the full audit row
  (action, entityType, entityId, beforeState, afterState, context). Can
  grow large; the FRONTEND mirror should govern whether to include it
  (typically only for users holding `audit.read`, optionally with a
  narrower window than the 90-day default to bound size). Backend exposes
  it; frontend decides.
- `releaseAuthorisations` keys on `issuedAt`. Conceptually append-only
  (one per released SO, never updated). Load-bearing for the revenue and
  customers reports: revenue's window filter is `releaseAuthorisation.
  issuedAt`, and customers uses presence of releaseAuthorisation as the
  released-or-not gate for `totalOrderValue`. Without this bucket, both
  reports would be wrong offline.

### Cost-stripping on the append-only event streams

None of the event-stream rows (`stockMovement`, `sparePartMovement`,
`auditLogEntry`) carry cost fields directly, so the global
`CostVisibilityInterceptor` has nothing to strip from them. Verified by key
sweep: zero `cost|landed|cif|freight|insurance|margin` keys on any row of
any of those buckets. Cost data lives only on `Unit.landedCost` and
`SparePart.landedCostPerUnit` (plus the cost-component models), which are
stripped from their own buckets per I-8 as before.

## Report-input coverage (verified for offline recompute)

The four MVP reports compute over the following entities; the mirror's
coverage of each input determines whether the report can be recomputed
offline as "complete but possibly stale" (freshness + accuracy warning is
sufficient) or "structurally incomplete" (a stronger disclosure is needed,
because the report would compute over MISSING data, not just stale data).

| Report | Inputs | Mirror coverage |
|---|---|---|
| Stocks | `unit`, `productVariant`, `sparePart` | Complete |
| Customers | `customer`, `salesOrder`, `payment` (CONFIRMED), `releaseAuthorisation` | Complete (releaseAuthorisation added to the pull for this) |
| Revenue | `salesOrder` + lines, `customer`, `productVariant`, `unit` (for landedCost), `releaseAuthorisation` (window key) | Complete (releaseAuthorisation added to the pull for this) |
| Audit log | `auditLogEntry` | Available (bucket exposed; frontend governs whether and how much to mirror per user / audit.read) |

All four reports compute over entities now present in the mirror. The
offline recompute is therefore "complete but possibly stale" for stocks,
customers, and revenue: freshness + accuracy warning is the right
disclosure level. For the audit log report, the frontend mirror's scope
choice determines whether it's complete or windowed (if the frontend
mirrors a narrower window than the report queries, the report would have
a known horizon limit; disclose that horizon, don't silently compute over
a partial set).

The Unit detail screen's movement timeline reconstructs from
`stockMovements` filtered to the unit's id; product labels reconstruct from
`products` joined to `productVariants` on `productId`. Both verified
end-to-end against the windowed pull.

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

## Invariant-violation messages name the offending entity (exhaustively)

When a unique-index or invariant violation is rewrapped to a 409, the message
must name the offending entity (the engine number, the SKU, the SO number,
whatever the natural identifier is for the colliding row) and, when a single
request can produce multiple violations, name ALL of them in one response so
the client fixes the whole batch in one pass. Generic messages like "a unit
is already allocated to another active sales order line" force the client to
detective which row collided; one-at-a-time messages force a "fix one,
resubmit, hit the next" loop on multi-row submissions. Named, exhaustive
messages let the client highlight every affected cell at once.

Implementation pattern (mirrored by both the I-11 path in
`sales-orders.service.ts` and the receipt path in `shipments.service.ts`): a
pre-flight lookup before the transaction collects ALL violations and returns
them in one structured 409 in the typical case; the P2002 catch re-runs the
same collector as race-window enrichment, so a concurrent insert that slips
between the pre-flight and the actual write still gets the same structured
shape. The DB unique constraints remain the authoritative enforcer (no
duplicate ever persists, even in a race); the pre-flight is a usability layer,
not the safety layer. If the pre-flight ever becomes "how we prevent
duplicates," that is a regression.

For multi-field surfaces (receipt has TWO unique fields, engineNumber AND
chassisNumber, with FOUR collision kinds: in-batch dup and against-DB for
each), the structured body is:

```
{
  statusCode: 409,
  error: 'Conflict',
  message: '<human summary>',
  violations: [
    { kind: 'IN_BATCH_DUP' | 'AGAINST_DB',
      field: 'engineNumber' | 'chassisNumber' | ...,
      value: <offending value>,
      rows: [{ manifestLineId, unitIndex }, ...],   // 2+ rows for IN_BATCH_DUP
      message: '<per-violation legacy phrasing>' }, // back-compat for parsers
    ...
  ]
}
```

The per-violation `message` field preserves the original single-line phrasing
(`Duplicate engineNumber in request batch: X`, `engineNumber already exists:
Y`) so clients with regex extraction still match; the new structured `rows`
carries the position info that lets the client highlight the specific cell.
A value that is BOTH an in-batch dup and against-DB produces both violations
(deduplicating within the batch still leaves the DB collision; the clerk
needs to see both to fix the batch in one pass).

**The convention is universal across paths, including the sync intake.** A
structured-violations 409 must surface identically whether the action arrived
via a direct POST or via `POST /api/sync/actions`. The sync dispatcher's
`classifyError` (`src/sync/sync-actions.service.ts`) recognises any
`ConflictException` whose response body carries a `violations` array and
forwards it as `{status: 'conflict', conflict: {kind: 'constraint-violations',
violations: [...]}}`, preserving the structured detail intact rather than
collapsing it to `{status: 'error', error: <message>}`. Genuine errors that
don't carry violations (string-message ConflictExceptions for wrong-state /
malformed-payload / transient failures, validation errors, etc.) stay as
`'error'` so the clerk-resolvable conflicts surface never receives an action
the clerk cannot fix by editing inputs.

The bar for "what reclassifies as `conflict`" is the violations-body shape,
not the exception class: a string-message ConflictException (assembly's
wrong-state check, the I-11 message today which is still a single-line
string from `formatI11Message`) stays in `error` because it has no structured
detail for the conflicts surface to render. If/when those flows migrate to
the structured-violations body (in keeping with this universal convention),
they get picked up by the same matcher automatically. Adding a new endpoint
or sync action type? Throw the structured shape from the start; no further
sync-intake change needed.

Safe-by-retry is preserved through this: a `'conflict'` outcome (like an
`'error'`) is NOT recorded by `SyncIdempotencyService.process` (which only
records on a successful work() return), so a same-clientId re-submission of
a corrected action re-runs cleanly. This is the load-bearing guarantee that
lets the conflicts surface be a fix-then-resubmit workflow rather than a
record-and-dead-end.

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

Verification here is done with ad-hoc `ts-node` scripts created as needed and
NOT committed (only `scripts/set-password.ts` and `scripts/reset-test-passwords.ts`
are committed; there is no test runner). The convention for any such
`verify-*.ts`: abort loudly when a test user it touches is not on the seeded
placeholder hash (`$argon2id$PLACEHOLDER_RESET_REQUIRED`). This prevents
clobbering a real password set by an earlier walkthrough (e.g. the
`src/README.md` proof-of-chain leaves `itadmin` on a real password). Run such a
script with `npx ts-node --files` from the project root (see the ts-node
`--files` gotcha above) and delete it when done.

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
