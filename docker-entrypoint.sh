#!/bin/sh
set -e
# Apply pending migrations (fatal — schema must match), then sync reference data
# via the idempotent seed, then start the API.
npx prisma migrate deploy
# Non-fatal: a seed hiccup must not crash-loop the app, which can run on existing
# data. Keeps RBAC/permissions/reference rows in sync on every deploy so new seed
# entries reach prod without a manual re-seed.
node dist-seed/seed.js || echo "WARN: seed failed; continuing with existing data"
exec node dist/src/main.js
