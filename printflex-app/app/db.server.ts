import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

/**
 * DATABASE_URL overrides the datasource in prisma/schema.prisma. Left unset
 * in development and production; the test suite points it at a throwaway
 * SQLite file so tests never touch dev data.
 */
function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  return url ? new PrismaClient({ datasourceUrl: url }) : new PrismaClient();
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createClient();
  }
}

const prisma = global.prismaGlobal ?? createClient();

export default prisma;
