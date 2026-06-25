import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { PricingModule } from '../pricing/pricing.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { InvoicesController } from './invoices.controller';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';

@Module({
  imports: [PricingModule, DocumentsModule, AuditModule],
  controllers: [SalesOrdersController, InvoicesController, DeliveryController],
  providers: [SalesOrdersService, DeliveryService],
  // Exported so the sync intake layer can reuse create (idempotent wrapper).
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
