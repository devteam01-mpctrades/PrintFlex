import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "./db";

/**
 * Builds a fresh test database by replaying the committed migrations, so the
 * tests exercise the real schema and the real unique constraints.
 */
export default async function globalSetup(): Promise<void> {
  if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
    throw new Error(`Refusing to wipe ${TEST_DATABASE_URL}: the test database name must contain "test".`);
  }

  const client = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  try {
    await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS public CASCADE`);
    await client.$executeRawUnsafe(`CREATE SCHEMA public`);
  } finally {
    await client.$disconnect();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "ignore",
  });
}
