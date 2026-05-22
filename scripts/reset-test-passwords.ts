import { PrismaClient } from '@prisma/client';
import { PLACEHOLDER_HASH } from '../src/auth/password.util';

/**
 * Reset the five seeded test accounts back to the non-authenticating
 * placeholder hash. Scoped to these accounts only (never a blanket reset) and
 * idempotent. Use after a walkthrough so verify scripts see a clean state.
 */
const TEST_ACCOUNTS = [
  'theresa@enviable.example',
  'daniel@enviable.example',
  'ikenna@enviable.example',
  'kelechi@enviable.example',
  'itadmin@enviable.example',
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.user.updateMany({
      where: { email: { in: TEST_ACCOUNTS } },
      data: { passwordHash: PLACEHOLDER_HASH },
    });
    console.log(
      `Reset ${result.count} test account(s) to the placeholder hash.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
