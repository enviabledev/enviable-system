import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { ProformaInvoicesController } from './proforma-invoices.controller';
import { ProformaInvoicesService } from './proforma-invoices.service';

@Module({
  imports: [DocumentsModule],
  controllers: [ProformaInvoicesController],
  providers: [ProformaInvoicesService],
})
export class ProformaInvoicesModule {}
