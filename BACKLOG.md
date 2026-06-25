# Backend backlog (enviable-system)

Real, accepted issues parked for later. Surface findings here as they come up so
they're not lost between sessions. The `Deferred / hardening backlog` section in
`CLAUDE.md` covers the production-cutover items (session fixation, VAT rounding,
etc.); this file is the working backlog for issues discovered during ongoing
implementation that don't belong in CLAUDE.md.

## Open

### SKD units sell into SOLD_AS_CBU; no SOLD_AS_SKD state (Prompt 46a)

A 3-wheeler now completes assembly to IN_WAREHOUSE_SKD and is sold from SKD as
the primary path. There is no SOLD_AS_SKD sold-state: a sold SKD unit becomes
SOLD_AS_CBU (the only "sold assembled" state), so post-sale the SKD-vs-CBU
distinction is lost in the sold record. The on-hand distinction (the point of
this prompt: SKD and CBU counted separately in stock) is preserved; only the
realised/sold record collapses both to SOLD_AS_CBU. If the business needs to
distinguish SKD-sold from CBU-sold post-sale (e.g. warranty, returns routing),
add SOLD_AS_SKD and thread it through returns (I-15) and the sale form. Deferred.

### resolveLines accepts SKD or CBU for a CBU-form sale (Prompt 46a)

To keep 3-wheeler sales working after they moved to SKD, a CBU-form sales line
now accepts a unit in IN_WAREHOUSE_SKD OR IN_WAREHOUSE_CBU (both are built and
sellable; release transitions either to SOLD_AS_CBU). This is additive: CKD-form
still requires IN_WAREHOUSE_CKD, and existing CBU-from-CBU sales are unchanged.
SaleForm stays {CKD, CBU} (no SKD sale form); the unit's warehouse state, not the
sale form, carries the SKD distinction.

### Upgrade complete/fail/cancel share audit actions with kit assembly (Prompt 46a)

The SKD->CBU upgrade has its own START action (assembly.upgrade.start, its own
endpoint). But complete/fail/cancel are SHARED endpoints that operate on any job
by id, so they keep their existing audit actions (assembly.complete /
assembly.fail / assembly.cancel) regardless of job type. An upgrade completion is
distinguishable in the audit row by afterState.jobType = SKD_TO_CBU (the response
the interceptor captures includes jobType), same pattern as the historical-load
dry-run flag. If at-a-glance action-name distinction is later wanted, split the
endpoints or write explicit upgrade-specific audit entries in the service.

### Inventory valuation treats SKD and CBU identically (Prompt 46a note)

The stocks report counts SKD and CBU in distinct buckets but values both at
currentMarketPrice as on-hand stock (IN_STOCK_BUCKETS = ckd, inAssembly, skd,
cbu). There is no separate valuation for the work-in-value between SKD and CBU
(the storefront upgrade adds labour/parts value not captured here). If SKD and
CBU need different unit valuations, that is a deeper costing question, deferred.

### No SKD warehouse state; assembly is product-type agnostic (Prompt 45a finding + decision) [SUPERSEDED by 46a]

RESOLVED: prompt 46a added IN_WAREHOUSE_SKD as a real state with the conditional
assembly and SKD->CBU upgrade described below as future work. Original 45a note
retained for history:

Prompt 45a's Task 4 assumed a 3-wheeler "SKD/assembled" state distinct from CBU.
It does not exist: `UnitStatus` has CKD, IN_ASSEMBLY (transient), and CBU only;
`AssemblyService.complete` transitions every unit to IN_WAREHOUSE_CBU. So both
2- and 3-wheeler assembly complete to CBU, and 3-wheeler behaviour is unchanged.
Introducing a real SKD state would break the existing CBU-based sales/release
flow (a hard "unchanged" constraint), and the prompt itself scopes the 3-wheeler
SKD-to-CBU split OUT ("future store-front sales... not in this prompt's scope").
Decision: NO new state; assembly stays type-agnostic; documented with a comment
in `assembly.service.ts complete()`. When storefront sales lands, add the SKD
warehouse state and branch the completion target there by the variant's
productType (3-wheeler -> SKD, then SKD -> CBU via the unit adjust flow).

### SO product-type model: implicit-from-first / uniform-set (Prompt 45a decision)

