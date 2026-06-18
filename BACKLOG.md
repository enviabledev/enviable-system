# Backend backlog (enviable-system)

Real, accepted issues parked for later. Surface findings here as they come up so
they're not lost between sessions. The `Deferred / hardening backlog` section in
`CLAUDE.md` covers the production-cutover items (session fixation, VAT rounding,
etc.); this file is the working backlog for issues discovered during ongoing
implementation that don't belong in CLAUDE.md.

## Open

### DISCONTINUED variant enforcement: scope and the procurement decision (Prompt 33-C)

Prompt 33-B left DISCONTINUED advisory; the consuming create-flows now enforce
it via a shared helper (`src/products/variant-status.ts`,
`assertVariantsActive` / `discontinuedVariantMessage`). Enforced in: assembly
start (`startAssembly`), sales-order line resolution (`resolveLines`, so create
AND line-replacement), price entry creation (`setPrice`), and historical-load
units (surfaced as a per-row validation error). Existing references are never
touched (the guard only gates the references being created). Deliberate scope
boundaries:

- **Procurement (PO / PI) is NOT guarded.** Purchase-order and proforma-invoice
  line creation also reference variants, but they are procurement, not "new
  business" in the sell/assemble sense, and a variant can be discontinued while
  POs/PIs are still in flight. Left unguarded on purpose. Decide before launch
  whether creating a NEW PO line for a discontinued variant should also be
  blocked (a separate call from receiving already-ordered stock).
- **Manifest receipt is NOT guarded, and must not be.** Receiving units against
  an existing shipment fulfils an order placed while the variant was active; it
  is an existing reference being completed, not new business. Guarding it would
  strand already-purchased stock.
- **The guard reads status outside the persistence transaction** in the SO,
  assembly and pricing flows (it runs in the pre-transaction resolve step, the
  same place existing existence/state checks live). A variant discontinued in
  the microsecond between the check and the write would slip through once; the
  consequence is one extra reference to a freshly-discontinued variant, not a
  correctness violation. Acceptable for admin-paced catalogue changes; tighten
  by moving the check inside the tx if it ever matters.
- **Historical-load reports it as a row error**, consistent with how that
  endpoint reports every other validation problem (unknown SKU, duplicates), so
  a bulk file naming a discontinued SKU fails validation with the standard
  message rather than a bare 409. Operational path to load historical data for a
  discontinued item: reactivate, load, deactivate again.

### Variant management: design choices and a uniqueness-hardening follow-up (Prompt 33-B)

Variant management (`src/products/product-variants.*`) shipped as create + edit
only, gated on the new `productvariant.manage` permission (granted to Managing
Director, Executive Director, General Manager, Procurement Officer, and IT Admin
via `*`). Deliberate choices and one hardening item:

- **No DELETE endpoint (option b).** Any variant that has ever been used is
  referenced by units, sales-order lines and price-list entries, so a guarded
  hard-delete would almost never succeed and a soft-delete is indistinguishable
  from deactivation. Deactivation is `PATCH status=DISCONTINUED`: it stops new
  use while existing references keep resolving. This also meant NO schema
  migration was needed (no `deletedAt` added; the `ProductStatus` enum already
  carries ACTIVE/DISCONTINUED). If a true "remove an unused, never-referenced
  variant" operation is ever wanted, add a guarded DELETE then.
- **SKU is immutable.** `supplierSkuCode` cannot be changed via PATCH; the DTO
  declares `supplierSkuCode`/`sku` only so the attempt survives the global
  whitelist and is rejected with an explanatory 400 (rename would silently
  change what every historical unit/SO/price-list row displays).
- **SKU uniqueness is enforced app-level only.** Create rejects a duplicate
  `supplierSkuCode` with a 409, but there is no DB unique constraint on the
  column (it is only `@@index`ed), so a concurrent double-create could still
  race two identical SKUs in. Harden with a unique index (a raw-SQL migration,
  per the partial-unique-index pattern) before high-volume catalogue editing.
  Check the seed for any intentional duplicate SKUs across products first.
- **"DISCONTINUED blocks new use" is not yet enforced in the consuming paths.**
  The management endpoint sets the status, but assembly / sales-order-line /
  price-list creation do not currently reject a DISCONTINUED variant. Probe E
  only asserts existing references still resolve (they do). Add a status check
  to those create paths when the deactivation semantics need to bite, not just
  be advisory.
