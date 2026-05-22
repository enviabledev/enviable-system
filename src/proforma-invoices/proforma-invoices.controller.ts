import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Principal } from '../auth/auth.service';
import { Audit, CurrentUser, RequirePermissions } from '../common/decorators';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { ProformaInvoicesService } from './proforma-invoices.service';

@Controller()
export class ProformaInvoicesController {
  constructor(private readonly proformaInvoices: ProformaInvoicesService) {}

  @Get('purchase-orders/:poId/proforma-invoices')
  @RequirePermissions('pi.read')
  list(@Param('poId') poId: string) {
    return this.proformaInvoices.findAllForPo(poId);
  }

  @Get('proforma-invoices/:id')
  @RequirePermissions('pi.read')
  findOne(@Param('id') id: string) {
    return this.proformaInvoices.findOne(id);
  }

  @Post('purchase-orders/:poId/proforma-invoices')
  @RequirePermissions('pi.review')
  @Audit('pi.create', 'ProformaInvoice')
  create(
    @Param('poId') poId: string,
    @Body() dto: CreateProformaInvoiceDto,
  ) {
    return this.proformaInvoices.create(poId, dto);
  }

  // approve writes approvedById, so it genuinely needs the principal.
  @Post('proforma-invoices/:id/approve')
  @HttpCode(200)
  @RequirePermissions('pi.review')
  @Audit('pi.approve', 'ProformaInvoice')
  approve(@Param('id') id: string, @CurrentUser() actor: Principal) {
    return this.proformaInvoices.approve(id, actor.id);
  }

  @Post('proforma-invoices/:id/reject')
  @HttpCode(200)
  @RequirePermissions('pi.review')
  @Audit('pi.reject', 'ProformaInvoice')
  reject(@Param('id') id: string) {
    return this.proformaInvoices.reject(id);
  }
}