A sales order is single-product-type, enforced as "every line in a submitted set
shares one wheeler type" (the first line establishes it; a mismatched line is
named and rejected 409). NO productType column on SalesOrder. Rationale: there is
no incremental add-line endpoint, so `create` and `update` each submit the whole
set atomically and `assertSingleProductType` validates it inside `resolveLines`;
adding an SO column would duplicate state derivable from the lines. Consequence
for the frontend (45b): the order type is `lines[0].productVariant.productType`
(or none for an empty order); the line picker should filter to that type once the
first line exists. The 409 message is the contract: "This order is a {TYPE}
order. The variant {SKU} is a {other} variant and cannot be added."

### Variant productType change does not retro-validate orders (Prompt 45a)

`PATCH /product-variants/:id` may change `productType` (the reclassification use
case: correcting an auto-created variant). It does NOT re-check sales orders that
already reference the variant, so in theory an existing SO could become mixed-type
retroactively. Accepted for MVP (reclassification is rare and pre-payment; the
enforcement is at line-add time). A cascading re-validation or a block-when-
referenced rule is deferred.

### Auto-create defaults productType to THREE_WHEELER (Prompt 45a decision)

Supply-side auto-create (historical-load, PO line, shipment receive) sets
`productType = THREE_WHEELER`. Rationale: all real supply today is TVS King
tricycles, and those entry points are deliberately non-blocking (a CSV row / PO
line carries no wheeler-type field to require). The variant lands on the
"Pending Classification" sentinel product; an admin reclassifies BOTH product and
type via PATCH. 2-wheeler variants are created explicitly. If 2-wheeler supply
ever arrives via auto-create, it will be mis-typed until reclassified (same
"needs classification" caveat the sentinel already carries).

### Bank details model: config keyed by wheeler type, placeholder 2W (Prompt 45a)

Enviable's bank accounts live in `CompanyProfile` (config), now TWO accounts
keyed by ProductType: `INVOICE_BANK_3W_*` and `INVOICE_BANK_2W_*` (NAME /
ACCOUNT_NAME / ACCOUNT_NUMBER / SORT_CODE each). The 3-wheeler defaults are the
prior real Zenith values; the 2-wheeler account is a PLACEHOLDER
(account 0000000000) that Theresa must replace via env before launch. Customer
documents (sales PI + sales invoice) route to the account for the SO's product
type via `bankForLines`. No DB company-profile table yet (still deferred).

### Procurement-side PI PDF is RETAINED, not retired (Prompt 43a decision)

43a Task 7 asked whether the procurement-side "View PDF / Print PI" affordance
(the Direction C template wired to procurement ProformaInvoice data, endpoints
`GET /api/proforma-invoices/:id/pdf` and `/html`, gated `pi.read`) should be
retired now that the sales-side PI exists. Decision: **retain it.** The
procurement PI is VSK's inbound PI to Enviable; rendering Enviable's branded
view of it is a plausible internal review/archival artifact, not something sent
to VSK. Retiring an outward-facing endpoint is hard to reverse and I could not
confirm with procurement that it is unused, so per the prompt's two-case logic
("some operational use -> leave it, consider relabeling") it stays. **Frontend
recommendation:** relabel the procurement-side affordance as "VSK PI reference
(internal)" so it does not read as a document Enviable issues. If a stakeholder
later confirms procurement never uses it, removal is a clean follow-up (delete
the two handlers in `proforma-invoices.controller.ts`; the render methods on
PdfRendererService can stay or go with it).

### Sales PI snapshots the SO at creation; not re-issued on SO edit (Prompt 43a)

One PI per SO (`salesOrderId` unique), auto-issued at SO creation. If the SO is
later edited (lines/totals change via `update()`), the PI is NOT re-issued or
updated, and the rendered PI reads live from the current SO at render time (it
has no stored line snapshot), so an edited SO renders its PI with the NEW
figures under the ORIGINAL piNumber/issue date. For MVP this is acceptable
(edits before payment are rare and the PI is informational), but a real
re-issuance flow (new piNumber, supersede the prior, or freeze a line snapshot
on the PI) is deferred. Flag for the frontend: do not imply the PI is immutable.

### Sales PI uses a single bank; per-product-type routing deferred (Prompt 43a)

The sales PI payment box renders Enviable's single bank from CompanyProfile
(`INVOICE_BANK_NAME`/`INVOICE_BANK_ACCOUNT`, defaults in `company-profile.ts`).
Bank routing per product type (2-wheeler vs 3-wheeler) is deferred to the
prompt 45 integration, which will extend `salesProformaPaymentHtml()` /
CompanyProfile to select the bank by the SO's product mix.

