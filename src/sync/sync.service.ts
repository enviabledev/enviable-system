import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Advisory-lock class key for id-range allocation. Distinct from the human-id
// generators (PO 49001, shipment 49002, SO 49004, invoice 49005, DN 49006,
// WB 49007). Combined with hashtext(idType) as the second lock key, allocations
// for the same idType serialise (guaranteeing contiguous, non-overlapping
// blocks) while different idTypes do not block each other.
export const ID_RANGE_LOCK_KEY = 49100;

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Allocate the next contiguous id block for (idType) across ALL devices. In a
   * transaction holding pg_advisory_xact_lock(49100, hashtext(idType)): read the
   * highest rangeEnd for that idType, then allocate rangeStart = prevMax + 1 to
   * rangeEnd = rangeStart + count - 1, nextValue = rangeStart, exhausted false.
   * The lock serialises concurrent allocators of the same idType, so two devices
   * get adjacent non-overlapping blocks (never a reuse). exhausted is flipped by
   * the client later; this endpoint only allocates.
   */
  async allocateRange(
    deviceId: string,
    idType: string,
    count: number,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Cast the class key to int4: Prisma binds the JS number as bigint, but
      // the two-arg pg_advisory_xact_lock overload is (int4, int4), and hashtext
      // returns int4. Without the cast the (bigint, integer) overload is unresolved.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ID_RANGE_LOCK_KEY}::int, hashtext(${idType}))`;

      const rows = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX("rangeEnd") AS max
        FROM id_range_allocations
        WHERE "idType" = ${idType}
      `;
      const prevMax = rows[0]?.max == null ? 0 : Number(rows[0].max);
      const rangeStart = prevMax + 1;
      const rangeEnd = rangeStart + count - 1;

      return tx.idRangeAllocation.create({
        data: {
          deviceId,
          userId,
          idType,
          rangeStart,
          rangeEnd,
          nextValue: rangeStart,
          exhausted: false,
        },
      });
    });
  }

  /** List a device's allocations, optionally narrowed to one idType. */
  listRanges(deviceId: string, idType?: string) {
    return this.prisma.idRangeAllocation.findMany({
      where: { deviceId, ...(idType ? { idType } : {}) },
      orderBy: [{ idType: 'asc' }, { rangeStart: 'asc' }],
    });
  }
}
