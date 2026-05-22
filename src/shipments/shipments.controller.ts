import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Audit, RequirePermissions } from '../common/decorators';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { QueryShipmentsDto } from './dto/query-shipments.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { ShipmentsService } from './shipments.service';

@Controller()
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get('shipments')
  @RequirePermissions('shipment.read')
  findAll(@Query() query: QueryShipmentsDto) {
    return this.shipments.findAll(query);
  }

  @Get('shipments/:id')
  @RequirePermissions('shipment.read')
  findOne(@Param('id') id: string) {
    return this.shipments.findOne(id);
  }

  @Post('purchase-orders/:poId/shipments')
  @RequirePermissions('shipment.manage')
  @Audit('shipment.create', 'Shipment')
  create(@Param('poId') poId: string, @Body() dto: CreateShipmentDto) {
    return this.shipments.create(poId, dto);
  }

  @Patch('shipments/:id')
  @RequirePermissions('shipment.manage')
  @Audit('shipment.update', 'Shipment')
  update(@Param('id') id: string, @Body() dto: UpdateShipmentDto) {
    return this.shipments.update(id, dto);
  }
}