### nest-cli asset-copy: templates glob was missing watchAssets (Prompt 43a fix)

`nest-cli.json` had `watchAssets: true` on the `documents/assets/**` glob but
NOT on `documents/templates/**`, so in `start:dev` watch mode editing a `.hbs`
did not re-copy it to `dist/` (the stale-template trap 42b hit). Fixed by adding
`watchAssets: true` to the templates glob. Verified live: `nest build --watch`,
edited the template, the edit propagated to `dist/` in ~2s. Build-time copy was
never affected (a full `nest build` always copies assets); this only bit watch
mode.

### Overpayment detection is against CONFIRMED balance only (Prompt 42a)

`PaymentsService.record` detects overpayment as `amount > (SO.total - sum(CONFIRMED
payments))`, floored at 0, matching how `confirm`/`cancel` already count money
(only CONFIRMED payments move the needle; a PENDING payment never does). Two
consequences the frontend and ops should know:
- Two separate PENDING payments are each measured against the SAME confirmed
  remaining, so both can be recorded "within balance" yet together exceed the
  total. The real overpayment crystallises at confirm time. This is consistent
  with the existing invariant (only confirmed count) but means the recording-time
  check is a usability guide, not a hard ledger guarantee. A confirm-time
  overpayment guard is a separate, larger piece (it would need to decide what to
  do when the SECOND confirm tips the order over) and is deliberately not in
  this scope.
- The resolution (REFUND/CREDIT) is captured at record time on the PENDING
  payment. If that payment is later REJECTED, the resolution rows ride along on
  a rejected payment (harmless, but the invoice summary and any future refund
  worklist should filter to CONFIRMED, as the invoice renderer already does).

### Overpayment is recorded intent, not a processed refund/credit (Prompt 42a)

Per Theresa, the system is a recording medium: it stores WHICH resolution was
chosen (REFUND + mechanism, or CREDIT + notes) but does not move money or create
a credit balance the next SO can draw down. There is no refund worklist, no
credit-note entity, no link from a CREDIT overpayment to a future SO. When a
real refund/credit workflow is scoped, the captured fields on Payment
(`overpaymentAmount`, `overpaymentResolution`, `refundMechanism`,
`refundReference`, `creditNotes`) are the source data to build it from. Note the
existing `cancel` path's `refundOutstanding` flag is a parallel, separate
surfacing of refund liability (on cancellation); a unified "money owed back to
customer" view would consolidate the two.

### Verify scripts leave immutable audit rows in dev (Prompt 42a note)

Exercising the `payment.overpayment` audit-write path against a real DB writes
to `audit_log_entries`, which is append-only (I-9/I-10, DB trigger blocks
DELETE). The 42a verification left 8 such rows in the dev DB that cannot be
cleaned up. Harmless (dev only, by design), but worth knowing: any verify run
that exercises an audited mutation permanently grows the dev audit log.

### Supplier-warranty-claim disposition not modelled (Prompt 44a finding)

A DAMAGED unit can reach write-off (`DAMAGED -> WRITTEN_OFF`) and repair
(`DAMAGED -> IN_REPAIR -> IN_WAREHOUSE_CKD/CBU`) via the existing adjustment
map. There is NO supplier-warranty-claim disposition: no unit status, no
counterparty-claim entity, no movement type for "returned to TVS/VSK under
warranty." Theresa named it as a downstream choice the warehouse manager should
have, so it is a real gap, but it is its own feature (a claim record against a
counterparty, likely with a credit/replacement outcome), not part of the
assembly-reversal work. Park until a warranty/claims flow is scoped.

### Assembly cancel reuses ADJUSTMENT movement type (Prompt 44a decision)

`AssemblyService.cancel` writes the `IN_ASSEMBLY -> IN_WAREHOUSE_CKD` reversal as
a `MovementType.ADJUSTMENT`, not a dedicated `ASSEMBLY_CANCEL`. Rationale: the
enum lives under `prisma/` (guarded against changes without explicit
instruction), and `fail` set the precedent of reusing the most
destination-appropriate existing type (`DAMAGE`) rather than minting a
per-transition type. The movement is self-documenting anyway
(`fromState=IN_ASSEMBLY`, `toState=IN_WAREHOUSE_CKD`, `referenceType=ASSEMBLY_JOB`,
`notes=<reason>`). If assembly-throughput reporting later wants to distinguish a
cancelled assembly from a generic IT-admin adjustment at the movement-type level,
add an `ASSEMBLY_CANCEL` enum value (one-line schema change + idempotent
`ADD VALUE IF NOT EXISTS` migration) and switch `cancel` to it. The seed
description for `assembly.perform` ("Start/complete/fail assembly jobs") is now
slightly stale (cancel added); left untouched per the prisma/ guardrail, refresh
it on the next intentional seed edit.

