import { Module } from '@nestjs/common';
import { AssemblyController } from './assembly.controller';
import { AssemblyService } from './assembly.service';

@Module({
  controllers: [AssemblyController],
  providers: [AssemblyService],
})
export class AssemblyModule {}
