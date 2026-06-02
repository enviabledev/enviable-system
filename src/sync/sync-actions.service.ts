import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
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
  AssemblyFailPayloadDto,
  AssemblyStartPayloadDto,
  UnitReceiptPayloadDto,
} from './dto/sync-payloads.dto';
import { UpdateEntityPayloadDto } from './dto/update-entity.dto';
import { LwwOutcome, ReviewRef, SyncMergeService } from './sync-merge.service';
import { detectUniqueField, SyncUniqueConflictError } from './sync-conflicts';
import { SyncIdempotencyService } from './sync-idempotency.service';

const DISCOUNT_PERMISSION = 'salesorder.discount';

/**
 * A single entry of an exhaustive constraint-violations response (the structured
 * 409 shape established for the receipt flow in prompt 5.5 and documented as the
 * universal named-violation convention). Each carries a per-surface `kind`
 * (e.g. receipt's IN_BATCH_DUP / AGAINST_DB), the constraint `field`, the
 * offending `value`, and a legacy single-line `message` for back-compat
 * extractors. Surface-specific positional data (e.g. receipt's `rows`) passes
 * through via the index signature: the sync intake only needs to forward the
 * array, not interpret its surface details.
 */
export interface StructuredViolation {
  kind: string;
  field: string;
  value: unknown;
  message: string;
  [extra: string]: unknown;
}

export type SyncConflict =
  | { kind: 'unique'; field: string; value: unknown }
  | { kind: 'field-review'; reviews: ReviewRef[] }
  | { kind: 'constraint-violations'; violations: StructuredViolation[] };

export interface ActionResult {
  clientId: string;
  type: string;
  status: 'processed' | 'duplicate' | 'error' | 'conflict';
  resultRef?: string | null;
  applied?: string[];
  lastWriteWins?: LwwOutcome[];
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

  // A failure of a wrapped action becomes one of three outcomes:
  //   - 'conflict' with structured detail the client can render or queue for
  //     resolution (kind: 'unique' for a single field/value collision, kind:
  //     'constraint-violations' for the exhaustive structured 409 the named-
  //     violation convention produces, kind: 'field-review' produced elsewhere
  //     for field-merge reviews);
  //   - 'error' for everything else (genuine errors the clerk cannot resolve
  //     by editing inputs, e.g. wrong-state shipment, malformed payload,
  //     transient server failure).
  //
  // The named-violation convention (prompt 5.5 / I-11) is universal across
  // paths: any ConflictException whose response body carries a structured
  // `violations` array is the exhaustive constraint-violations shape and is
  // forwarded intact as a 'conflict' outcome so the offline path surfaces the
  // same clerk-resolvable detail as the direct-POST endpoints. ONLY a
  // ConflictException carrying that body reclassifies; string-message
  // ConflictExceptions (wrong-state, in-batch-dup-of-references in assembly,
  // the I-11 string message today) stay in 'error' so the conflicts surface
  // never receives an action the clerk cannot fix. If/when SO or assembly
  // migrate to the structured-violations body, they will be picked up here
  // automatically by the same matcher.
  //
  // Safe-by-retry is unchanged: idempotency only records the action on a
  // successful work() return, so a 'conflict' or 'error' outcome leaves
  // nothing recorded and a same-clientId re-submission of a corrected action
  // re-runs cleanly.
  private classifyError(err: unknown): DispatchResult {
    if (err instanceof SyncUniqueConflictError) {
      return {
        status: 'conflict',
        conflict: { kind: 'unique', field: err.field, value: err.value },
      };
    }
    if (err instanceof ConflictException) {
      const body = err.getResponse();
      if (
        typeof body === 'object' &&
        body !== null &&
        Array.isArray((body as { violations?: unknown }).violations)
      ) {
        const violations = (body as { violations: StructuredViolation[] })
          .violations;
        return {
          status: 'conflict',
          conflict: { kind: 'constraint-violations', violations },
        };
      }
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
      case SyncActionType.ASSEMBLY_FAIL: {
        // Mirrors ASSEMBLY_COMPLETE: same shape, calls assembly.fail. Wrong-state
        // errors (job not IN_PROGRESS, unit not IN_ASSEMBLY) and not-found errors
        // are string-message ConflictException / NotFoundException with no
        // `violations` body, so classifyError keeps them as status:'error' (NOT
        // reclassified as 'conflict'). Verified by probe.
        const dto = await asDto(AssemblyFailPayloadDto, payload);
        const outcome = await this.idempotency.process(
          clientId,
          type,
          principal.id,
          () => this.assembly.fail(dto.jobId, principal.id),
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
          () =>
            this.merge.applyFieldMerge(dto, {
              actorId: principal.id,
              deviceId: action.deviceId,
              clientTimestamp: action.clientTimestamp,
            }),
          (r) => r.recordId,
        );
        if (outcome.status === 'duplicate') {
          return { status: 'duplicate', resultRef: outcome.resultRef };
        }
        // Clean fields applied; low-stakes collisions auto-resolved by policy
        // (last write wins); high-stakes collisions queued as review items.
        const { applied, lastWriteWins, reviews } = outcome.result;
        if (reviews.length > 0) {
          return {
            status: 'conflict',
            resultRef: outcome.resultRef,
            applied,
            lastWriteWins,
            conflict: { kind: 'field-review', reviews },
          };
        }
        return {
          status: 'processed',
          resultRef: outcome.resultRef,
          applied,
          lastWriteWins,
        };
      }
      default: {
        // Unreachable: the DTO enum already constrains type. Defensive.
        throw new BadRequestException(`Unsupported action type: ${type}`);
      }
    }
  }
}
