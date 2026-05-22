/**
 * Shared metadata keys read by the global guards and the audit interceptor.
 * Defined in one place so no decorator and no reader duplicate a magic string.
 */
export const IS_PUBLIC_KEY = 'enviable:isPublic';
export const PERMISSIONS_KEY = 'enviable:requiredPermissions';
export const AUDIT_KEY = 'enviable:audit';
// Marks a handler whose response the CostVisibilityInterceptor must NOT strip,
// even for callers lacking costdata.view. Reserved for the audit-log read: the
// audit log is the system of record and keeps full truth (Invariant I-8 design);
// privacy comes from gating audit.read, not from sanitising the rows.
export const SKIP_COST_STRIP_KEY = 'enviable:skipCostStrip';

/** Shape stored by @Audit and consumed by the AuditInterceptor. */
export interface AuditMetadata {
  action: string;
  entityType: string;
}
