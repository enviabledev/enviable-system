# M4 Sales: end-to-end walkthrough and acceptance

This walkthrough exercises the full sales lifecycle against the live server, the
way `src/README.md` proves the M1 request spine. It is a runnable acceptance
script, not a feature change. It covers three flows:

1. The complete lifecycle, customer to close: create customer, set and resolve a
   price, create a DRAFT sales order allocating a real available unit, submit,
   invoice, record and confirm payment, authorise release (the unit sells),
   delivery note, waybill, dispatch, proof of delivery, close.
2. A return flow on the sold unit: initiate, inspect, resolve.
3. A cancellation flow: allocate a unit to a fresh order, cancel it, then
   re-allocate the freed unit to a new order (proving the I-11 reservation lifts).

Every mutation below is recorded in the immutable audit log by the global
`AuditInterceptor`; the final section lists the rows it wrote.

## Prerequisites

- Postgres running (Docker container `enviable-postgres` on host port 5433),
  migrated and seeded (`npx prisma migrate dev`, `npx prisma db seed`).
- API built and running with the global prefix `/api`:

  ```bash
  npm run build && node dist/src/main.js
  ```

All routes are under `http://localhost:3000/api`.

The driving user is `itadmin` (IT Admin role, all permissions), so a single
session can exercise every step. In production these steps are split across
roles by permission (sales officer creates and records, a manager confirms and
authorises release, warehouse manages delivery); the per-route guards enforce
that separation. Give the account a real password (seeded users carry a
non-authenticating placeholder hash):

```bash
npm run set-password -- itadmin@enviable.example 'Walkthrough-Pw-1'
```

## Stock precondition: available units

A sale allocates a specific serialized Unit that already sits in the warehouse.
In normal operation those arrive through the M2 procurement chain (PO, proforma
invoice, shipment, manifest receipt). For an isolated sales walkthrough we seed
two `IN_WAREHOUSE_CKD` units directly behind a synthetic PO and shipment. Use
`docker exec -i` with a heredoc:

```bash
docker exec -i enviable-postgres psql -U user -d enviable <<'SQL'
INSERT INTO purchase_orders (id, "poNumber", "supplierId", status, currency, "totalValue", "createdAt", "updatedAt")
VALUES ('walk-po-1', 'PO-WALK-0001', 'seed-cp-tvs', 'FULLY_RECEIVED', 'USD', 0, now(), now());
INSERT INTO shipments (id, "purchaseOrderId", "shipmentReference", status, "createdAt", "updatedAt")
VALUES ('walk-ship-1', 'walk-po-1', 'SHIP-WALK-0001', 'RECEIVED', now(), now());
INSERT INTO units (id, "productVariantId", "shipmentId", "engineNumber", "chassisNumber", status, "currentWarehouseId", "createdAt", "updatedAt")
VALUES
 ('walk-unit-1','seed-var-gs-ecogreen','walk-ship-1','WALK-ENG-1','WALK-CHS-1','IN_WAREHOUSE_CKD','seed-wh-lagos', now(), now()),
 ('walk-unit-2','seed-var-gs-ecogreen','walk-ship-1','WALK-ENG-2','WALK-CHS-2','IN_WAREHOUSE_CKD','seed-wh-lagos', now(), now());
SQL
```

Raw-SQL columns are quoted camelCase (`"poNumber"`, not `po_number`); `@@map`
renames tables only, not columns.

## 0. Log in with a cookie jar

```bash
curl -s -c /tmp/walk.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"itadmin@enviable.example","password":"Walkthrough-Pw-1"}'
```

Returns `200` and sets the session cookie in `/tmp/walk.txt`. Every call below
sends `-b /tmp/walk.txt`.

## 1. Create a customer

The `ResellerStandard` tier is seeded; look up its id, then create a reseller on
it (the tier drives price resolution).

```bash
TIER=$(docker exec enviable-postgres psql -U user -d enviable -tAc \
  "SELECT id FROM customer_tiers WHERE name='ResellerStandard';")

curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/customers \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Adeyemi Tricycle Hub\",\"type\":\"RESELLER\",\"tierId\":\"$TIER\",\"phone\":\"+2348030000001\"}"
```

Returns the new customer (`status: ACTIVE`). Keep its `id` as `CUST`.

## 2. Set and resolve a price

Set the current selling price for the variant on the tier, then read it back.
Setting a new price supersedes any prior current entry atomically (one current
price per variant and tier, partial unique index).

