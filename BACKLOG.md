# Backend backlog (enviable-system)

Real, accepted issues parked for later. Surface findings here as they come up so
they're not lost between sessions. The `Deferred / hardening backlog` section in
`CLAUDE.md` covers the production-cutover items (session fixation, VAT rounding,
etc.); this file is the working backlog for issues discovered during ongoing
implementation that don't belong in CLAUDE.md.

## Open

### Audit beforeState: handlers with non-`:id` URL params capture null

The `AuditInterceptor.captureBeforeState` heuristic reads `req.params.id` to
look up the pre-mutation row. Three @Audit-annotated handlers use a different
param name and therefore yield null beforeState even though the entity exists
pre-handler:

- `POST /historical-load/units/:shipmentId` (`historical.units`, entityType
  `Shipment`).
- `POST /historical-load/shipment` (`historical.shipment`, no id param).
- `POST /historical-load/spare-parts` (`historical.spareparts`, no id param).

For the historical bulk-load flows these are effectively create-many operations
(loading manifests / spare-parts into a target shipment), so null beforeState is
defensible as the "no prior state in the audited subject" reading. But the
historical.units row would arguably benefit from capturing the parent Shipment's
pre-load state. Two clean paths if precise per-shipment beforeState is later
wanted:

1. Rename the URL param from `:shipmentId` to `:id` (the convention every other
   audited handler follows). Trivial in the controller, zero call-site change
   externally beyond the URL.
2. Extend the `@Audit(action, entityType)` decorator with an optional third
   field naming the param to use (e.g. `@Audit('historical.units', 'Shipment',
   { paramKey: 'shipmentId' })`). Keeps URL conventions but adds API surface to
   the decorator.

Recommended: (1). Defer until someone needs offline-recoverable pre-load state
for historical loads.

### Audit write is fire-and-forget, NOT transactional with the handler

The interceptor's `record()` is invoked via `void this.record(...)` inside a
`tap` on the response observable. This means:

- The audit write runs AFTER the handler has completed and the response has
  been emitted. It is not part of the handler's transaction.
- A handler throw means `tap(next)` never fires, so no audit row is written
  (verified by Probe 4 of the beforeState rollout).
- An `audit.write` failure logs to the Logger but does not affect the
  already-emitted response.

This is the established design and matches the invariant ("audit is the system
of record"), but it does mean an audit row's existence is not strictly atomic
with the mutation: a handler that successfully mutates but then dies before
`tap` can fire (e.g. the process is killed between handler return and the
audit insert) would leave the mutation committed without an audit row.
Likelihood is extremely low in practice; raising the bar would require either
wrapping the audit in the handler's transaction (requires plumbing the audit
through every audited service) or queueing audit writes via an outbox pattern.

Not actionable now; surfaced so it isn't rediscovered as a "bug" later.

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
