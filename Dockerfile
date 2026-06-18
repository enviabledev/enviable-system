# ---- build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
# Transpile the (TypeScript) seed to plain JS so the runtime image (which has no
# ts-node) can run it on deploy. seed.ts imports only @prisma/client, so this is
# self-contained. Explicit flags = tsconfig.json is ignored for this invocation.
# tsc can exit non-zero on type-only errors yet still emit JS, so gate the build
# on the emitted file existing rather than on tsc's exit code.
RUN npx tsc prisma/seed.ts --outDir dist-seed --rootDir prisma \
      --module commonjs --target es2021 --esModuleInterop --skipLibCheck; \
    test -f dist-seed/seed.js

# ---- runtime stage ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chromium + libs for puppeteer-core PDF rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      libnss3 \
      libatk-bridge2.0-0 \
      libdrm2 \
      libgbm1 \
      libasound2 \
      ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
# prisma is a production dependency (not devDependency), so npm ci --omit=dev
# includes the prisma CLI needed for `npx prisma migrate deploy` at entrypoint.
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Copy generated Prisma client artefacts (query engine + type bindings)
# produced by `prisma generate` in the build stage.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
# The generated client can ship a query engine whose OpenSSL target mismatches
# the runtime (a Prisma native-detection quirk on -slim images: .prisma/client
# gets the 1.1.x engine while the runtime is debian-openssl-3.0.x). Place the
# matching 3.0.x query engine — present in @prisma/engines and already used by
# the schema engine for migrations — where Prisma Client looks for it. Fails the
# build loudly if absent, rather than crash-looping at runtime.
RUN cp -f node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node \
        node_modules/.prisma/client/
COPY --from=build /app/prisma ./prisma
# Compiled idempotent seed, run by the entrypoint after migrations.
COPY --from=build /app/dist-seed ./dist-seed
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