- **Status semantics: DISCONTINUED is the deactivated state.** The prompt spoke
  of ACTIVE/INACTIVE, but the schema enum is `ProductStatus {ACTIVE,
  DISCONTINUED}`; the endpoints use the existing enum rather than introduce a
  new one. The frontend should label DISCONTINUED as "Inactive/Discontinued".

### Customer management: audit outcome and the delete guard (Prompt 33-A)

The customer management endpoints already existed (POST/PATCH/DELETE on
`customers`, gated `customer.manage`, `@Audit`-annotated, matching the
counterparties shape), and `customer.manage` was already seeded and granted to
Head of Sales, Sales Manager, and Sales Officer (Warehouse). So this prompt was
a narrow completion, not a build:

- **Soft-delete now sets `status: INACTIVE` alongside `deletedAt`** (previously
  only `deletedAt`), so status-filtered views drop a deleted customer too.
- **Soft-delete now guards on in-flight sales orders.** A customer with any sales
  order not in a terminal state cannot be deleted; the endpoint returns 409 with
  a clear message. Terminal (non-blocking) states are CLOSED, CANCELLED, and
  REFUNDED. REFUNDED was added to the prompt's CLOSED/CANCELLED baseline because
  it is equally terminal (a settled, closed-out order); every other state
  (including DELIVERED-not-yet-CLOSED) blocks. Revisit the terminal set if the SO
  lifecycle changes (e.g. if DELIVERED becomes the true end state).
- **Mirror unchanged but documented.** The customers bucket already mirrors the
  full row (no secret column on Customer), which is exactly what the management
  UI needs; added a docblock so a future sensitive field on Customer triggers an
  explicit-select review rather than silently leaking.

No new permission, DTO, or mirror-shape change was required; the create/update
DTOs already cover every mutable Customer field (name, type, tier, phone, email,
address, taxId, status).

### Credential operational completeness: notes (Prompt 32-backend)

`POST /api/users` and `POST /api/users/:id/reset-password-required` now return
the deployment-wide `initialPassword` (the bootstrap default) transiently to the
user.manage admin who triggered the action. Deliberate refinements recorded so
they are not mistaken for leaks:

- **initialPassword exposure is intentional and bounded.** It is the deployment
  default (`DEFAULT_INITIAL_PASSWORD`), never a per-user secret. Returned ONLY
  from create and admin-reset (both user.manage gated), never on a read
  (list/detail) or in the mirror (verified by leak probes D/E), and redacted
  from the audit row. The field inclusion is explicit in the service, not
  implied by the permission gate, so a future endpoint change cannot widen it by
  accident.
- **Audit redaction widened to `initialPassword`.** The audit interceptor's
  SENSITIVE_KEYS now strips `passwordHash`, `password`, and `initialPassword`, so
  the create/reset responses (which carry the cleartext default) never persist
  it into the audit row. If another transient-credential field is ever added to
  a response body, add its key here too.
- **entityId extraction handles wrapped responses.** The audit interceptor now
  resolves entityId from a nested `result.user.id` (create returns
  `{ user, initialPassword }`) and falls back to the route `:id` (admin-reset
  returns only `{ initialPassword }`). Any future endpoint that wraps its entity
  or returns no id relies on this; revisit if a new response shape hides the id
  deeper.
- **Admin reset is atomic.** passwordHash and mustResetPassword move together in
  one update inside a transaction; a mid-operation failure rolls back both
  (probe H). There is no partial state where the password changed but the flag
  did not.
- **Admin cannot reset their own password via this endpoint** (unchanged
  self-mod guard); the self-service `POST /api/auth/reset-password` is the path
  for changing one's own password.

### User/role module: known gaps and deliberate choices (Prompt 30)

The users/roles management module (`src/users/`, `src/roles/`) is built and its
eight probes pass. Items parked deliberately:

- **Audit beforeState does not show a role-set diff.** The global
  AuditInterceptor captures beforeState via a bare `findUnique` on the entity
  row, which for a User is scalar columns only; role assignments live in the
  `user_roles` junction, not on the row. So a `user.update` that swaps roles
  records the NEW role set in afterState (the service returns the user with
  userRoles included) but the OLD set is not in beforeState. Atomicity of the
  swap is enforced in a transaction and verified at the DB level. If a true
  before/after role diff in the audit is wanted, the interceptor would need a
  per-entityType relation include (a generic-interceptor change), or the User
  service would write a richer custom audit payload. Same shape as the existing
  "non-:id params capture null beforeState" limitation below.
