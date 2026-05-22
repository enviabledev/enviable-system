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
import { UpdateEntityPayloadDto } from './dto/update-entity.dto';
import { FieldCollision, SyncMergeService } from './sync-merge.service';
import { detectUniqueField, SyncUniqueConflictError } from './sync-conflicts';
import { SyncIdempotencyService } from './sync-idempotency.service';

const DISCOUNT_PERMISSION = 'salesorder.discount';

export type SyncConflict =
  | { kind: 'unique'; field: string; value: unknown }
  | { kind: 'field-collision'; fields: FieldCollision[] };

export interface ActionResult {
  clientId: string;
  type: string;
  status: 'processed' | 'duplicate' | 'error' | 'conflict';
  resultRef?: string | null;
  applied?: string[];
  conflict?: SyncConflict;
  error?: string;
}

// What a dispatch returns before clientId/type are attached.
type DispatchResult = Omit<ActionResult, 'clientId' | 'type'>;

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
    private readonly merge: SyncMergeService,
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
          ...outcome,
        });
      } catch (err) {
        results.push({
          clientId: action.clientId,
          type: action.type,
          ...this.classifyError(err),
        });
      }
    }
    return { results };
  }

  // Mechanism 2: a unique-constraint violation surfaced through sync becomes a
  // structured conflict (offending field and value), never a crashed batch or a
  // 500. A SyncUniqueConflictError carries field/value directly; a raw P2002 is
  // matched defensively via the canonical isUniqueViolationOn helper.
  private classifyError(err: unknown): DispatchResult {
    if (err instanceof SyncUniqueConflictError) {
      return {
        status: 'conflict',
        conflict: { kind: 'unique', field: err.field, value: err.value },
      };
    }
    const field = detectUniqueField(err);
    if (field) {
      return {
        status: 'conflict',
        conflict: { kind: 'unique', field, value: null },
      };
    }
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  private async dispatch(
    action: SyncActionDto,
    principal: Principal,
  ): Promise<DispatchResult> {
    const { clientId, type, payload } = action;
    switch (type) {
      case SyncActionType.UNIT_RECEIPT: {
        const dto = await asDto(UnitReceiptPayloadDto, payload);
        const outcome = await this.idempotency.process(
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
        return { status: outcome.status, resultRef: outcome.resultRef };
      }
      case SyncActionType.ASSEMBLY_START: {
        const dto = await asDto(AssemblyStartPayloadDto, payload);
        const outcome = await this.idempotency.process(
          clientId,
          type,
          principal.id,
          () => this.assembly.startAssembly(dto.unitRefs, principal.id),
          (jobs) => jobs.map((j) => j.id).join(','),
        );
        return { status: outcome.status, resultRef: outcome.resultRef };
      }
      case SyncActionType.ASSEMBLY_COMPLETE: {
        const dto = await asDto(AssemblyCompletePayloadDto, payload);
        const outcome = await this.idempotency.process(
          clientId,
          type,
          principal.id,
          () => this.assembly.complete(dto.jobId, principal.id),
          (job) => job.id,
        );
        return { status: outcome.status, resultRef: outcome.resultRef };
      }
      case SyncActionType.SALES_ORDER_CREATE: {
        const dto = await asDto(CreateSalesOrderDto, payload);
        const canDiscount = principal.permissions.includes(DISCOUNT_PERMISSION);
        const outcome = await this.idempotency.process(
          clientId,
          type,
          principal.id,
          () => this.salesOrders.create(dto, principal.id, canDiscount),
          (so) => so.id,
        );
        return { status: outcome.status, resultRef: outcome.resultRef };
      }
      case SyncActionType.ENTITY_UPDATE: {
        const dto = await asDto(UpdateEntityPayloadDto, payload);
        const outcome = await this.idempotency.process(
          clientId,
          type,
          principal.id,
          () => this.merge.applyFieldMerge(dto, principal.id),
          (r) => r.recordId,
        );
        if (outcome.status === 'duplicate') {
          return { status: 'duplicate', resultRef: outcome.resultRef };
        }
        // Clean fields were applied. Any same-field collisions are flagged as a
        // conflict (not overwritten); the next prompt's policy resolves them.
        const { applied, collisions } = outcome.result;
        if (collisions.length > 0) {
          return {
            status: 'conflict',
            resultRef: outcome.resultRef,
            applied,
            conflict: { kind: 'field-collision', fields: collisions },
          };
        }
        return { status: 'processed', resultRef: outcome.resultRef, applied };
      }
      default: {
        // Unreachable: the DTO enum already constrains type. Defensive.
        throw new BadRequestException(`Unsupported action type: ${type}`);
      }
    }
  }
}
