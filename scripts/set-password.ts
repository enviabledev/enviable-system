import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.util';

/**
 * Set a real argon2id password on a seeded user.
 * Usage: npm run set-password -- <email> <password>
 */
async function main(): Promise<void> {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error('Usage: npm run set-password -- <email> <password>');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.update({
      where: { email },
      data: { passwordHash },
    });
    console.log(`Password set for ${user.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