- **Management-coverage guard covers user mutations, not role-permission
  edits.** `UsersService` blocks any user change that would leave zero active
  users holding `user.manage` (and blocks self-removal / self-deactivation /
  self-delete). But `RolesService.update` can remove `user.manage` from a role's
  permission set without that coverage check; if that role were the only source
  of `user.manage`, it could strip the last manager. Mitigations today: roles
  are recommended read-only at MVP (the frontend will not expose role edit), and
  a role that is assigned to any user cannot be deleted. Consider adding the same
  coverage assertion to the role permission-edit path before role editing is
  exposed in the UI.
- **System roles are editable (name/permissions), only delete is blocked.**
  `RolesService` rejects deleting a `isSystemRole` role and any role still
  assigned to a user, but PATCH can rename a seeded system role or change its
  permissions. Renaming a system role would desync `prisma/seed.ts` (its upsert
  keys on `name`, so a re-seed would create a duplicate). Acceptable while role
  editing is not surfaced; lock system-role name edits if/when it is.
- **`mustResetPassword` is exposed on the gated admin API, never on the mirror.**
  The `user.read`/`user.manage` API responses include `mustResetPassword`
  (useful for the admin to see "has not completed first login"); the offline
  mirror (sync-pull) excludes it and the password hash entirely (verified by the
  leak probe). This split is deliberate: the API is admin-gated, the mirror is
  broader/offline.
- **Default-password window.** Between user creation and first login the account
  is reachable with the known `DEFAULT_INITIAL_PASSWORD`, but the
  mustResetPassword gate confines it to the reset endpoint, so nothing is
  accessible. This is the accepted design (no email infrastructure). If the
  window is ever a concern, add a short creation-to-first-login expiry.

### Build: invoice document assets now copy to dist/src (fixed, Prompt 30)

Discovered while booting the built app for the Prompt 30 probes: `nest build`
emits compiled code under `dist/src/` (tsc infers the rootDir across `src/` +
`scripts/`), but the Prompt 28 `nest-cli.json` asset globs copied the invoice
templates/fonts/logo to `dist/` (i.e. `dist/documents/...`). The renderer
resolves assets relative to `__dirname` (`dist/src/documents`), so the built app
crashed loading templates at startup (only `ts-node` against `src/` worked).
Fixed by setting the asset `outDir` to `dist/src`; the built app now boots and
`DocumentsModule` loads. If the build layout ever changes, re-verify the asset
path resolves against the compiled `__dirname`.

### Invoice / proforma documents: fields not stored on the records (Prompt 28)

The invoice + proforma PDF renderer (`src/documents/`) needs several
customer-facing fields that no transactional record currently stores. Each is
handled today by config, derivation, or an honest "Not provided" placeholder so
the document is complete and never fabricates a datum. Decide per field whether
to promote it to stored data before the documents are issued to real customers.

- **Company identity + bank details**: not stored anywhere (no company-profile
  table). Sourced from `loadCompanyProfile` config with design defaults
  (`INVOICE_COMPANY_*`, `INVOICE_BANK_*`). A single-tenant constant for now;
  promote to a DB-backed company profile if it ever needs editing in-app or
  multi-entity support. Templates read it through one context object, so the DB
  swap is additive (no template change).
- **Ship-to / delivery address**: `Customer` has a single `address` JSON and no
  separate delivery address. The sales invoice renders Ship To = Bill To. Add a
  delivery address to `Customer` or `SalesOrder` if dealers ship to a different
  yard than the billing address (the design shows them as distinct).
- **Customer code, Customer PO**: not stored. Rendered as a muted "Not
  provided". Add `customerCode` to `Customer` and `customerPO`/`reference` to
  `SalesOrder` if these need to appear on issued invoices.
- **Payment terms (sales side) + due date**: no terms column on `Customer` or
  `SalesOrder` (only on `PurchaseOrder`/`ProformaInvoice`). The invoice derives
  the due date as `issueDate + INVOICE_DEFAULT_NET_DAYS` (default 14) and labels
  it "Net N Days" as a company-wide default. Capture per-order terms if they
  vary by customer.
- **UOM**: no unit-of-measure on `Product`/`ProductVariant`. Lines render a
  constant `UNIT` (sales are serialised kekes, always one per unit). Add UOM if
  spare parts ever sell (different units: PCS/SET) or kekes need "EA".
