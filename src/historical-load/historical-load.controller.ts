import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Principal } from '../auth/auth.service';
import { Audit, CurrentUser, RequirePermissions } from '../common/decorators';
import { CreateHistoricalShipmentDto } from './dto/create-historical-shipment.dto';
import { HistoricalLoadService } from './historical-load.service';

// Class-level gate: every route requires historicalload.run (IT Admin only).
@Controller('historical-load')
@RequirePermissions('historicalload.run')
export class HistoricalLoadController {
  constructor(private readonly historicalLoad: HistoricalLoadService) {}

  @Post('shipment')
  @Audit('historical.shipment', 'Shipment')
  createShipment(@Body() dto: CreateHistoricalShipmentDto) {
    return this.historicalLoad.createHistoricalShipment(dto);
  }

  @Post('units/:shipmentId')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  @Audit('historical.units', 'Shipment')
  loadUnits(
    @Param('shipmentId') shipmentId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRun: string,
    @CurrentUser() actor: Principal,
  ) {
    return this.historicalLoad.loadUnits(
      shipmentId,
      file,
      dryRun === 'true',
      actor.id,
    );
  }

  @Post('spare-parts')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  @Audit('historical.spareparts', 'SparePart')
  loadSpareParts(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRun: string,
    @CurrentUser() actor: Principal,
  ) {
    return this.historicalLoad.loadSpareParts(file, dryRun === 'true', actor.id);
  }
}
