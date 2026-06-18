import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Audit, RequirePermissions } from '../common/decorators';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';
import { ProductVariantsService } from './product-variants.service';

/**
 * Variant management. Create and edit only; there is deliberately no DELETE.
 * A variant that has ever been used is referenced by units, sales-order lines
 * and price-list entries, so a guarded hard-delete would almost never succeed
 * and a soft-delete is indistinguishable from deactivation. Deactivation is
 * therefore PATCH status=DISCONTINUED: it stops new use while every existing
 * reference keeps resolving. The audit trail is preserved by never removing the
 * row.
 */
@Controller('product-variants')
export class ProductVariantsController {
  constructor(private readonly variants: ProductVariantsService) {}

  @Get(':id')
  @RequirePermissions('product.read')
  findOne(@Param('id') id: string) {
    return this.variants.findOne(id);
  }

  @Post()
  @RequirePermissions('productvariant.manage')
  @Audit('productvariant.create', 'ProductVariant')
  create(@Body() dto: CreateProductVariantDto) {
    return this.variants.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('productvariant.manage')
  @Audit('productvariant.update', 'ProductVariant')
  update(@Param('id') id: string, @Body() dto: UpdateProductVariantDto) {
    return this.variants.update(id, dto);
  }
}
