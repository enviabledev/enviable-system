import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { AUDIT_KEY, AuditMetadata } from './metadata-keys';

/**
 * Declare that a mutation handler should be audited. The AuditInterceptor reads
 * this and writes an immutable audit log entry (Invariant I-10).
 */
export const Audit = (
  action: string,
  entityType: string,
): CustomDecorator =>
  SetMetadata(AUDIT_KEY, { action, entityType } satisfies AuditMetadata);
