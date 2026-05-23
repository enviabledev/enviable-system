import { Controller, Get } from '@nestjs/common';
import { Audit, RequirePermissions } from '../common/decorators';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // Gate: product.read is the catalogue-read permission (variants, SKUs,
  // attributes, status, and the selling-side currentMarketPrice which is
  // visible to all per Invariant I-8). pricelist.read remains on the price-list
  // endpoints proper. This split was added when the Procurement Officer role
  // needed to fetch the catalogue to build PO lines but legitimately should not
  // hold pricelist.read.
  //
  // @Audit on a READ is for the M1 proof-of-chain demonstration only. Reads are
  // not normally audited in production (only mutations are).
  @Get()
  @RequirePermissions('product.read')
  @Audit('product.read', 'Product')
  findAll() {
    return this.products.findAll();
  }
}
