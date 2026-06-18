import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AssemblyModule } from './assembly/assembly.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/guards/auth.guard';
import { PasswordResetGuard } from './common/guards/password-reset.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { CostVisibilityInterceptor } from './common/interceptors/cost-visibility.interceptor';
import { CounterpartiesModule } from './counterparties/counterparties.module';
import { CustomersModule } from './customers/customers.module';
import { HistoricalLoadModule } from './historical-load/historical-load.module';
import { PaymentsModule } from './payments/payments.module';
import { PricingModule } from './pricing/pricing.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { ProformaInvoicesModule } from './proforma-invoices/proforma-invoices.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { ReportsModule } from './reports/reports.module';
import { ReturnsModule } from './returns/returns.module';
import { SalesOrdersModule } from './sales-orders/sales-orders.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { SparePartsModule } from './spare-parts/spare-parts.module';
import { StockMovementsModule } from './stock-movements/stock-movements.module';
import { RolesModule } from './roles/roles.module';
import { SyncModule } from './sync/sync.module';
import { UnitsModule } from './units/units.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AuditModule,
    ProductsModule,
    CounterpartiesModule,
    PurchaseOrdersModule,
    ProformaInvoicesModule,
    ShipmentsModule,
    HistoricalLoadModule,
    UnitsModule,
    StockMovementsModule,
    SparePartsModule,
    AssemblyModule,
    CustomersModule,
    PricingModule,
    SalesOrdersModule,
    PaymentsModule,
    ReturnsModule,
    ReportsModule,
    SyncModule,
    UsersModule,
    RolesModule,
  ],
  providers: [
    // Global guards execute in registration order. AuthGuard MUST be first: it
    // validates the session and attaches the principal that the later guards
    // read. PasswordResetGuard runs second: a user whose mustResetPassword flag
    // is set is confined to the reset endpoint before any authorisation check.
    // PermissionsGuard runs last and enforces @RequirePermissions. So the order
    // is authentication (401) -> forced-reset gate (403) -> authorisation (403).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PasswordResetGuard },
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
