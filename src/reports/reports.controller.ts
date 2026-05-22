import { Controller, Get, Query } from '@nestjs/common';
import { Principal } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { StocksReportQueryDto } from './dto/stocks-report-query.dto';
import { ReportsService } from './reports.service';

const COST_VIEW_PERMISSION = 'costdata.view';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // Read-only, not audited. @CurrentUser() is injected here to read the
  // caller's permissions for cost-visibility gating (whether to compute the
  // spare-parts landed-cost valuation), NOT to write an actor column.
  @Get('stocks')
  @RequirePermissions('report.stocks')
  stocks(
    @Query() query: StocksReportQueryDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.reports.stocksReport(
      query.warehouseId,
      actor.permissions.includes(COST_VIEW_PERMISSION),
    );
  }
}
