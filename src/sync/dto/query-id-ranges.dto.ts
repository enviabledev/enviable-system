import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class QueryIdRangesDto {
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @IsOptional()
  @IsString()
  idType?: string;
}
