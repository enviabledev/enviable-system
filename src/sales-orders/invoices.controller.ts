import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../common/decorators';
import { PdfRendererService } from '../documents/pdf-renderer.service';
import { SalesOrdersService } from './sales-orders.service';

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly salesOrders: SalesOrdersService,
    private readonly pdfRenderer: PdfRendererService,
  ) {}

  @Get(':id')
  @RequirePermissions('salesorder.read')
  findOne(@Param('id') id: string) {
    return this.salesOrders.getInvoice(id);
  }

  // Customer-issuable PDF, gated on the existing invoice-read permission. Uses
  // @Res() so the binary body is sent verbatim (the JSON-shaped global
  // interceptors do not apply to a PDF); guards still run, so the permission is
  // enforced. A sales invoice carries no landed-cost field, so I-8 is not
  // engaged here regardless.
  @Get(':id/pdf')
  @RequirePermissions('salesorder.read')
  async pdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { filename, pdf } = await this.pdfRenderer.renderSalesInvoicePdf(id);
    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf);
  }

  // The in-app viewable surface: the exact HTML the PDF is rendered from, so the
  // on-screen document and the printed document are guaranteed identical.
  @Get(':id/html')
  @RequirePermissions('salesorder.read')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async html(@Param('id') id: string): Promise<string> {
    const { html } = await this.pdfRenderer.renderSalesInvoiceHtml(id);
    return html;
  }
}
