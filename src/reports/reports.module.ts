import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { RevenueReportService } from './revenue-report.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, RevenueReportService],
})
export class ReportsModule {}
