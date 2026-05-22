/**
 * Shared metadata keys read by the global guards and the audit interceptor.
 * Defined in one place so no decorator and no reader duplicate a magic string.
 */
export const IS_PUBLIC_KEY = 'enviable:isPublic';
export const PERMISSIONS_KEY = 'enviable:requiredPermissions';
export const AUDIT_KEY = 'enviable:audit';

/** Shape stored by @Audit and consumed by the AuditInterceptor. */
export interface AuditMetadata {
  action: string;
  entityType: string;
}
