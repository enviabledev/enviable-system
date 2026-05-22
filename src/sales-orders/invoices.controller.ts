import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators';
import { SalesOrdersService } from './sales-orders.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly salesOrders: SalesOrdersService) {}

  @Get(':id')
  @RequirePermissions('salesorder.read')
  findOne(@Param('id') id: string) {
    return this.salesOrders.getInvoice(id);
  }
}
