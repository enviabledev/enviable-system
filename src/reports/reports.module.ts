import { Module } from '@nestjs/common';
import { AuditLogReportService } from './audit-log-report.service';
import { CustomersReportService } from './customers-report.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { RevenueReportService } from './revenue-report.service';

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    RevenueReportService,
    CustomersReportService,
    AuditLogReportService,
  ],
})
export class ReportsModule {}
