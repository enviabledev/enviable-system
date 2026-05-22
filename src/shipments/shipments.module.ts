import { Module } from '@nestjs/common';
import { LandedCostsController } from './landed-costs.controller';
import { LandedCostsService } from './landed-costs.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

@Module({
  controllers: [ShipmentsController, LandedCostsController],
  providers: [ShipmentsService, LandedCostsService],
  // Exported so the sync intake layer can reuse receiveUnits (idempotent wrapper).
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
