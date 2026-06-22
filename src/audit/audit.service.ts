import { Injectable } from '@nestjs/common';
import { AuditLogEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditWriteInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeState?: Prisma.InputJsonValue | null;
  afterState?: Prisma.InputJsonValue | null;
  context?: Prisma.InputJsonValue | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write-only by design. There is deliberately NO update or delete method:
   * audit rows are immutable (Invariant I-10), enforced in app code now and at
   * the DB level (REVOKE) in M5. JSON columns are omitted rather than set to a
   * JS null so the column stays SQL NULL without needing Prisma.JsonNull.
   *
   * An optional transaction client lets a caller write the audit row inside the
   * same transaction as the mutation it records, so the two commit or roll back
   * together. Used by variant auto-create (an auto-created variant and its audit
   * row must not outlive a rolled-back source operation). Defaults to the shared
   * client, which is how the AuditInterceptor (post-handler) writes.
   */
  async write(
    entry: AuditWriteInput,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<AuditLogEntry> {
    return client.auditLogEntry.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        ...(entry.beforeState != null ? { beforeState: entry.beforeState } : {}),
        ...(entry.afterState != null ? { afterState: entry.afterState } : {}),
        ...(entry.context != null ? { context: entry.context } : {}),
      },
    });
  }
}