### Production sentinel + variant SKU realignment migration (Prompt 41)

`prisma/migrations/20260622213814_production_sentinel_and_variant_realignment`
is a data-only migration (no schema change) that exists for PRODUCTION LAUNCH
READINESS, not for any dev need. It closes two gaps found by the deploy-readiness
audit: (1) the auto-create sentinel product `seed-product-pending-classification`
was added to the dev seed only, so production (deployed without seed-on-deploy)
lacked it and any auto-create would FK-violate; (2) production still held the 5
variant rows under their OLD placeholder SKUs because it was never reseeded after
the 06-22 realignment. The migration INSERTs the sentinel (ON CONFLICT DO NOTHING)
and UPDATEs the 5 SKUs by id, guarded so already-aligned rows are true no-ops.

Notes for future readers:
- Idempotent across fresh / already-applied / old-state; verified locally on all
  three plus a double-run (no-op) and an auto-create FK probe against the
  post-migration state.
- The sentinel's `manufacturerId` is deliberately NULL: on a fresh
  `migrate deploy` this runs BEFORE seed, so the seeded manufacturer does not yet
  exist and referencing it would FK-violate. The dev seed sets it to seed-cp-tvs;
  that cosmetic divergence is harmless (the FK only needs the product to exist).
- SKU UPDATEs bump `updatedAt` because ProductVariant is sync-mirrored; a raw
  UPDATE that does not advance it is invisible to the offline mirror.
- Raw SQL bypasses @Audit by design; the migration file is its own trail.

### Variant auto-create at supply-side entry points (Prompt 37)

Variants now enter the catalogue THROUGH procurement instead of having to be
pre-seeded. Shared helper `src/products/variant-auto-create.ts` is the single
source of truth; wired into historical-load units upload and PO line creation.
Sales side (SO lines, assembly, pricing) preserves reject-on-unknown. Permission
inherits the source operation (no separate variant-create gate). All 32
verification probes (A-J incl. reclassify and the structured-409 PO path) green.

Decisions and findings worth carrying:

1. SENTINEL PRODUCT, not nullable columns. `ProductVariant.productId` and
   `currentMarketPrice` are NON-null in the schema, and neither a CSV row nor a
   PO line supplies a product or price. Rather than migrate the schema (CLAUDE.md
   forbids touching prisma/ without explicit instruction; the DB layer is DONE),
   auto-created variants attach to a seeded sentinel product
   `seed-product-pending-classification` ("Pending Classification") with
   `currentMarketPrice = 0`, `variantAttributes = {}`, status ACTIVE. An admin
   reclassifies later via the variant PATCH (now accepts `productId`).

2. The 0 price is SAFE as a sentinel (checked per the price-assumption probe):
   no code treats `currentMarketPrice` as a "has been priced" flag, and selling
   is entirely PriceListEntry-driven (pricing.service never reads market price),
   so 0 cannot leak into a sale. The ONE arithmetic consumer is the inventory
   valuation report (`reports.service.ts:112`, `price.mul(inStockCount)`): an
   unpriced auto-created variant contributes 0 to total market value. That is an
   honest understatement (unknown market value) and is itself the "needs
   enrichment" signal, not a bug. If a real go-live wants auto-created stock
   reflected at some value before admins price it, that is a deliberate decision
   to make then.

3. No `createdById` column on ProductVariant, so the actor is recorded in the
   auto-create AUDIT row metadata (`triggeredBy`) instead, alongside `source`,
   `sourceEntityId`, `sku`, `similarityChecked`. Action `productvariant.autocreate`,
   entityType `ProductVariant`. The audit row is written in the SAME transaction
   as the variant (and the source op), so all three commit or roll back together.

4. SHIPMENT RECEIVE does NOT auto-create (case a). Receive resolves the variant
   from `manifestLine.productVariantId`, which was set at shipment CREATE time
   from `ManifestLineDto.productVariantId`. No SKU ever enters at receive, so
   there is nothing to auto-create. The place a new SKU could enter the shipment
   path is shipment CREATE, but that DTO takes an id and is out of this prompt's
   scope. To let supply introduce variants via the shipment path, add a SKU
   option to `ManifestLineDto` and run it through the same helper. Deferred.

