import { Controller, Get, Query } from '@nestjs/common';
import { Principal } from '../auth/auth.service';
import {
  CurrentUser,
  RequirePermissions,
  SkipCostStrip,
} from '../common/decorators';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { CustomersReportQueryDto } from './dto/customers-report-query.dto';
import { RevenueReportQueryDto } from './dto/revenue-report-query.dto';
import { StocksReportQueryDto } from './dto/stocks-report-query.dto';
import { AuditLogReportService } from './audit-log-report.service';
import { CustomersReportService } from './customers-report.service';
import { ReportsService } from './reports.service';
import { RevenueReportService } from './revenue-report.service';

const COST_VIEW_PERMISSION = 'costdata.view';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly revenue: RevenueReportService,
    private readonly customers: CustomersReportService,
    private readonly auditLogReport: AuditLogReportService,
  ) {}

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

  // Read-only, not audited. @CurrentUser() is injected to read the caller's
  // permissions for cost-visibility gating (whether to compute margin), NOT to
  // write an actor column.
  @Get('revenue')
  @RequirePermissions('report.revenue')
  revenueReport(
    @Query() query: RevenueReportQueryDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.revenue.revenueReport(
      query.from,
      query.to,
      query.topN,
      actor.permissions.includes(COST_VIEW_PERMISSION),
    );
  }

  // Read-only, not audited. Outstanding balance is a sales/AR figure (not cost
  // data), so no cost gating here.
  @Get('customers')
  @RequirePermissions('report.customers')
  customersReport(@Query() query: CustomersReportQueryDto) {
    return this.customers.customersReport(query);
  }

  // Most sensitive read. @SkipCostStrip(): the audit log is the immutable system
  // of record and must return the COMPLETE entry (cost data in afterState
  // included) to any audit.read holder, even one lacking costdata.view. Privacy
  // comes from gating audit.read (I-8 design). Not @Audit-annotated, so reading
  // the audit log is not itself audited (no recursion).
  @Get('audit-log')
  @RequirePermissions('audit.read')
  @SkipCostStrip()
  auditLog(@Query() query: AuditLogQueryDto) {
    return this.auditLogReport.list(query);
  }

  @Get('audit-log/stats')
  @RequirePermissions('audit.read')
  @SkipCostStrip()
  auditLogStats(@Query() query: AuditLogQueryDto) {
    return this.auditLogReport.stats(query);
  }
}
