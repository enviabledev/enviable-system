import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../common/decorators';
import { PdfRendererService } from '../documents/pdf-renderer.service';
import { SalesProformaInvoicesService } from './sales-proforma-invoices.service';

// The sales-side proforma invoice is an extension of the sales order's
// documentation, so all reads are gated on salesorder.read (the SO's own read
// permission), not the procurement-side pi.read.
@Controller('sales-proforma-invoices')
export class SalesProformaInvoicesController {
  constructor(
    private readonly salesProformaInvoices: SalesProformaInvoicesService,
    private readonly pdfRenderer: PdfRendererService,
  ) {}

  @Get(':id')
  @RequirePermissions('salesorder.read')
  findOne(@Param('id') id: string) {
    return this.salesProformaInvoices.findOne(id);
  }

  // Browser-printable PDF. inline (not attachment) so the frontend can open it
  // in a new tab for the user to print, rather than forcing a download.
  @Get(':id/pdf')
  @RequirePermissions('salesorder.read')
  async pdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { filename, pdf } =
      await this.pdfRenderer.renderSalesProformaInvoicePdf(id);
    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${filename}"`)
      .send(pdf);
  }

  @Get(':id/html')
  @RequirePermissions('salesorder.read')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async html(@Param('id') id: string): Promise<string> {
    const { html } = await this.pdfRenderer.renderSalesProformaInvoiceHtml(id);
    return html;
  }
}
