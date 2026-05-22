import { Allow, IsEnum } from 'class-validator';

export enum ConflictChoice {
  // Keep version A (the server side captured at conflict time).
  A = 'A',
  // Take version B (the incoming device value).
  B = 'B',
  // Apply a supervisor-supplied merged value (provide mergedValue).
  MERGED = 'MERGED',
}

export class ResolveConflictDto {
  @IsEnum(ConflictChoice, { message: 'choice must be A, B, or MERGED' })
  choice!: ConflictChoice;

  // Required only when choice is MERGED. @Allow keeps it through whitelist
  // validation since it carries no type decorator (the value may be anything).
  @Allow()
  mergedValue?: unknown;
}