- **Sales invoice currency**: `Invoice` has no currency column (sales are NGN by
  domain). Rendered as NGN via `INVOICE_SALES_CURRENCY`. Add a currency column
  if non-Naira sales become possible. (Proforma currency comes correctly from
  `PurchaseOrder.currency`.)
- **Line quantity on the sales invoice**: one `SalesOrderLine` is one `Unit`
  (no qty column). The renderer aggregates identical units (same variant + unit
  price) into one priced line with a count, to present customer-facing
  quantities. This is a presentation choice; the stored model stays one-line-
  per-unit. Revisit if per-unit serials (engine/chassis) should appear on the
  invoice instead of an aggregated count.

Renderer notes (not issues, recorded so they are deliberate):

- **Determinism**: PDFs render byte-identical for a given record except the
  embedded `/CreationDate`+`/ModDate` (the generation instant, correct to
  vary). Tagged-PDF output is disabled (`tagged: false`) because Chromium's
  structure-tree element ids (`node%08d`) come from a session-global counter and
  would otherwise make renders differ. If accessible/tagged PDFs are wanted
  later, re-enable tagging and have any determinism check normalise those ids
  plus the dates rather than comparing raw bytes.
- **Chromium dependency**: rendering uses `puppeteer-core` against a system
  Chrome/Chromium (no bundled download). Production must provide a binary and
  point `PUPPETEER_EXECUTABLE_PATH` at it (the Fly.io image needs chromium
  installed). The service throws a clear 500 if no binary is found.
- **Render-on-demand**: every download re-renders from the immutable record (no
  stored PDF). Deterministic, so caching to R2 for email attachments / shared
  links is a pure optimisation to add later, not a correctness need.

### Audit beforeState: handlers with non-`:id` URL params capture null

The `AuditInterceptor.captureBeforeState` heuristic reads `req.params.id` to
look up the pre-mutation row. Three @Audit-annotated handlers don't fit that
shape and therefore yield null beforeState. Per-handler confirmed shape (read
the service methods directly to verify; do not infer from the @Audit string):

- `POST /historical-load/shipment` (`historical.shipment`, no id param,
  entityType `Shipment`): `createHistoricalShipment` creates a PO + PI +
  Shipment in one `$transaction`. **Pure bulk-create.** Null beforeState is
  semantically correct (no prior state existed for any of the three rows).
- `POST /historical-load/units/:shipmentId` (`historical.units`, entityType
  `Shipment`): `loadUnits` creates many `Unit` rows and their RECEIPT
  `StockMovement` rows in batched transactions. The Shipment itself is NOT
  mutated (it was already `RECEIVED` from `createHistoricalShipment`); the
  `:shipmentId` is a parent FK for the new Units, not a mutation target.
  **Pure bulk-create.** Null beforeState is semantically correct.
- `POST /historical-load/spare-parts` (`historical.spareparts`, no id param,
  entityType `SparePart`): `loadSpareParts` uses `upsert` with
  `quantityOnHand: { increment: r.quantity }`, i.e. **bulk-upsert, NOT pure
  bulk-create**. For existing SpareParts the handler mutates state
  (quantityOnHand incremented, name overwritten). Per-entity auditability is
  preserved through the `SparePartMovement` stream (one row per CSV line, each
  in the same transaction as the upsert), so the audit chain isn't broken; the
  @Audit row itself is a SUMMARY event (`{dryRun, created: <n>}`), not a
  per-entity snapshot. Null beforeState is structurally consistent with "no
  single entity is the pre-state for this summary event," but the design here
  is "summary-event audit + per-entity movement records," not "single-entity
  audit." Worth flagging if a future requirement is "the audit row must let
  you reconstruct each affected SparePart's pre-state without consulting the
  movement stream": that would need either splitting the action into per-row
  audited operations, or capturing a per-row pre-state array into the audit
  context.

