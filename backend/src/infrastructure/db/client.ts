/** Prisma client singleton (one pool per process). */
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __verraPrisma: PrismaClient | undefined;
}

export function getPrisma(): PrismaClient {
  if (!global.__verraPrisma) {
    global.__verraPrisma = new PrismaClient();
  }
  return global.__verraPrisma;
}

export async function closePrisma(): Promise<void> {
  await global.__verraPrisma?.$disconnect();
  global.__verraPrisma = undefined;
}