```bash
VAR=seed-var-gs-ecogreen

curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/price-list \
  -H 'Content-Type: application/json' \
  -d "{\"productVariantId\":\"$VAR\",\"customerTierId\":\"$TIER\",\"price\":\"2800000.00\"}"

curl -s -b /tmp/walk.txt "http://localhost:3000/api/price-list?productVariantId=$VAR"
```

The set returns the new entry at `2800000.00`. The selling price is the
customer-facing figure and is visible to all roles; the `CostVisibilityInterceptor`
does not strip it (it strips landed cost, not selling price).

## 3. Create a DRAFT sales order (soft reservation)

One sales order line is one unit. Allocate `WALK-ENG-1` as a CKD line.

```bash
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders \
  -H 'Content-Type: application/json' \
  -d "{\"customerId\":\"$CUST\",\"lines\":[{\"productVariantId\":\"$VAR\",\"unitId\":\"walk-unit-1\",\"saleForm\":\"CKD\"}]}"
```

Returns `SO-2026-0001`, `status: DRAFT`, `total: 3010000`, `vatAmount: 210000`
(2,800,000 net plus 7.5 percent VAT). The allocation is a soft reservation: the
line holds the unit via `unitId`, but the unit stays `IN_WAREHOUSE_CKD`. No unit
state change happens until release. Keep the order id as `SO`.

## 4. Submit

```bash
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders/$SO/submit
```

`status: AWAITING_PAYMENT`.

## 5. Generate the invoice

```bash
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders/$SO/invoice
```

Returns `INV-2026-0001`, `vatRate: 0.075`, `total: 3010000`. The invoice
snapshots the financial values at this moment; it is a fixed document and does
not recompute from the order later. One invoice per order is enforced.

## 6. Record and confirm payment

Recording and confirming are deliberately separate permissions and steps
(`payment.record` then `payment.confirm`): separation of duties. A payment is
created PENDING and only a CONFIRMED payment counts toward the order.

```bash
PAY=$(curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders/$SO/payments \
  -H 'Content-Type: application/json' \
  -d '{"paymentMethodId":"seed-pm-bank","amount":"3010000.00","referenceNumber":"NIBSS-REF-001"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/payments/$PAY/confirm
```

Confirming re-derives the order's `paymentReceivedTotal` as the sum of confirmed
payments and, because that now covers the total, advances the order from
AWAITING_PAYMENT to `PAYMENT_RECEIVED` with `paymentReceivedTotal: 3010000.00`.

## 7. Authorise release (the unit sells)

This is the point where the unit actually leaves inventory. In one transaction
the service re-aggregates the confirmed-payment sum and asserts it covers the
total (Invariant I-4, defence in depth: the sum is recomputed here, not inferred
from the status), creates the release authorisation, and transitions the
allocated unit to its SOLD state with a SALE movement (Invariant I-3).

```bash
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders/$SO/authorise-release
```

Order `status: RELEASE_AUTHORISED`. The unit is now `SOLD_AS_CKD` with `soldAt`
set, a `SALE` movement `IN_WAREHOUSE_CKD -> SOLD_AS_CKD` written, and one
`release_authorisations` row.

## 8 to 12. Delivery note, waybill, dispatch, proof of delivery, close

Fulfilment tracks the physical handover and walks the order through the legal
sequence. None of these change unit status (the unit is already SOLD from
release); they advance the order only.

```bash
# Delivery note: RELEASE_AUTHORISED -> READY_FOR_DISPATCH
DN=$(curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders/$SO/delivery-note \
  -H 'Content-Type: application/json' \
  -d '{"vehicleReg":"LAG-123-XY","driverName":"Musa Bello"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# Waybill against the delivery note
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/delivery-notes/$DN/waybill

# Dispatch -> DISPATCHED
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders/$SO/dispatch

# Proof of delivery -> DELIVERED
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders/$SO/proof-of-delivery \
  -H 'Content-Type: application/json' -d '{"receivedBy":"Adeyemi O."}'

# Close -> CLOSED
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders/$SO/close
```

In order: `DN-2026-0001` and the order at READY_FOR_DISPATCH; `WB-2026-0001`;
`DISPATCHED` with `dispatchedAt` set; `DELIVERED` with `deliveredAt` set;
`CLOSED`. The lifecycle is complete.

## Return flow

A return is only allowed on a unit currently in a SOLD state (Invariant I-15)
and on the order it was sold against. We return the unit just sold on
`SO-2026-0001`. Initiate moves the unit SOLD to RETURNED in one transaction with
a RETURN movement; inspect and resolve follow.

