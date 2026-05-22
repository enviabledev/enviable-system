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
import { InitiateReturnDto } from './dto/initiate-return.dto';
import { ResolveReturnDto } from './dto/resolve-return.dto';
import { ReturnsService } from './returns.service';

@Controller()
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  // Reads: salesorder.read is the broad read permission; every return.manage
  // holder also has it, so this covers "return.manage OR salesorder.read".
  @Get('returns')
  @RequirePermissions('salesorder.read')
  findAll() {
    return this.returns.findAll();
  }

  @Get('returns/:id')
  @RequirePermissions('salesorder.read')
  findOne(@Param('id') id: string) {
    return this.returns.findOne(id);
  }

  // Writes initiatedById.
  @Post('sales-orders/:id/returns')
  @RequirePermissions('return.manage')
  @Audit('return.initiate', 'Return')
  initiate(
    @Param('id') id: string,
    @Body() dto: InitiateReturnDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.returns.initiate(id, dto, actor.id);
  }

  @Post('returns/:id/inspect')
  @HttpCode(200)
  @RequirePermissions('return.manage')
  @Audit('return.inspect', 'Return')
  inspect(@Param('id') id: string) {
    return this.returns.inspect(id);
  }

  // Writes dispositionDecidedById.
  @Post('returns/:id/resolve')
  @HttpCode(200)
  @RequirePermissions('return.manage')
  @Audit('return.resolve', 'Return')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveReturnDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.returns.resolve(id, dto, actor.id);
  }
}
