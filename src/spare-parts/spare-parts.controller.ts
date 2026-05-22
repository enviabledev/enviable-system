import { Controller, Get, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators';
import { QuerySparePartsDto } from './dto/query-spare-parts.dto';
import { SparePartsService } from './spare-parts.service';

// Read-only at MVP: spare parts are receive-and-store only (no sale), and
// receipt happens via the historical load (and any later receipt flow), so
// there are no mutation endpoints here. Reads not audited. landedCostPerUnit
// stripping is handled by the global CostVisibilityInterceptor.
@Controller('spare-parts')
export class SparePartsController {
  constructor(private readonly spareParts: SparePartsService) {}

  @Get()
  @RequirePermissions('sparepart.read')
  findAll(@Query() query: QuerySparePartsDto) {
    return this.spareParts.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('sparepart.read')
  findOne(@Param('id') id: string) {
    return this.spareParts.findOne(id);
  }
}
