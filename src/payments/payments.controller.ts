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
import { RecordPaymentDto } from './dto/record-payment.dto';
import { PaymentsService } from './payments.service';

// Recording and confirming are deliberately separate permissions and steps:
// the recorder (payment.record) is not necessarily the confirmer
// (payment.confirm). Separation of duties.
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('sales-orders/:id/payments')
  @RequirePermissions('salesorder.read')
  list(@Param('id') id: string) {
    return this.payments.listForSo(id);
  }

  // Recording captures the actor because an overpayment writes a distinct
  // payment.overpayment audit entry from within the service transaction.
  @Post('sales-orders/:id/payments')
  @RequirePermissions('payment.record')
  @Audit('payment.record', 'Payment')
  record(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.payments.record(id, dto, actor.id);
  }

  // Confirm writes confirmedById, so it needs the principal.
  @Post('payments/:id/confirm')
  @HttpCode(200)
  @RequirePermissions('payment.confirm')
  @Audit('payment.confirm', 'Payment')
  confirm(@Param('id') id: string, @CurrentUser() actor: Principal) {
    return this.payments.confirm(id, actor.id);
  }

  @Post('payments/:id/reject')
  @HttpCode(200)
  @RequirePermissions('payment.confirm')
  @Audit('payment.reject', 'Payment')
  reject(@Param('id') id: string) {
    return this.payments.reject(id);
  }
}
