import { prisma } from './db.js';

export async function resetDb() {
  await prisma.$executeRaw`TRUNCATE TABLE "comments", "tasks", "users" RESTART IDENTITY CASCADE`;
}