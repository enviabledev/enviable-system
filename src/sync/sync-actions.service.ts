import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Principal } from '../auth/auth.service';
import { AssemblyService } from '../assembly/assembly.service';
import { CreateSalesOrderDto } from '../sales-orders/dto/create-sales-order.dto';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { SyncActionDto, SyncActionType, SyncBatchDto } from './dto/sync-batch.dto';
import {
  AssemblyCompletePayloadDto,
  AssemblyStartPayloadDto,
  UnitReceiptPayloadDto,
} from './dto/sync-payloads.dto';
import { SyncIdempotencyService } from './sync-idempotency.service';

const DISCOUNT_PERMISSION = 'salesorder.discount';

export interface ActionResult {
  clientId: string;
  type: string;
  status: 'processed' | 'duplicate' | 'error';
  resultRef?: string | null;
  error?: string;
}

/**
 * Validate a plain payload against a module DTO. A failure throws
 * BadRequestException, which the batch loop catches and reports as that action's
 * own error without disturbing the others.
 */
async function asDto<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
): Promise<T> {
  const instance = plainToInstance(cls, payload);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  if (errors.length > 0) {
    const messages = errors
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join('; ');
    throw new BadRequestException(`Invalid payload: ${messages}`);
  }
  return instance;
}

@Injectable()
export class SyncActionsService {
  constructor(
    private readonly idempotency: SyncIdempotencyService,
    private readonly shipments: ShipmentsService,
    private readonly assembly: AssemblyService,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  /**
   * Process a batch of offline actions IN ORDER. Each action is its own
   * idempotent unit: it runs through the idempotency service (skip-if-replayed),
   * and a failure or duplicate of one action never rolls back the others. Returns
   * per-action status (processed / duplicate / error).
   */
  async processBatch(
    batch: SyncBatchDto,
    principal: Principal,
  ): Promise<{ results: ActionResult[] }> {
    const results: ActionResult[] = [];
    for (const action of batch.actions) {
      try {
        const outcome = await this.dispatch(action, principal);
        results.push({
          clientId: action.clientId,
          type: action.type,
          status: outcome.status,
          resultRef: outcome.resultRef,
        });
      } catch (err) {
        results.push({
          clientId: action.clientId,
          type: action.type,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { results };
  }

  private async dispatch(action: SyncActionDto, principal: Principal) {
    const { clientId, type, payload } = action;
    switch (type) {
      case SyncActionType.UNIT_RECEIPT: {
        const dto = await asDto(UnitReceiptPayloadDto, payload);
        return this.idempotency.process(
          clientId,
          type,
          principal.id,
          () =>
            this.shipments.receiveUnits(
              dto.shipmentId,
              { lines: dto.lines },
              principal.id,
            ),
          (shipment) => shipment?.id ?? null,
        );
      }
      case SyncActionType.ASSEMBLY_START: {
        const dto = await asDto(AssemblyStartPayloadDto, payload);
        return this.idempotency.process(
          clientId,
          type,
          principal.id,
          () => this.assembly.startAssembly(dto.unitRefs, principal.id),
          (jobs) => jobs.map((j) => j.id).join(','),
        );
      }
      case SyncActionType.ASSEMBLY_COMPLETE: {
        const dto = await asDto(AssemblyCompletePayloadDto, payload);
        return this.idempotency.process(
          clientId,
          type,
          principal.id,
          () => this.assembly.complete(dto.jobId, principal.id),
          (job) => job.id,
        );
      }
      case SyncActionType.SALES_ORDER_CREATE: {
        const dto = await asDto(CreateSalesOrderDto, payload);
        const canDiscount = principal.permissions.includes(DISCOUNT_PERMISSION);
        return this.idempotency.process(
          clientId,
          type,
          principal.id,
          () => this.salesOrders.create(dto, principal.id, canDiscount),
          (so) => so.id,
        );
      }
      default: {
        // Unreachable: the DTO enum already constrains type. Defensive.
        throw new BadRequestException(`Unsupported action type: ${type}`);
      }
    }
  }
}