For the FRONTEND (prompt 37-frontend) to know:

- PO line: new optional `productVariantSku` (mutually exclusive with
  `productVariantId`, exactly one per line) plus per-line `overrideSimilarityCheck`.
  An unknown SKU similar to an existing variant throws a structured 409:
  `{ kind: 'similar-variant', incomingSku, match: { id, supplierSkuCode, distance,
  reason }, message }`. Surface "use existing variant X" vs "create new anyway"
  (resubmit the line with `overrideSimilarityCheck: true`).
- Historical-load: similarity findings come back as per-row error strings (naming
  the existing SKU + id), same channel as other row errors; commit is blocked
  until they are resolved. The override is REQUEST-LEVEL
  (`?overrideSimilarityCheck=true`), applying to the whole upload, NOT per row.
  So a file mixing "use existing for row 17" with "create new for row 22" cannot
  be expressed by one flag: "use existing" is resolved by editing that row's SKU
  to the exact existing SKU; "create new anyway" needs the request-level override,
  which would also force-create any OTHER flagged rows. If per-row resolution is
  wanted, the endpoint needs a per-row decision map (deferred; flag for UX).
- Dry-run now returns `newVariants` (SKUs a commit would auto-create); commit
  returns `autoCreatedVariants`. Use these to show "N new variants will be / were
  created, review them in variant management."
- Auto-created variants surface in `GET /products` under the "Pending
  Classification" product, priced 0 with empty attributes. The variant detail
  should prompt the admin to reclassify (PATCH productId), set attributes, and
  set a price.

Edge cases handled / flagged:

- INTRA-FILE near-duplicates: two DIFFERENT unknown SKUs in the SAME historical
  upload that are near-identical to each other (neither matching an existing
  variant) are detected and flagged as row errors, so one upload cannot mint a
  typo'd duplicate pair. The DB similarity gate only compares against persisted
  variants, hence this separate pass. The request-level override bypasses it too.
- supplierSkuCode still has NO DB unique constraint (pre-existing item, see the
  33-B uniqueness-hardening note below). Auto-create relies on the app-level
  exact-match check, so two concurrent uploads of the same brand-new SKU could
  each create a variant (race -> duplicate). Low risk at single-operator MVP
  scale; the real fix is the deferred unique index, which auto-create makes more
  worthwhile. Until then the partial unique index / advisory-lock hardening
  covers it.

### Seed variant SKUs aligned to VSK format; production catalog still pending (Prompt 36-followup)

The dev seed's ProductVariant catalog previously used internal short codes
(`GSP-ECO-GREEN`, `GSP-G-YELLOW`, `GSP-NEP-BLUE`, `GSP-NF-WINE-RED`,
`ZSP-G-YELLOW`) that do not match what VSK actually ships under. Real CSV
uploads against historical-load (exact-match resolution on
`supplierSkuCode`, no normalization) would fail every row as unknown-SKU.

Fixed: `prisma/seed.ts` now seeds VSK-format codes. Exactly ONE is a CONFIRMED
real VSK SKU from the EC List: `TVS KING GS+ DP CKD EXP10 G YELLOW`. The other
four (`... ECO GREEN`, `... NEP BLUE`, `... NF WINE RED`, `TVS KING ZS+ DP CKD
EXP10 G YELLOW`) follow the same naming pattern but are SEEDED PLACEHOLDERS,
marked inline. Production deployments MUST replace every placeholder with the
actual VSK catalog before any real upload. The complete VSK SKU list is
Theresa-provided and not yet in hand; only the GS+ G YELLOW line is confirmed.

Cross-context surprises surfaced this round (the reason this is logged, not
just committed):

1. The prompt referenced prior-round artifacts that DO NOT EXIST in this repo:
   no `sample/` directory, no `sample/README.md` seed-mismatch warning, no
   historical-load Playwright spec, and no 92-row real CSV. Git was clean at
   start. The README that actually references the seed SKUs is `src/README.md`
   (the request-spine walkthrough), updated here to the confirmed SKU. The
   "flip the Playwright spec green" / Probe B / Probe D steps could not be run
   as written because those artifacts are absent. Verification was done at the
   data layer instead (see below). If a historical-load E2E spec + sample CSV
   are wanted, they still need to be authored.

