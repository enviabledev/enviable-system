import { Controller, Get, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators';
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
}
