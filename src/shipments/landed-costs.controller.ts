import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Audit, RequirePermissions } from '../common/decorators';
import { CreateLandedCostDto } from './dto/create-landed-cost.dto';
import { UpdateLandedCostDto } from './dto/update-landed-cost.dto';
import { LandedCostsService } from './landed-costs.service';

// Every endpoint requires BOTH landedcost.manage AND costdata.view: managing
// cost requires being allowed to see cost. The PermissionsGuard requires every
// listed key, so a manage-without-cost user and a cost-without-manage user are
// both blocked.
@Controller()
export class LandedCostsController {
  constructor(private readonly landedCosts: LandedCostsService) {}

  @Get('shipments/:id/landed-costs')
  @RequirePermissions('landedcost.manage', 'costdata.view')
  list(@Param('id') id: string) {
    return this.landedCosts.list(id);
  }

  @Post('shipments/:id/landed-costs')
  @RequirePermissions('landedcost.manage', 'costdata.view')
  @Audit('landedcost.create', 'LandedCost')
  add(@Param('id') id: string, @Body() dto: CreateLandedCostDto) {
    return this.landedCosts.addComponent(id, dto);
  }

  @Patch('landed-costs/:id')
  @RequirePermissions('landedcost.manage', 'costdata.view')
  @Audit('landedcost.update', 'LandedCost')
  update(@Param('id') id: string, @Body() dto: UpdateLandedCostDto) {
    return this.landedCosts.update(id, dto);
  }

  @Post('shipments/:id/allocate-landed-cost')
  @HttpCode(200)
  @RequirePermissions('landedcost.manage', 'costdata.view')
  @Audit('landedcost.allocate', 'Shipment')
  allocate(@Param('id') id: string) {
    return this.landedCosts.allocate(id);
  }
}
