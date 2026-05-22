import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import connectRedis from 'connect-redis';
import session from 'express-session';
import { Redis } from 'ioredis';
import { AppModule } from './app.module';
import { SESSION_COOKIE_NAME } from './auth/auth.controller';
import { PrismaService } from './prisma/prisma.service';

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 8; // 8 hours

/**
 * Build the session store from the environment. SESSION_STORE=redis uses a
 * Redis-backed store (connect-redis over ioredis) at REDIS_URL, the production
 * target (Upstash). Unset falls back to express-session's in-memory store so
 * local dev needs no Redis. Returning undefined makes express-session use its
 * default MemoryStore.
 */
function buildSessionStore(): session.Store | undefined {
  if (process.env.SESSION_STORE !== 'redis') {
    return undefined;
  }
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('SESSION_STORE=redis but REDIS_URL is not set.');
  }
  // connect-redis v6 is the ioredis-compatible line (its set/touch use ioredis
  // argument style); v7+ switched to the node-redis v5 options object. The store
  // derives each key's TTL from the cookie maxAge and implements touch(), so the
  // store TTL slides on every request under rolling. The prefix namespaces our
  // keys away from anything else on the same Redis.
  const RedisStore = connectRedis(session);
  const client = new Redis(redisUrl);
  return new RedisStore({ client, prefix: 'enviable:sess:' });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Hard-fail at startup if the session secret is missing. ConfigModule has
  // loaded .env into process.env by the time the app is created.
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is not set. Refusing to start.');
  }

  app.use(
    session({
      name: SESSION_COOKIE_NAME,
      secret: process.env.SESSION_SECRET,
      store: buildSessionStore(),
      // resave false: do not rewrite an unmodified session on every request.
      // rolling true: re-set the cookie on every response so the 8h expiry
      // slides with activity. The two are not in tension: express-session calls
      // store.touch() for an unmodified session on each request (both MemoryStore
      // and connect-redis implement touch), so the STORE TTL slides too, not just
      // the cookie. This is the corrected rolling/resave setting now that a real
      // store is involved (the deferred-backlog item this closes). The
      // regenerate()-on-login session-fixation defence (auth.controller) is
      // unchanged.
      resave: false,
      rolling: true,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_MAX_AGE_MS,
      },
    }),
  );

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
