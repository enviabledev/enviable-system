import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Audit, RequirePermissions } from '../common/decorators';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller()
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('customers')
  @RequirePermissions('customer.read')
  findAll(@Query() query: QueryCustomersDto) {
    return this.customers.findAll(query);
  }

  @Get('customer-tiers')
  @RequirePermissions('customer.read')
  listTiers() {
    return this.customers.listTiers();
  }

  @Get('customers/:id')
  @RequirePermissions('customer.read')
  findOne(@Param('id') id: string) {
    return this.customers.findOne(id);
  }

  @Post('customers')
  @RequirePermissions('customer.manage')
  @Audit('customer.create', 'Customer')
  create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Patch('customers/:id')
  @RequirePermissions('customer.manage')
  @Audit('customer.update', 'Customer')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(id, dto);
  }

  // Soft delete; returns the row (200) so the AuditInterceptor extracts entityId.
  @Delete('customers/:id')
  @HttpCode(200)
  @RequirePermissions('customer.manage')
  @Audit('customer.delete', 'Customer')
  remove(@Param('id') id: string) {
    return this.customers.softDelete(id);
  }
}
