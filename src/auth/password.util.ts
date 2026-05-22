import * as argon2 from 'argon2';

/**
 * Non-authenticating placeholder hash. The seed assigns this to every user so
 * that a seeded-but-not-yet-activated account exists without a usable password.
 * It is not a valid argon2 encoded hash, so verifyPassword always returns false
 * for it. Defined here in exactly one place and must match prisma/seed.ts and
 * any password reset script.
 */
export const PLACEHOLDER_HASH = '$argon2id$PLACEHOLDER_RESET_REQUIRED';

// argon2id with parameters at or above current OWASP guidance for this profile.
const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash. Returns false (never
 * throws) when the hash is the placeholder or is otherwise malformed, so the
 * login path stays clean for seeded-but-not-yet-activated users.
 */
export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  if (!hash || hash === PLACEHOLDER_HASH) {
    return false;
  }
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