```bash
RET=$(curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders/$SO/returns \
  -H 'Content-Type: application/json' \
  -d '{"unitId":"walk-unit-1","reason":"engine misfire on delivery inspection"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# Inspect: INITIATED -> INSPECTING
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/returns/$RET/inspect

# Resolve with a disposition: REPAIR (or WRITE_OFF)
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/returns/$RET/resolve \
  -H 'Content-Type: application/json' -d '{"disposition":"REPAIR"}'
```

Initiate returns the return at `INITIATED` / `PENDING_DECISION`, with the unit at
`RETURNED` (movement `SOLD_AS_CKD -> RETURNED`). Inspect sets `INSPECTING`.
Resolve with REPAIR sets the return `RESOLVED` and the unit `IN_REPAIR` (movement
`RETURNED -> IN_REPAIR`). A WRITE_OFF disposition would instead move the unit to
`WRITTEN_OFF`.

## Cancellation flow

Cancellation is for an order whose units have not yet sold (DRAFT,
AWAITING_PAYMENT, or PAYMENT_RECEIVED). It frees the soft reservation by nulling
each line's `unitId`. Because the `one_active_so_line_per_unit` index is partial
(`WHERE unitId IS NOT NULL`), nulling lifts the I-11 block and the unit can be
allocated again. We allocate `WALK-ENG-2`, cancel, then re-allocate it.

```bash
# Allocate WALK-ENG-2 to a fresh DRAFT order
SO2=$(curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders \
  -H 'Content-Type: application/json' \
  -d "{\"customerId\":\"$CUST\",\"lines\":[{\"productVariantId\":\"$VAR\",\"unitId\":\"walk-unit-2\",\"saleForm\":\"CKD\"}]}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# Cancel with a mandatory reason
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders/$SO2/cancel \
  -H 'Content-Type: application/json' -d '{"reason":"customer switched to ZS+ model"}'

# Re-allocate the freed WALK-ENG-2 to a new order: succeeds (201)
curl -s -b /tmp/walk.txt -X POST http://localhost:3000/api/sales-orders \
  -H 'Content-Type: application/json' \
  -d "{\"customerId\":\"$CUST\",\"lines\":[{\"productVariantId\":\"$VAR\",\"unitId\":\"walk-unit-2\",\"saleForm\":\"CKD\"}]}"
```

`SO-2026-0002` cancels to `CANCELLED` with `refundOutstanding: false`,
`refundAmount: 0` (no confirmed payment existed), and the real cancellation
columns written (`cancellationReason`, `cancelledAt`, `cancelledById`). The line
`unitId` is nulled and the unit stays `IN_WAREHOUSE_CKD` (it was never moved).
The re-allocation to `SO-2026-0003` returns `201` and holds `WALK-ENG-2`,
proving the reservation lifted. Had the cancelled order carried a confirmed
payment, `refundOutstanding` would be true with the amount surfaced (the refund
itself is out of scope and is not processed).

## Audit trail

Every mutation above wrote an immutable audit row. After the run:

```bash
docker exec enviable-postgres psql -U user -d enviable -tAc \
  "SELECT action, count(*) FROM audit_log_entries GROUP BY action ORDER BY action;"
```

```
customer.create     1
delivery.note       1
delivery.proof      1
delivery.waybill    1
payment.confirm     1
payment.record      1
pricelist.set       1
return.initiate     1
return.inspect      1
return.resolve      1
salesorder.cancel   1
salesorder.close    1
salesorder.create   3   (lifecycle order, cancelled order, re-allocated order)
salesorder.dispatch 1
salesorder.invoice  1
salesorder.release  1
salesorder.submit   1
```

Reads (price-list query, order and return GETs) are not audited; only mutations
are.

## Teardown

Return the database to a clean verify state: remove the synthetic domain rows
(seeded reference data stays intact) and reset the password changed above.

```bash
docker exec enviable-postgres psql -U user -d enviable -c "DELETE FROM returns; DELETE FROM release_authorisations; DELETE FROM payments; DELETE FROM invoices; DELETE FROM proofs_of_delivery; DELETE FROM waybills; DELETE FROM delivery_notes; DELETE FROM sales_order_lines; DELETE FROM sales_orders; DELETE FROM stock_movements; DELETE FROM units; DELETE FROM shipments; DELETE FROM purchase_orders WHERE \"poNumber\"='PO-WALK-0001'; DELETE FROM customers; DELETE FROM audit_log_entries;"

npm run reset-test-passwords
```

After teardown there are no test orders, units, payments, or returns, and the
seeded permissions, roles, users, counterparties, products, variants, tiers,
price list, payment methods, and warehouse are untouched.
