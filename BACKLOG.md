# Backend backlog (enviable-system)

Real, accepted issues parked for later. Surface findings here as they come up so
they're not lost between sessions. The `Deferred / hardening backlog` section in
`CLAUDE.md` covers the production-cutover items (session fixation, VAT rounding,
etc.); this file is the working backlog for issues discovered during ongoing
implementation that don't belong in CLAUDE.md.

## Open

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
