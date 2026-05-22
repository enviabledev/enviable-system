import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { CostVisibilityInterceptor } from './common/interceptors/cost-visibility.interceptor';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AuditModule,
  ],
  providers: [
    // Global guards execute in registration order. AuthGuard MUST be first: it
    // validates the session and attaches the principal that PermissionsGuard
    // (second) reads to enforce @RequirePermissions. Authentication (401) is
    // therefore resolved before authorisation (403).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // ORDERING IS DELIBERATE. Nest processes interceptors' response operators in
    // REVERSE registration order: the LAST-registered interceptor transforms the
    // response FIRST, the first-registered transforms LAST (it is outermost and
    // closest to the client). We need the audit row to keep the FULL response
    // while the client receives the cost-stripped one. So CostVisibility is
    // registered FIRST (outermost): AuditInterceptor (inner) runs first on the
    // way out and captures the full, unstripped response via its tap, then
    // CostVisibility strips cost fields for the client. The audit log is the
    // system of record and keeps full truth; privacy comes from gating
    // audit.read, not from sanitising stored rows.
    // DO NOT SWAP THIS ORDER without revisiting that design call: swapping makes
    // the audit row capture the stripped response (verified: it does), breaking
    // Invariant I-8's design where audit retains the full computed result.
    { provide: APP_INTERCEPTOR, useClass: CostVisibilityInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
