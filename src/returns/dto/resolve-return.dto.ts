import { ReturnDisposition } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ResolveReturnDto {
  // Must be REPAIR or WRITE_OFF (PENDING_DECISION is rejected at resolve).
  @IsEnum(ReturnDisposition, {
    message: 'disposition must be REPAIR or WRITE_OFF',
  })
  disposition!: ReturnDisposition;
}
