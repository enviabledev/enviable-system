import { Module } from '@nestjs/common';
import { SparePartsController } from './spare-parts.controller';
import { SparePartsService } from './spare-parts.service';

@Module({
  controllers: [SparePartsController],
  providers: [SparePartsService],
})
export class SparePartsModule {}
