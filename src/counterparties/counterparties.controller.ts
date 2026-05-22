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
import { CounterpartiesService } from './counterparties.service';
import { CreateCounterpartyDto } from './dto/create-counterparty.dto';
import { QueryCounterpartiesDto } from './dto/query-counterparties.dto';
import { UpdateCounterpartyDto } from './dto/update-counterparty.dto';

@Controller('counterparties')
export class CounterpartiesController {
  constructor(private readonly counterparties: CounterpartiesService) {}

  @Get()
  @RequirePermissions('counterparty.read')
  findAll(@Query() query: QueryCounterpartiesDto) {
    return this.counterparties.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('counterparty.read')
  findOne(@Param('id') id: string) {
    return this.counterparties.findOne(id);
  }

  @Post()
  @RequirePermissions('counterparty.manage')
  @Audit('counterparty.create', 'Counterparty')
  create(@Body() dto: CreateCounterpartyDto, @CurrentUser() actor: Principal) {
    void actor; // actor is captured by the AuditInterceptor via req.user
    return this.counterparties.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('counterparty.manage')
  @Audit('counterparty.update', 'Counterparty')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCounterpartyDto,
    @CurrentUser() actor: Principal,
  ) {
    void actor;
    return this.counterparties.update(id, dto);
  }

  // DELETE is a soft delete. It returns the updated row (200, not 204) so the
  // AuditInterceptor can extract entityId from the response.
  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('counterparty.manage')
  @Audit('counterparty.delete', 'Counterparty')
  remove(@Param('id') id: string, @CurrentUser() actor: Principal) {
    void actor;
    return this.counterparties.softDelete(id);
  }
}
