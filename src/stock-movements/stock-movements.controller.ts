import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto';
import { StockMovementsService } from './stock-movements.service';

@Controller('stock-movements')
export class StockMovementsController {
  constructor(private readonly stockMovements: StockMovementsService) {}

  // Cross-unit movement log: gated on the distinct movement.read permission,
  // separate from unit.read which only grants a unit's own history. Read; not
  // audited.
  @Get()
  @RequirePermissions('movement.read')
  findAll(@Query() query: QueryStockMovementsDto) {
    return this.stockMovements.findAll(query);
  }
}
