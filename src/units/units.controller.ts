import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Principal } from '../auth/auth.service';
import { Audit, CurrentUser, RequirePermissions } from '../common/decorators';
import { AdjustUnitDto } from './dto/adjust-unit.dto';
import { QueryUnitsDto } from './dto/query-units.dto';
import { UnitsService } from './units.service';

@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  // Read; not audited. landedCost stripping is handled by the global
  // CostVisibilityInterceptor for callers without costdata.view.
  @Get()
  @RequirePermissions('unit.read')
  findAll(@Query() query: QueryUnitsDto) {
    return this.units.findAll(query);
  }

  // Accepts either the cuid id or the engineNumber. Includes the unit's own
  // movement timeline (unit.read suffices for a unit's own history).
  @Get(':idOrEngineNumber')
  @RequirePermissions('unit.read')
  findOne(@Param('idOrEngineNumber') idOrEngineNumber: string) {
    return this.units.findOne(idOrEngineNumber);
  }

  // IT-admin adjustment (damage, demo, internal-use, write-off, repair). Routes
  // through transitionUnit (I-3); writes the movement actor, so it needs the
  // principal.
  @Post(':idOrEngineNumber/adjust')
  @HttpCode(200)
  @RequirePermissions('unit.adjust')
  @Audit('unit.adjust', 'Unit')
  adjust(
    @Param('idOrEngineNumber') idOrEngineNumber: string,
    @Body() dto: AdjustUnitDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.units.adjust(idOrEngineNumber, dto, actor.id);
  }
}
