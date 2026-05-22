import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolationOn } from '../common/prisma-errors';

export type SyncOutcome<T> =
  | { status: 'processed'; resultRef: string | null; result: T }
  | { status: 'duplicate'; resultRef: string | null };

/**
 * Idempotency core for offline sync intake. Keyed on the client-generated
 * clientId recorded in ProcessedSyncAction (clientId @unique).
 *
 * Contract:
 * - If the clientId was already processed, return the recorded resultRef and DO
 *   NOT run the work (exactly-once on replay).
 * - Otherwise run the work (which is an existing module service running its own
 *   transaction, so all its invariants hold), then record the
 *   ProcessedSyncAction with the work's result reference.
 * - If the work THROWS, nothing is recorded, so the action is retryable and the
 *   caller surfaces the error for that action alone.
 *
 * Why check-then-act rather than one transaction: the wrapped services own their
 * own $transaction internally and are reused unchanged (the sync layer is an
 * intake wrapper, not a reimplementation), and Prisma interactive transactions
 * do not nest. The clientId unique constraint is the backstop: a replay finds
 * the existing row and skips the work. (A truly concurrent same-clientId double
 * submit could run the work twice before either records; offline replay is
 * sequential per device, so that race is out of scope here and would be closed
 * later with a per-clientId advisory lock.)
 */
@Injectable()
export class SyncIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async process<T>(
    clientId: string,
    action: string,
    userId: string | null,
    work: () => Promise<T>,
    refOf: (result: T) => string | null,
  ): Promise<SyncOutcome<T>> {
    const existing = await this.prisma.processedSyncAction.findUnique({
      where: { clientId },
    });
    if (existing) {
      return { status: 'duplicate', resultRef: existing.resultRef };
    }

    // Run the wrapped business logic. A throw here records nothing (retryable).
    const result = await work();
    const resultRef = refOf(result);

    try {
      await this.prisma.processedSyncAction.create({
        data: { clientId, userId, action, resultRef },
      });
    } catch (err) {
      // A concurrent submit recorded the same clientId first. The work has
      // already run for both; return the recorded result as a duplicate.
      if (
        isUniqueViolationOn(err, {
          index: 'processed_sync_actions_clientId_key',
          fields: ['clientId'],
        })
      ) {
        const recorded = await this.prisma.processedSyncAction.findUnique({
          where: { clientId },
        });
        return { status: 'duplicate', resultRef: recorded?.resultRef ?? null };
      }
      throw err;
    }

    return { status: 'processed', resultRef, result };
  }
}