For shipment and units the framing is settled (null is correct). For spareparts
the framing is settled IF the "summary audit + per-entity movement stream"
design is intentional, which it appears to be (matches I-3 and the
SparePartMovement table's purpose). Recommended: leave as-is. If precise
per-entity reconstruction from the @Audit row is later required, plan a
separate prompt for the summary-vs-per-entity audit-shape decision.

Two clean paths if precise per-shipment beforeState is ever wanted for
historical.units specifically (e.g. to capture the Shipment's status and
metadata at load time):

1. Rename the URL param from `:shipmentId` to `:id` (the convention every other
   audited handler follows). Trivial in the controller, zero call-site change
   externally beyond the URL.
2. Extend the `@Audit(action, entityType)` decorator with an optional third
   field naming the param to use (e.g. `@Audit('historical.units', 'Shipment',
   { paramKey: 'shipmentId' })`). Keeps URL conventions but adds API surface
   to the decorator.

Recommended: (1). Defer until there is a concrete need.

### Audit writes are non-transactional with mutations: silent-loss risk

The interceptor's `record()` is invoked via `void this.record(...)` inside a
`tap` on the response observable, so audit writes are fire-and-forget AFTER
the handler completes and the response has been emitted. They are not part of
the handler's transaction.

**The specific risk this opens.** A mutation can succeed (the database has
committed the change) and the subsequent audit write can fail (DB hiccup,
connection drop, the audit insert hits a transient error, the process dies
between handler return and `tap` firing). In all those cases, the mutation is
permanent and the audit row is silently missing. For an audit log that is the
system's inspection-of-truth mechanism (compliance, investigation, "what
changed and who did it"), this is the worse class of failure: the system is
incomplete and the user has no way to detect it. The complementary risk
(audit row for a mutation that didn't commit) does NOT occur, because a handler
throw never emits `next`, so `tap` never fires, so `record()` is never called
(verified by Probe 4 of the beforeState rollout).

**Likelihood:** low in steady state (the audit insert is a single-row write
against a healthy DB and runs ~ms after the handler), but not zero, and the
gap is undetectable from the system's own records, which is the defining
property of a "silent loss" failure mode.

**Mitigation options** (in roughly increasing engineering cost):

1. **Accept the gap with monitoring.** Add a Logger.error counter on the
   existing `record()` catch block, surface it through whatever metrics path
   M5 lands (structured logs / Prometheus / Sentry). Operators see audit-write
   failures as they happen and can investigate. Doesn't close the gap, but
   makes it observable. Low effort, modest assurance.
2. **Retry-with-dedupe on audit-write failure.** When `audit.write` throws,
   queue a retry (in-memory ring or persistent retry table) keyed on a
   client-supplied idempotency token; the audit row's natural dedupe key is
   (actorUserId, action, entityId, timestamp-bucket). Closes the gap for
   transient DB failures; doesn't help if the process dies between mutation
   commit and the queue write. Medium effort.
3. **Transactional outbox pattern.** Each audited mutation, in its own
   transaction, writes an `audit_outbox` row alongside the mutation; a
   separate dispatcher polls the outbox and writes the real
   `audit_log_entries` row, marking the outbox row dispatched. The mutation
   and the outbox row commit together, so there is no window where a
   committed mutation lacks an outbox record. Closes the gap fully, including
   process-death scenarios. High effort: requires plumbing the audit write
   through the handler's transaction (touching every audited service), or
   moving the outbox-row write into the global interceptor with a Prisma
   transaction reference threaded through `req` (uglier but contained).

**Current call:** accept the gap (mitigation 1 implicitly: the existing
`Logger.error` already fires on audit-write failure). Revisit when the
compliance/auditability bar tightens or when the M5 observability work lands
(which is the natural place to wire mitigation 1 explicitly). The Logger
output should be the trigger for a real decision: if audit-write failures are
non-zero in production, the silent-loss risk is concrete and mitigation 2 or 3
becomes the next move.

Not a blocker for shipping the beforeState fix, but the auditability principle
this codebase rests on does not actually guarantee "every mutation has an
audit row" today. It guarantees "if there is an audit row, it accurately
describes a mutation." The reverse implication is the gap above.

### Existing 222 fixture audit entries have null beforeState (historical)

The pre-fix audit entries (verified at 222 rows in the dev DB at the time of
the rollout) all carry null beforeState because the interceptor never passed
it. They are left as-is: reconstructing pre-state from after-state alone is
generally impossible without the change history, so any backfill would be
partial. Documented as a historical artifact; new entries post-fix carry
beforeState correctly per the convention.

## Done (this session)

### Audit beforeState capture for update and delete actions

`AuditInterceptor` now captures the pre-mutation row via best-effort
`req.params.id` -> `prisma[<entityTypeCamel>].findUnique` BEFORE `next.handle()`,
threading it through to `audit.write` as `beforeState`. Six probes
(`verify-audit-beforestate.ts`, 25/25 assertions) confirm semantic correctness
for update and delete (probe 1, 2), null for create (probe 3), no audit on
handler failure (probe 4), per-entity isolation (probe 5), 100%/0% counts
across the suite (probe 6).
