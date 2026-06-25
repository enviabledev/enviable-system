import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { SalesProformaInvoicesController } from './sales-proforma-invoices.controller';
import { SalesProformaInvoicesService } from './sales-proforma-invoices.service';

@Module({
  imports: [DocumentsModule],
  controllers: [SalesProformaInvoicesController],
  providers: [SalesProformaInvoicesService],
})
export class SalesProformaInvoicesModule {}
