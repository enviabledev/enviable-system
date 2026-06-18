import { Module } from '@nestjs/common';
import { ProductVariantsController } from './product-variants.controller';
import { ProductVariantsService } from './product-variants.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController, ProductVariantsController],
  providers: [ProductsService, ProductVariantsService],
})
export class ProductsModule {}
