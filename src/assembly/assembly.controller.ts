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
import { CancelAssemblyJobDto } from './dto/cancel-assembly-job.dto';
import { CreateAssemblyJobsDto } from './dto/create-assembly-jobs.dto';
import { UpgradeAssemblyJobDto } from './dto/upgrade-assembly-job.dto';

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

  // Authorise the SKD -> CBU upgrade of a single 3-wheeler as a new assembly
  // job. Separately permissioned (assembly.upgrade) from the kit-assembly
  // operations. The resulting job runs through the same complete/fail/cancel
  // endpoints below; its jobType (SKD_TO_CBU) drives their behaviour.
  @Post('upgrade')
  @RequirePermissions('assembly.upgrade')
  @Audit('assembly.upgrade.start', 'AssemblyJob')
  upgrade(
    @Body() dto: UpgradeAssemblyJobDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.assembly.startUpgrade(dto.unitRef, actor.id);
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

  // Clean cancel back to IN_WAREHOUSE_CKD (intact). Requires a reason, threaded
  // to the reversal movement notes. Same assembly.perform gate as start/fail.
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('assembly.perform')
  @Audit('assembly.cancel', 'AssemblyJob')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelAssemblyJobDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.assembly.cancel(id, actor.id, dto.reason);
  }
}
