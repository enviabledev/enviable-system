import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssemblyJobStatus,
  MovementReferenceType,
  MovementType,
  Unit,
  UnitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertVariantsActive } from '../products/variant-status';
import { transitionUnit } from '../units/transition-unit';

const JOB_INCLUDE = {
  unit: {
    select: { id: true, engineNumber: true, status: true },
  },
  supervisor: { select: { id: true, fullName: true } },
} as const;

@Injectable()
export class AssemblyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bulk start: create one IN_PROGRESS AssemblyJob per unit and transition each
   * IN_WAREHOUSE_CKD unit to IN_ASSEMBLY via transitionUnit (ASSEMBLY_START), all
   * atomically. Pre-flight rejects the whole batch (409) if any unit is not
   * IN_WAREHOUSE_CKD; transitionUnit re-asserts inside the transaction, so a
   * race rolls everything back too (no partial transition).
   */
  async startAssembly(unitRefs: string[], actorId: string) {
    const resolved = await this.resolveUnits(unitRefs);

    for (const unit of resolved) {
      if (unit.status !== UnitStatus.IN_WAREHOUSE_CKD) {
        throw new ConflictException(
          `Unit ${unit.engineNumber} is ${unit.status}, not IN_WAREHOUSE_CKD; cannot start assembly.`,
        );
      }
    }

    // No new CBU units may be assembled from a discontinued variant; existing
    // CKD units stay readable, they just cannot start a new assembly job.
    await assertVariantsActive(
      this.prisma,
      resolved.map((unit) => unit.productVariantId),
      'units',
    );

    return this.prisma.$transaction(async (tx) => {
      const jobs = [];
      for (const unit of resolved) {
        const job = await tx.assemblyJob.create({
          data: {
            unitId: unit.id,
            status: AssemblyJobStatus.IN_PROGRESS,
            startedAt: new Date(),
            supervisorId: actorId,
          },
        });
        await transitionUnit(
          tx,
          unit.id,
          UnitStatus.IN_ASSEMBLY,
          MovementType.ASSEMBLY_START,
          {
            actorId,
            referenceType: MovementReferenceType.ASSEMBLY_JOB,
            referenceId: job.id,
          },
        );
        jobs.push(job);
      }
      return jobs;
    });
  }

  async complete(jobId: string, actorId: string) {
    const job = await this.loadInProgressJob(jobId);
    return this.prisma.$transaction(async (tx) => {
      await transitionUnit(
        tx,
        job.unitId,
        UnitStatus.IN_WAREHOUSE_CBU,
        MovementType.ASSEMBLY_COMPLETE,
        {
          actorId,
          referenceType: MovementReferenceType.ASSEMBLY_JOB,
          referenceId: jobId,
          unitData: { assembledAt: new Date(), assembledById: actorId },
        },
      );
      return tx.assemblyJob.update({
        where: { id: jobId },
        data: { status: AssemblyJobStatus.COMPLETED, completedAt: new Date() },
        include: JOB_INCLUDE,
      });
    });
  }

  async fail(jobId: string, actorId: string) {
    const job = await this.loadInProgressJob(jobId);
    return this.prisma.$transaction(async (tx) => {
      await transitionUnit(
        tx,
        job.unitId,
        UnitStatus.DAMAGED,
        MovementType.DAMAGE,
        {
          actorId,
          referenceType: MovementReferenceType.ASSEMBLY_JOB,
          referenceId: jobId,
        },
      );
      return tx.assemblyJob.update({
        where: { id: jobId },
        data: { status: AssemblyJobStatus.FAILED, completedAt: new Date() },
        include: JOB_INCLUDE,
      });
    });
  }

  /**
   * Clean cancellation of an in-progress assembly (wrong unit picked,
   * administrative correction, assembly aborted before any physical work). The
   * unit returns to IN_WAREHOUSE_CKD intact and the job closes CANCELLED, both
   * atomically. This intact reversal is coherent ONLY from IN_ASSEMBLY: a
   * finished CBU cannot be un-built back to a kit, which is why the state
   * machine has no IN_WAREHOUSE_CBU -> IN_WAREHOUSE_CKD edge. The reversal is a
   * corrective movement (ADJUSTMENT), referenced to the assembly job; the
   * reason is carried on the movement notes for the offline timeline and the
   * audit row. transitionUnit writes the StockMovement in the same transaction,
   * so Invariant I-3 holds for the reversal automatically.
   */
  async cancel(jobId: string, actorId: string, reason: string) {
    const job = await this.loadInProgressJob(jobId);
    return this.prisma.$transaction(async (tx) => {
      await transitionUnit(
        tx,
        job.unitId,
        UnitStatus.IN_WAREHOUSE_CKD,
        MovementType.ADJUSTMENT,
        {
          actorId,
          referenceType: MovementReferenceType.ASSEMBLY_JOB,
          referenceId: jobId,
          notes: reason,
        },
      );
      return tx.assemblyJob.update({
        where: { id: jobId },
        data: {
          status: AssemblyJobStatus.CANCELLED,
          completedAt: new Date(),
          notes: reason,
        },
        include: JOB_INCLUDE,
      });
    });
  }

  findAll() {
    return this.prisma.assemblyJob.findMany({
      orderBy: { createdAt: 'desc' },
      include: JOB_INCLUDE,
    });
  }

  async findOne(id: string) {
    const job = await this.prisma.assemblyJob.findUnique({
      where: { id },
      include: JOB_INCLUDE,
    });
    if (!job) {
      throw new NotFoundException(`Assembly job ${id} not found`);
    }
    return job;
  }

  private async loadInProgressJob(jobId: string) {
    const job = await this.prisma.assemblyJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException(`Assembly job ${jobId} not found`);
    }
    if (job.status !== AssemblyJobStatus.IN_PROGRESS) {
      throw new ConflictException(
        `Assembly job ${jobId} is ${job.status}, not IN_PROGRESS.`,
      );
    }
    return job;
  }

  // Resolve each ref (cuid id or engineNumber) to a unit, rejecting unknown or
  // duplicated refs, preserving request order.
  private async resolveUnits(unitRefs: string[]): Promise<Unit[]> {
    const units = await this.prisma.unit.findMany({
      where: { OR: [{ id: { in: unitRefs } }, { engineNumber: { in: unitRefs } }] },
    });
    const byKey = new Map<string, Unit>();
    for (const unit of units) {
      byKey.set(unit.id, unit);
      byKey.set(unit.engineNumber, unit);
    }
    const resolved: Unit[] = [];
    const seen = new Set<string>();
    for (const ref of unitRefs) {
      const unit = byKey.get(ref);
      if (!unit) {
        throw new NotFoundException(`Unit ${ref} not found`);
      }
      if (seen.has(unit.id)) {
        throw new ConflictException(
          `Unit ${ref} is referenced more than once in the batch`,
        );
      }
      seen.add(unit.id);
      resolved.push(unit);
    }
    return resolved;
  }
}
