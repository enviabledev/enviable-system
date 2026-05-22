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
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { QuerySalesOrdersDto } from './dto/query-sales-orders.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrdersService } from './sales-orders.service';

const DISCOUNT_PERMISSION = 'salesorder.discount';

@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly salesOrders: SalesOrdersService) {}

  @Get()
  @RequirePermissions('salesorder.read')
  findAll(@Query() query: QuerySalesOrdersDto) {
    return this.salesOrders.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('salesorder.read')
  findOne(@Param('id') id: string) {
    return this.salesOrders.findOne(id);
  }

  // Writes createdById; also needs the principal's permissions to gate discounts.
  @Post()
  @RequirePermissions('salesorder.create')
  @Audit('salesorder.create', 'SalesOrder')
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() actor: Principal) {
    return this.salesOrders.create(
      dto,
      actor.id,
      actor.permissions.includes(DISCOUNT_PERMISSION),
    );
  }

  @Patch(':id')
  @RequirePermissions('salesorder.create')
  @Audit('salesorder.update', 'SalesOrder')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalesOrderDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.salesOrders.update(
      id,
      dto,
      actor.id,
      actor.permissions.includes(DISCOUNT_PERMISSION),
    );
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('salesorder.create')
  @Audit('salesorder.submit', 'SalesOrder')
  submit(@Param('id') id: string) {
    return this.salesOrders.submit(id);
  }
}
