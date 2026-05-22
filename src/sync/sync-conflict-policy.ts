export type ConflictPolicy = 'LAST_WRITE_WINS' | 'REVIEW';

/**
 * Explicit per-(entityType, fieldPath) conflict policy. Low-stakes fields
 * auto-resolve by client timestamp (last write wins); high-stakes fields go to a
 * supervisor review queue. Anything NOT listed defaults to REVIEW: a field is
 * never auto-resolved unless it has been deliberately classified low-stakes.
 */
const FIELD_POLICY: Record<string, ConflictPolicy> = {
  // Low-stakes customer contact fields: last write wins.
  'customer.phone': 'LAST_WRITE_WINS',
  'customer.address': 'LAST_WRITE_WINS',
  'customer.email': 'LAST_WRITE_WINS',

  // High-stakes: unit identity and state always go to review.
  'unit.status': 'REVIEW',
  'unit.engineNumber': 'REVIEW',
  'unit.chassisNumber': 'REVIEW',
  // customer.name / taxId / status are not listed, so they default to REVIEW.
};

export function policyFor(entityType: string, fieldPath: string): ConflictPolicy {
  return FIELD_POLICY[`${entityType}.${fieldPath}`] ?? 'REVIEW';
}