2. The dev DB carries ~24 leftover `E2E-*` ProductVariant rows (mostly
   DISCONTINUED) from earlier E2E runs whose specs are not committed. Harmless
   to this change but they pollute `product_variants`; a clean reseed against a
   fresh DB would drop them. Left as-is.

Verification performed: `npx prisma db seed` (idempotent, 5 variants), tsc
--noEmit clean, and the exact service resolution query
(`supplierSkuCode IN (...)`) confirms the confirmed SKU and placeholders
resolve to ACTIVE variant ids (so historical-load no longer returns
unknown-SKU for them). Old `GSP-`/`ZSP-` codes: 0 rows remain.

### PO-line DISCONTINUED guard: the procurement decision, resolved (Prompt 33-D)

The 33-C open question (block new POs for discontinued variants?) is resolved:
yes. Purchase-order line creation now applies `assertVariantsActive` (noun
"purchase order lines") in both the `create` and the line-replacement `update`
paths, pre-transaction, with the same consistent 409 message. Rationale:
discontinued means "winding this down across the business", so issuing fresh
procurement contradicts the intent, and procurement may not know about the
deactivation; surfacing it at the spend decision is the point. Workaround for
the rare strategic-tail/backlog case is the standard one: reactivate, raise the
PO, deactivate again.

Where this leaves the variant guard map (for whoever revisits it):
- BLOCKED (new business): assembly start, SO lines, price entries,
  historical-load units (33-C), and now PO lines (33-D).
- NOT blocked (fulfilling existing commitments): manifest receipt (receiving
  already-ordered stock) and proforma-invoice lines (a PI documents a PO already
  placed; blocking it would strand an in-flight order). If operational use later
  shows a PI is ever raised for a genuinely new discontinued-variant purchase
  rather than against an existing PO, revisit the PI exclusion.

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

### SKD as a distinct unit state + SKD->CBU upgrade (Prompt 46a)

PRE-DEPLOY: TWO migrations. `20260625093138_add_skd_state_and_assembly_job_type`
adds the IN_WAREHOUSE_SKD enum value, the AssemblyJobType enum, the
AssemblyJob.jobType column (default CKD_TO_ASSEMBLED), drops the full unique on
assembly_jobs.unitId, and adds a partial unique index (one IN_PROGRESS job per
unit). `20260625093215_backfill_three_wheeler_cbu_to_skd` reclassifies existing
3-wheeler IN_WAREHOUSE_CBU units to IN_WAREHOUSE_SKD. SNAPSHOT prod before deploy.
The two migrations are split deliberately: Postgres forbids using a new enum value
in the same transaction that adds it, so the backfill (which uses
IN_WAREHOUSE_SKD) must be its own migration. The backfill is a NO-OP in production
(greenfield: zero completed 3-wheeler units), affecting only dev fixtures.

Backfill decision: OPTION (a) (reclassify CBU 3-wheelers to SKD) for operational
coherence with the model that 3-wheelers complete to SKD. Safe because SKD is
sellable exactly as CBU was.

- AssemblyJob reuse: confirmed it needed BOTH a jobType discriminator (drives the
  completion target and the cancel revert state) AND removal of the unitId unique
  (a unit now has multiple jobs over its lifetime). "One active job per unit" is
  preserved by the partial unique index. The Unit.assemblyJob relation became
  assemblyJobs[] (only a schema relation, never read in code).
- complete() branches: SKD_TO_CBU -> CBU; CKD_TO_ASSEMBLED 3-wheeler -> SKD,
  2-wheeler -> CBU. cancel() reverts to source by jobType (CKD or SKD). fail()
  unchanged (-> DAMAGED).
- New POST /api/assembly-jobs/upgrade (permission assembly.upgrade) creates the
  SKD_TO_CBU job; validates SKD + THREE_WHEELER (409 otherwise). Reuses the
  shared complete/fail/cancel endpoints.
- State machine + adjustment map: SKD mirrors every CBU edge plus the upgrade
  edge; SKD added as a restock target wherever CBU is.
- Sales: a CBU-form line accepts SKD or CBU units (3-wheelers sell from SKD).
- Reports: distinct skd bucket alongside cbu; both valued as on-hand stock.
- Seed: assembly.upgrade permission granted to the roles that hold
  assembly.perform.

Verified by `verify-46a.ts` (32/32, all 21 probes A-U including I-3 across the
upgrade lifecycle, concurrent mixed-type completions, and report bucketing),
since deleted.

