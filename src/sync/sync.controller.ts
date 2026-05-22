import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Principal } from '../auth/auth.service';
import { CurrentUser } from '../common/decorators';
import { AllocateIdRangeDto } from './dto/allocate-id-range.dto';
import { QueryIdRangesDto } from './dto/query-id-ranges.dto';
import { SyncService } from './sync.service';

// Authenticated only (no @RequirePermissions): any authenticated user with a
// device can request a range. The global AuthGuard still enforces a session.
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

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
}
