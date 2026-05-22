import { Module } from '@nestjs/common';
import { AssemblyController } from './assembly.controller';
import { AssemblyService } from './assembly.service';

@Module({
  controllers: [AssemblyController],
  providers: [AssemblyService],
  // Exported so the sync intake layer can reuse start/complete (idempotent wrapper).
  exports: [AssemblyService],
})
export class AssemblyModule {}
