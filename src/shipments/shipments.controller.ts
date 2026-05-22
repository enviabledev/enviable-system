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
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { QueryShipmentsDto } from './dto/query-shipments.dto';
import { ReceiveUnitsDto } from './dto/receive-units.dto';
import { ResolveVarianceDto } from './dto/resolve-variance.dto';
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

  // receive-units writes StockMovement.actorId, so it needs the principal.
  @Post('shipments/:id/receive-units')
  @HttpCode(200)
  @RequirePermissions('shipment.receive')
  @Audit('shipment.receive', 'Shipment')
  receiveUnits(
    @Param('id') id: string,
    @Body() dto: ReceiveUnitsDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.shipments.receiveUnits(id, dto, actor.id);
  }

  @Post('shipments/:id/resolve-variance')
  @HttpCode(200)
  @RequirePermissions('shipment.receive')
  @Audit('shipment.resolve-variance', 'Shipment')
  resolveVariance(@Param('id') id: string, @Body() dto: ResolveVarianceDto) {
    return this.shipments.resolveVariance(id, dto);
  }

  @Post('shipments/:id/complete-receipt')
  @HttpCode(200)
  @RequirePermissions('shipment.receive')
  @Audit('shipment.complete-receipt', 'Shipment')
  completeReceipt(@Param('id') id: string) {
    return this.shipments.completeReceipt(id);
  }

  @Post('shipments/:id/close')
  @HttpCode(200)
  @RequirePermissions('shipment.manage')
  @Audit('shipment.close', 'Shipment')
  close(@Param('id') id: string) {
    return this.shipments.close(id);
  }
}
