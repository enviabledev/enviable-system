import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Principal } from '../auth/auth.service';
import { Audit, CurrentUser, RequirePermissions } from '../common/decorators';
import { QueryPriceListDto } from './dto/query-price-list.dto';
import { SetPriceDto } from './dto/set-price.dto';
import { PricingService } from './pricing.service';

@Controller('price-list')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  // Selling price is the customer-facing figure, visible to all (not cost data;
  // the CostVisibilityInterceptor does not strip it). Read; not audited.
  @Get()
  @RequirePermissions('pricelist.read')
  findAll(@Query() query: QueryPriceListDto) {
    return this.pricing.findAll(query);
  }

  // Writes setById, so it needs the principal.
  @Post()
  @RequirePermissions('pricelist.manage')
  @Audit('pricelist.set', 'PriceListEntry')
  setPrice(@Body() dto: SetPriceDto, @CurrentUser() actor: Principal) {
    return this.pricing.setPrice(dto, actor.id);
  }
}
