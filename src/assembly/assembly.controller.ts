import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Principal } from '../auth/auth.service';
import { Audit, CurrentUser, RequirePermissions } from '../common/decorators';
import { AssemblyService } from './assembly.service';
import { CreateAssemblyJobsDto } from './dto/create-assembly-jobs.dto';

@Controller('assembly-jobs')
export class AssemblyController {
  constructor(private readonly assembly: AssemblyService) {}

  @Get()
  @RequirePermissions('assembly.read')
  findAll() {
    return this.assembly.findAll();
  }

  @Get(':id')
  @RequirePermissions('assembly.read')
  findOne(@Param('id') id: string) {
    return this.assembly.findOne(id);
  }

  // Bulk start. @CurrentUser is the supervisor and the movement actor.
  @Post()
  @RequirePermissions('assembly.perform')
  @Audit('assembly.start', 'AssemblyJob')
  start(
    @Body() dto: CreateAssemblyJobsDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.assembly.startAssembly(dto.unitRefs, actor.id);
  }

  // Per-job completion (traceability). Writes assembledById, so it needs the
  // principal.
  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('assembly.perform')
  @Audit('assembly.complete', 'AssemblyJob')
  complete(@Param('id') id: string, @CurrentUser() actor: Principal) {
    return this.assembly.complete(id, actor.id);
  }

  @Post(':id/fail')
  @HttpCode(200)
  @RequirePermissions('assembly.perform')
  @Audit('assembly.fail', 'AssemblyJob')
  fail(@Param('id') id: string, @CurrentUser() actor: Principal) {
    return this.assembly.fail(id, actor.id);
  }
}
