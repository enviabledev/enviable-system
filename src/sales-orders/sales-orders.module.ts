import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { InvoicesController } from './invoices.controller';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';

@Module({
  imports: [PricingModule],
  controllers: [SalesOrdersController, InvoicesController],
  providers: [SalesOrdersService],
})
export class SalesOrdersModule {}
