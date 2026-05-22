import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { SKIP_COST_STRIP_KEY } from './metadata-keys';

/**
 * Exempt a handler from the global CostVisibilityInterceptor. The response is
 * returned in full even to callers without costdata.view.
 *
 * Use ONLY where returning complete data including cost fields is the deliberate
 * design and access is gated by another permission. The sole use is the
 * audit-log read (gated by audit.read): the audit log is the immutable system
 * of record and must keep full truth (Invariant I-8), so its cost-bearing
 * afterState must not be stripped. Do not apply this to ordinary domain reads.
 */
export const SkipCostStrip = (): CustomDecorator =>
  SetMetadata(SKIP_COST_STRIP_KEY, true);
