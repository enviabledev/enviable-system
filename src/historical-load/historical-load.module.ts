import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { HistoricalLoadController } from './historical-load.controller';
import { HistoricalLoadService } from './historical-load.service';

@Module({
  imports: [AuditModule],
  controllers: [HistoricalLoadController],
  providers: [HistoricalLoadService],
})
export class HistoricalLoadModule {}
