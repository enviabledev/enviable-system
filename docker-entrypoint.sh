#!/bin/sh
set -e
# Apply pending migrations, then start the API.
npx prisma migrate deploy
exec node dist/src/main.js
