import { Controller, Get, Query } from '@nestjs/common';
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
}
