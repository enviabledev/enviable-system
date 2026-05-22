import { PrismaClient } from '@prisma/client';
import { PLACEHOLDER_HASH } from '../src/auth/password.util';

/**
 * Reset the five seeded test accounts back to the non-authenticating
 * placeholder hash. Scoped to these accounts only (never a blanket reset) and
 * idempotent. Each account is classified and reported individually: reset (had
 * a real hash, now placeholder), already placeholder (left untouched), or not
 * found. Use after a walkthrough so verify scripts see a clean state.
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
    const users = await prisma.user.findMany({
      where: { email: { in: TEST_ACCOUNTS } },
      select: { email: true, passwordHash: true },
    });
    const byEmail = new Map(users.map((u) => [u.email, u]));

    let reset = 0;
    let alreadyPlaceholder = 0;
    let notFound = 0;

    for (const email of TEST_ACCOUNTS) {
      const user = byEmail.get(email);
      if (!user) {
        console.log(`  not found:            ${email}`);
        notFound += 1;
        continue;
      }
      if (user.passwordHash === PLACEHOLDER_HASH) {
        console.log(`  already placeholder:  ${email}`);
        alreadyPlaceholder += 1;
        continue;
      }
      // Update by exact email only; never a blanket update across all users.
      await prisma.user.update({
        where: { email },
        data: { passwordHash: PLACEHOLDER_HASH },
      });
      console.log(`  reset:                ${email}`);
      reset += 1;
    }

    console.log(
      `reset-test-passwords: ${reset} reset, ${alreadyPlaceholder} already placeholder, ${notFound} not found.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
