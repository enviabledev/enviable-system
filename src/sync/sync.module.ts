import { Module } from '@nestjs/common';
import { AssemblyModule } from '../assembly/assembly.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { SyncActionsService } from './sync-actions.service';
import { SyncController } from './sync.controller';
import { SyncIdempotencyService } from './sync-idempotency.service';
import { SyncMergeService } from './sync-merge.service';
import { SyncService } from './sync.service';

@Module({
  // Reuse the existing M2/M3/M4 services for business logic; the sync layer is
  // an idempotent intake wrapper, not a reimplementation.
  imports: [ShipmentsModule, AssemblyModule, SalesOrdersModule],
  controllers: [SyncController],
  providers: [
    SyncService,
    SyncIdempotencyService,
    SyncActionsService,
    SyncMergeService,
  ],
})
export class SyncModule {}
