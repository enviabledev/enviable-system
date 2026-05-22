import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  controllers: [PricingController],
  providers: [PricingService],
  // Exported so the SalesOrders module can inject resolvePrice.
  exports: [PricingService],
})
export class PricingModule {}
