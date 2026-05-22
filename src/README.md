# M1 Spine: end-to-end proof of chain

This walkthrough exercises the full request spine against real seeded data:

```
session cookie  ->  AuthGuard  ->  PermissionsGuard  ->  handler  ->  AuditInterceptor  ->  CostVisibilityInterceptor
```

The demo endpoint is `GET /products`. It is gated on the existing seeded
permission `pricelist.read` (there is no dedicated `product.read` key, and the
endpoint exposes `currentMarketPrice`, so the pricing read permission is the
closest fit) and annotated with `@Audit`. Auditing a read is for this
demonstration only; in production only mutations are audited.

## Prerequisites

- Postgres running (Docker container `enviable-postgres` on host port 5433) and
  migrated + seeded (`npx prisma migrate dev`, `npx prisma db seed`).
- API running with the global prefix `/api`:

  ```bash
  npm run start:dev
  ```

All routes below are under `http://localhost:3000/api`.

## 1. Set a real password

Seeded users carry a non-authenticating placeholder hash. Give one a real
password. `theresa` (Executive Director) holds `pricelist.read`, so she is the
permitted user:

```bash
npm run set-password -- theresa@enviable.example 'Theresa-Real-Pw-1'
```

## 2. Log in with a cookie jar

```bash
curl -i -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"theresa@enviable.example","password":"Theresa-Real-Pw-1"}'
```

Expect `200` and a `Set-Cookie: enviable.sid=...` header. The session id is
regenerated on login (session-fixation defence), so it differs from any
pre-login id.

## 3. Confirm the session resolves the principal

```bash
curl -s -b cookies.txt http://localhost:3000/api/auth/me
```

Returns `{ id, fullName, email, roles, permissions }`. The `permissions` array
is the deduplicated union of the user's roles' permissions (Invariant I-13).

## 4. Hit the gated, audited endpoint

```bash
curl -s -b cookies.txt http://localhost:3000/api/products
```

Returns the 2 seeded products (ordered by name), each with a manufacturer
summary and its variants:

```json
[
  {
    "id": "seed-prod-gsplus",
    "name": "TVS King GS+",
    "category": "PASSENGER",
    "manufacturer": { "id": "seed-cp-tvs", "name": "TVS Motor Company Limited", "type": "MANUFACTURER" },
    "variants": [
      { "id": "seed-var-gs-ecogreen", "supplierSkuCode": "GSP-ECO-GREEN", "variantAttributes": { "model": "GS+", "colour": "Eco Green" }, "currentMarketPrice": "2800000", "status": "ACTIVE" }
    ]
  }
]
```

## 5. Inspect the audit row

The successful read wrote one immutable audit row. `docker exec` needs `-i` when
feeding SQL over a heredoc on stdin:

```bash
docker exec -i enviable-postgres psql -U user -d enviable <<'SQL'
SELECT "actorUserId", action, "entityType", "entityId", jsonb_typeof("afterState") AS after_type
FROM audit_log_entries
WHERE "entityType" = 'Product'
ORDER BY "occurredAt" DESC
LIMIT 1;
SQL
```

`action = product.read`, `entityType = Product`, `entityId` is NULL (the
response is a collection), and `afterState` holds the full response.

## 6. Demonstrate a 403 (authenticated but missing the gate)

`kelechi` (Warehouse Manager) does NOT hold `pricelist.read`:

```bash
npm run set-password -- kelechi@enviable.example 'Kelechi-Real-Pw-1'

curl -s -c kelechi.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"kelechi@enviable.example","password":"Kelechi-Real-Pw-1"}' >/dev/null

curl -s -o /dev/null -w '%{http_code}\n' -b kelechi.txt http://localhost:3000/api/products
```

Expect `403`. The body names the missing key:
`{"message":"Missing permission(s): pricelist.read","error":"Forbidden","statusCode":403}`.
No audit row is written for a guard rejection.

An unauthenticated request returns `401`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/products
```

## 7. Log out

```bash
curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -X POST http://localhost:3000/api/auth/logout
```

After logout, `GET /api/auth/me` with the same jar returns `401`.

## 8. Reset to a clean verify state

Put the seeded test accounts back on the placeholder hash (scoped to the five
test accounts, idempotent):

```bash
npm run reset-test-passwords
```

```bash
rm -f cookies.txt kelechi.txt
```
