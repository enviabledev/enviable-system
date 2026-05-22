import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Principal } from '../auth/auth.service';
import { Audit, CurrentUser, RequirePermissions } from '../common/decorators';
import { DeliveryService } from './delivery.service';
import { CreateDeliveryNoteDto } from './dto/create-delivery-note.dto';
import { ProofOfDeliveryDto } from './dto/proof-of-delivery.dto';

// Physical fulfilment workflow. All gated on delivery.manage. These steps track
// fulfilment and advance the order through the legal sequence; they do not
// change unit status (units are already SOLD from release).
@Controller()
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  // Writes preparedById, so it needs the principal.
  @Post('sales-orders/:id/delivery-note')
  @RequirePermissions('delivery.manage')
  @Audit('delivery.note', 'DeliveryNote')
  createDeliveryNote(
    @Param('id') id: string,
    @Body() dto: CreateDeliveryNoteDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.delivery.createDeliveryNote(id, dto, actor.id);
  }

  @Post('delivery-notes/:id/waybill')
  @RequirePermissions('delivery.manage')
  @Audit('delivery.waybill', 'Waybill')
  createWaybill(@Param('id') id: string) {
    return this.delivery.createWaybill(id);
  }

  @Post('sales-orders/:id/dispatch')
  @HttpCode(200)
  @RequirePermissions('delivery.manage')
  @Audit('salesorder.dispatch', 'SalesOrder')
  dispatch(@Param('id') id: string) {
    return this.delivery.dispatch(id);
  }

  @Post('sales-orders/:id/proof-of-delivery')
  @HttpCode(200)
  @RequirePermissions('delivery.manage')
  @Audit('delivery.proof', 'SalesOrder')
  proofOfDelivery(@Param('id') id: string, @Body() dto: ProofOfDeliveryDto) {
    return this.delivery.recordProofOfDelivery(id, dto);
  }

  @Post('sales-orders/:id/close')
  @HttpCode(200)
  @RequirePermissions('delivery.manage')
  @Audit('salesorder.close', 'SalesOrder')
  close(@Param('id') id: string) {
    return this.delivery.close(id);
  }
}
