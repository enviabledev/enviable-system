import { Controller, Get } from '@nestjs/common';
import { Audit, RequirePermissions } from '../common/decorators';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // Gate: there is no dedicated product.read permission in the seed, and this
  // endpoint exposes currentMarketPrice, so pricelist.read is the closest
  // existing read permission. We use an existing key rather than invent one.
  //
  // @Audit on a READ is for the M1 proof-of-chain demonstration only. Reads are
  // not normally audited in production (only mutations are).
  @Get()
  @RequirePermissions('pricelist.read')
  @Audit('product.read', 'Product')
  findAll() {
    return this.products.findAll();
  }
}
