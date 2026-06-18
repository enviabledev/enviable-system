import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Audit, RequirePermissions } from '../common/decorators';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('role.read')
  findAll() {
    return this.roles.findAll();
  }

  @Get(':id')
  @RequirePermissions('role.read')
  findOne(@Param('id') id: string) {
    return this.roles.findOne(id);
  }

  @Post()
  @RequirePermissions('role.manage')
  @Audit('role.create', 'Role')
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('role.manage')
  @Audit('role.update', 'Role')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('role.manage')
  @Audit('role.delete', 'Role')
  remove(@Param('id') id: string) {
    return this.roles.softDelete(id);
  }
}
