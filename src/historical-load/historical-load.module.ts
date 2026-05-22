import { Module } from '@nestjs/common';
import { HistoricalLoadController } from './historical-load.controller';
import { HistoricalLoadService } from './historical-load.service';

@Module({
  controllers: [HistoricalLoadController],
  providers: [HistoricalLoadService],
})
export class HistoricalLoadModule {}
