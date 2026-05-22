import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import { AppModule } from './app.module';
import { SESSION_COOKIE_NAME } from './auth/auth.controller';
import { PrismaService } from './prisma/prisma.service';

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
      resave: false,
      saveUninitialized: false,
      // In-memory MemoryStore for now. The Redis (Upstash) production store
      // lands in M5; the rolling/resave expiry tuning is also deferred to M5.
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 8,
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
