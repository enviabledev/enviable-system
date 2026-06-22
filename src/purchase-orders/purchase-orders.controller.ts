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
import { Principal } from '../auth/auth.service';
import { Audit, CurrentUser, RequirePermissions } from '../common/decorators';
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

  // create/update may auto-create a variant for an unknown SKU; the actor is
  // written into that variant's auto-create audit row (triggeredBy), so the
  // principal is injected here rather than relied on from the interceptor.
  @Post()
  @RequirePermissions('po.create')
  @Audit('po.create', 'PurchaseOrder')
  create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() actor: Principal) {
    return this.purchaseOrders.create(dto, actor.id);
  }

  @Patch(':id')
  @RequirePermissions('po.create')
  @Audit('po.update', 'PurchaseOrder')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.purchaseOrders.update(id, dto, actor.id);
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