### 2-wheeler / 3-wheeler product type integration (Prompt 45a)

PRE-DEPLOY: migration `20260625024147_product_variant_product_type` alters
`product_variants` (add nullable -> backfill THREE_WHEELER -> set NOT NULL).
Snapshot the production DB before the CI auto-deploy runs it (established
pre-deploy pattern). The backfill is data-touching but additive and reversible
by dropping the column + enum; it sets EVERY existing variant (the 5 seeded TVS
King variants plus any sentinel-attached auto-created variants) to THREE_WHEELER.

- Schema: `ProductType { TWO_WHEELER, THREE_WHEELER }` enum + required
  `productType` on ProductVariant.
- DTOs: create requires productType (400 if missing); update may change it
  (reclassification, non-cascading, see Open).
- Auto-create: defaults THREE_WHEELER (see Open).
- SO single-product-type: `assertSingleProductType` in `resolveLines` rejects a
  mixed set with a named 409 (implicit-from-first model, see Open).
- Assembly: unchanged, both types complete to CBU (no SKD state, see Open).
- Bank routing: two config-keyed accounts; sales PI + sales invoice route by the
  SO's product type via `bankForLines` (see Open).
- Pickers: `GET /api/product-variants?productType=&status=&search=` (new list
  endpoint); units list gains a `productType` filter (via the variant relation).
- Seed: the 5 variants set THREE_WHEELER explicitly; one placeholder TWO_WHEELER
  variant + product added for dev/testing.

Verified by `verify-45a.ts` (30/30, all 24 probes A-X including a real PDF-path
render, assembly for both types, bank routing on both documents, and concurrent
mixed-vs-uniform rejection), since deleted. Probe A "fresh DB" path is covered by
construction (the backfill UPDATE touches zero rows on an empty table); dev/prod
backfill verified live.

### Sales-side proforma invoice, auto-issued on SO creation (Prompt 43a)

New `SalesProformaInvoice` entity (`sales_proforma_invoices`): `piNumber` unique,
`salesOrderId` unique (one PI per SO), `issuedAt`, `issuedById` (the SO creator),
distinct from the procurement-side `ProformaInvoice` (untouched). Migration
`20260625005601_sales_proforma_invoice` (additive: new table + relations on
SalesOrder and User).

PI number sequence `PI-YYYY-NNNN` via `generateSalesPiNumber` (advisory lock key
49008, distinct from PO/SH/SO/invoice/DN/WB), same pattern as the other
generators: parses the current-year MAX suffix, NNNN resets at the year boundary.
Concurrency-safe by the advisory xact lock (verified: 5 concurrent SO creations
produced 5 distinct PI numbers).

Auto-issue hook in `SalesOrdersService.create`: the PI is created in the SAME
`$transaction` as the SO, with a distinct `salesproformainvoice.issue` audit
entry (context soId/piNumber/customerId) written tx-scoped. If anything in the
create fails the PI rolls back with the SO (verified: a failed create leaves no
orphan PI). `SO_DETAIL_INCLUDE` and the `findAll` list both now include
`salesProformaInvoice { id, piNumber, issuedAt }` so the frontend gets the
"View PI" link without a second fetch.

Rendering: NEW module `sales-proforma-invoices` exposes
`GET /api/sales-proforma-invoices/:id` (metadata), `/pdf` (inline, for
open-in-new-tab printing), `/html` (browser-printable), all gated
`salesorder.read`. The PI reuses the Direction C "Branded Band" DESIGN via a new
`sales-proforma-invoice.hbs` (shared CSS classes) bound to sales data
(Enviable as "From", customer as "Bill To", SO ref, Enviable bank for payment),
because the procurement `proforma-invoice.hbs` is hard-labeled for procurement
("From (Supplier)", "Purchase Order") and would render wrong for a customer.
New `buildSalesProformaInvoiceContext` + engine/renderer methods; procurement
context + template left untouched (verified: procurement PI still renders with
its own labels).

Also fixed the nest-cli asset-copy watch gap (see Open). Verified by
`verify-43a.ts` (30/30, all 14 probes A-N including a real PDF render, concurrency,
and year-rollover), since deleted.

### Overpayment handling at payment recording (Prompt 42a)

