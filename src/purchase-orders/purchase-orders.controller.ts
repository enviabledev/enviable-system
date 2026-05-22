import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Audit, RequirePermissions } from '../common/decorators';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { QueryPurchaseOrdersDto } from './dto/query-purchase-orders.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  @Get()
  @RequirePermissions('po.read')
  findAll(@Query() query: QueryPurchaseOrdersDto) {
    return this.purchaseOrders.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('po.read')
  findOne(@Param('id') id: string) {
    return this.purchaseOrders.findOne(id);
  }

  @Post()
  @RequirePermissions('po.create')
  @Audit('po.create', 'PurchaseOrder')
  create(@Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrders.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('po.create')
  @Audit('po.update', 'PurchaseOrder')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto) {
    return this.purchaseOrders.update(id, dto);
  }

  // Action POSTs return the row (200, not 201) so the AuditInterceptor sees a
  // body and can extract entityId.
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('po.submit')
  @Audit('po.submit', 'PurchaseOrder')
  submit(@Param('id') id: string) {
    return this.purchaseOrders.submit(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('po.approve')
  @Audit('po.approve', 'PurchaseOrder')
  approve(@Param('id') id: string) {
    return this.purchaseOrders.approve(id);
  }
}
