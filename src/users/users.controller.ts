import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Principal } from '../auth/auth.service';
import { Audit, CurrentUser, RequirePermissions } from '../common/decorators';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user.read')
  findAll(@Query() query: QueryUsersDto) {
    return this.users.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('user.read')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  // create writes createdById, so it genuinely needs the principal.
  @Post()
  @RequirePermissions('user.manage')
  @Audit('user.create', 'User')
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: Principal) {
    return this.users.create(dto, actor.id);
  }

  // update writes deactivatedById and enforces self-modification guards, so it
  // needs the acting principal.
  @Patch(':id')
  @RequirePermissions('user.manage')
  @Audit('user.update', 'User')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.users.update(id, dto, actor.id);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('user.manage')
  @Audit('user.delete', 'User')
  remove(@Param('id') id: string, @CurrentUser() actor: Principal) {
    return this.users.softDelete(id, actor.id);
  }

  // Admin forces a reset on the target user's next login (without changing the
  // password). Guarded against self-targeting in the service.
  @Post(':id/reset-password-required')
  @HttpCode(200)
  @RequirePermissions('user.manage')
  @Audit('user.require_password_reset', 'User')
  requireReset(@Param('id') id: string, @CurrentUser() actor: Principal) {
    return this.users.requirePasswordReset(id, actor.id);
  }
}
