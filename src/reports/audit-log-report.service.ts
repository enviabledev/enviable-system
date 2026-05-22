import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@Injectable()
export class AuditLogReportService {
  constructor(private readonly prisma: PrismaService) {}

  // Shared filter builder for the list and stats endpoints, so both operate
  // over exactly the same filtered set. occurredFrom/occurredTo are inclusive.
  private buildWhere(query: AuditLogQueryDto): Prisma.AuditLogEntryWhereInput {
    const where: Prisma.AuditLogEntryWhereInput = {
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    if (query.occurredFrom || query.occurredTo) {
      where.occurredAt = {
        ...(query.occurredFrom ? { gte: new Date(query.occurredFrom) } : {}),
        ...(query.occurredTo ? { lte: new Date(query.occurredTo) } : {}),
      };
    }
    return where;
  }

  /**
   * Paginated, filterable audit-log read, ordered occurredAt descending. Returns
   * the COMPLETE record for each entry, including the full before/after states
   * for the diff. This is the system of record and is not stripped of cost data
   * (the route is marked @SkipCostStrip): privacy of the audit log comes from
   * gating audit.read, not from sanitising rows (Invariant I-8 design). Reads of
   * the audit log are themselves NOT audited (no @Audit, so no recursion).
   */
  async list(query: AuditLogQueryDto) {
    const where = this.buildWhere(query);

    const [entries, total] = await this.prisma.$transaction([
      this.prisma.auditLogEntry.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          occurredAt: true,
          context: true,
          beforeState: true,
          afterState: true,
          actor: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.auditLogEntry.count({ where }),
    ]);

    const data = entries.map((e) => ({
      id: e.id,
      actor: e.actor ? { id: e.actor.id, fullName: e.actor.fullName } : null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      occurredAt: e.occurredAt,
      context: e.context,
      beforeState: e.beforeState,
      afterState: e.afterState,
    }));

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * Aggregate stats over the SAME filter set as list(): total entry count,
   * distinct actor count, and an action-frequency breakdown (descending).
   */
  async stats(query: AuditLogQueryDto) {
    const where = this.buildWhere(query);

    // Run as separate reads (Prisma groupBy generics degrade inside a
    // $transaction tuple). These are read-only aggregates; no transaction is
    // required for correctness here.
    const totalCount = await this.prisma.auditLogEntry.count({ where });
    const byActor = await this.prisma.auditLogEntry.groupBy({
      by: ['actorUserId'],
      where,
      _count: { _all: true },
    });
    const byAction = await this.prisma.auditLogEntry.groupBy({
      by: ['action'],
      where,
      _count: { _all: true },
    });

    // Distinct actors: count of distinct non-null actorUserId groups. A null
    // actor (system action) is not counted as a distinct user.
    const distinctActors = byActor.filter(
      (g) => g.actorUserId !== null,
    ).length;

    const actions = byAction
      .map((g) => ({ action: g.action, count: g._count._all }))
      .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action));

    return { totalCount, distinctActors, actions };
  }
}
