import { Module } from '@nestjs/common';
import { InvoiceDocumentService } from './invoice-document.service';
import { PdfRendererService } from './pdf-renderer.service';

/**
 * Document rendering (invoice + proforma PDFs and their in-app HTML views).
 * Depends only on the global PrismaModule and ConfigModule, so feature modules
 * (sales-orders, proforma-invoices) can import it to expose download endpoints
 * without creating a dependency cycle.
 */
@Module({
  providers: [InvoiceDocumentService, PdfRendererService],
  exports: [PdfRendererService],
})
export class DocumentsModule {}