Audit-first finding: the prompt's premise (overpayment "produces an unhandled
error") was inaccurate. `record()` had no balance check and never rejected an
overpayment; `confirm()` already advances the SO via `received.gte(total)`, so
there was no stuck state and no error. The real gap was that overpayment was
accepted silently with no resolution capture (a hanging refund liability).

Implemented detection + resolution capture. **Persistence: option a** (extend
Payment with nullable `overpaymentAmount`, `overpaymentResolution`,
`refundMechanism`, `refundReference`, `creditNotes` + two enums
`OverpaymentResolution`, `RefundMechanism`). Rationale: Theresa's framing makes
the resolution metadata describing the payment, not a transactional entity with a
lifecycle; option b (separate entity) implies an out-of-scope reconciliation
workflow and forces offline-mirror wiring; option c (inverse Payment) pollutes
the `sum(CONFIRMED)` aggregation `confirm`/`cancel` rely on and models CREDIT
unnaturally. Option a is 1:1, atomic by construction (one row), no sync changes.

`record()` now computes `remaining = max(total - sum(CONFIRMED), 0)`, flags
`amount > remaining` as overpayment, and requires `overpaymentResolution` (400
otherwise); supplying a resolution with no overpayment is also a 400.
Payment row write + a distinct `payment.overpayment` audit entry commit in one
`$transaction` (the AuditInterceptor still writes the separate `payment.record`
entry post-handler). The record handler now injects `@CurrentUser` because the
in-service audit write needs the actor. Permission unchanged (`payment.record`).
Migration `20260624235756_payment_overpayment_resolution` (additive nullable
columns + enums; existing rows untouched).

Sales invoice extended: `buildSalesInvoiceContext` gains a `payment` summary
(Amount Paid / Balance Due from CONFIRMED payments, plus an Overpayment +
Resolution row when present); `sales-invoice.hbs` renders it conditionally so an
invoice with no payments is unchanged. Verified by `verify-42a.ts` (31/31:
probes A-H plus the partially-paid-SO edge), since deleted.

### Assembly cancel: intact reversal IN_ASSEMBLY -> IN_WAREHOUSE_CKD (Prompt 44a)

Audit-first finding rewrote the premise. Of the three reversals 44a asked for,
two already existed: `IN_ASSEMBLY -> DAMAGED` (`AssemblyService.fail`,
`POST /assembly-jobs/:id/fail`) and `IN_WAREHOUSE_CBU -> DAMAGED` (the prompt-39
adjust endpoint, adjustment-map). Only the clean cancel
(`IN_ASSEMBLY -> IN_WAREHOUSE_CKD`) was missing: legal in the state machine and
`AssemblyJobStatus.CANCELLED` defined, but no service method or route exposed it.

Added `AssemblyService.cancel(jobId, actorId, reason)` and
`POST /assembly-jobs/:id/cancel` (DTO with a required, trimmed, non-empty
`reason` mirroring `AdjustUnitDto`; `assembly.perform` gate; `@Audit(
'assembly.cancel', 'AssemblyJob')`). It transitions the unit via `transitionUnit`
so I-3 holds for free (one StockMovement in the same tx), closes the job
`CANCELLED` with `completedAt`/`notes`, and is rejected on any non-IN_PROGRESS
job. The reversal lives in the assembly module, not the adjust endpoint, by
design: the adjustment-map comment excludes `IN_ASSEMBLY` transitions as
workflow-owned.

Confirmed the #2 domain point is already encoded: the intact-to-CKD edge exists
ONLY from `IN_ASSEMBLY` (mid-assembly, no work done); `IN_WAREHOUSE_CBU` has no
edge back to a kit, so a finished tricycle cannot be un-built. No schema change
(DAMAGED/IN_REPAIR/DAMAGE all pre-existed). Verified by `verify-44a.ts` (23/23
assertions: clean cancel + movement shape, I-3, fail-path regression,
cancel-on-CANCELLED/COMPLETED rejection, downstream disposition reachability,
no-un-build invariant), since deleted.

### Audit beforeState capture for update and delete actions

`AuditInterceptor` now captures the pre-mutation row via best-effort
`req.params.id` -> `prisma[<entityTypeCamel>].findUnique` BEFORE `next.handle()`,
threading it through to `audit.write` as `beforeState`. Six probes
(`verify-audit-beforestate.ts`, 25/25 assertions) confirm semantic correctness
for update and delete (probe 1, 2), null for create (probe 3), no audit on
handler failure (probe 4), per-entity isolation (probe 5), 100%/0% counts
across the suite (probe 6).
