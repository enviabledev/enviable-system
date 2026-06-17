import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Principal } from '../auth/auth.service';
import { Audit, CurrentUser, RequirePermissions } from '../common/decorators';
import { PdfRendererService } from '../documents/pdf-renderer.service';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { ProformaInvoicesService } from './proforma-invoices.service';

@Controller()
export class ProformaInvoicesController {
  constructor(
    private readonly proformaInvoices: ProformaInvoicesService,
    private readonly pdfRenderer: PdfRendererService,
  ) {}

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

  // PDF + in-app HTML view, gated on the existing proforma-read permission.
  // @Res() sends the binary verbatim; guards still enforce pi.read (which sales
  // roles do not hold, so procurement cost figures stay with procurement).
  @Get('proforma-invoices/:id/pdf')
  @RequirePermissions('pi.read')
  async pdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { filename, pdf } = await this.pdfRenderer.renderProformaInvoicePdf(id);
    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf);
  }

  @Get('proforma-invoices/:id/html')
  @RequirePermissions('pi.read')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async html(@Param('id') id: string): Promise<string> {
    const { html } = await this.pdfRenderer.renderProformaInvoiceHtml(id);
    return html;
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
