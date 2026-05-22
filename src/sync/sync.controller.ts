import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Principal } from '../auth/auth.service';
import { CurrentUser } from '../common/decorators';
import { AllocateIdRangeDto } from './dto/allocate-id-range.dto';
import { QueryIdRangesDto } from './dto/query-id-ranges.dto';
import { SyncBatchDto } from './dto/sync-batch.dto';
import { SyncActionsService } from './sync-actions.service';
import { SyncService } from './sync.service';

// Authenticated only (no @RequirePermissions): any authenticated user with a
// device can sync. The global AuthGuard still enforces a session. The wrapped
// services enforce their business INVARIANTS (I-3, I-11, etc.) through the reused
// path; per-action RBAC (a guard concern) is not re-checked at sync intake, as
// these are the device user's own queued offline actions being replayed.
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly actions: SyncActionsService,
  ) {}

  // Writes userId, so it needs the principal.
  @Post('id-ranges')
  allocate(@Body() dto: AllocateIdRangeDto, @CurrentUser() actor: Principal) {
    return this.sync.allocateRange(
      dto.deviceId,
      dto.idType,
      dto.count,
      actor.id,
    );
  }

  @Get('id-ranges')
  list(@Query() query: QueryIdRangesDto) {
    return this.sync.listRanges(query.deviceId, query.idType);
  }

  // Idempotent batch intake. Each action runs once per clientId; replays are
  // skipped. Per-action results report processed / duplicate / error.
  @Post('actions')
  syncActions(@Body() batch: SyncBatchDto, @CurrentUser() actor: Principal) {
    return this.actions.processBatch(batch, actor);
  }
}
