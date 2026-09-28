import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

/**
 * PostgreSQL, addressed by DATABASE_URL (prisma/schema.prisma reads it). Each
 * environment has its own database: .env on the Mac, the server's .env for dev
 * and production, and a throwaway database for the test suite.
 */
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
