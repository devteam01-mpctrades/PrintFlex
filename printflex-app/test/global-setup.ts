import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL, TEST_DB_FILE } from "./db";

/**
 * Builds a fresh test database by replaying the committed migrations, so the
 * tests exercise the real schema and the real unique constraints.
 */
export default async function globalSetup(): Promise<void> {
  for (const suffix of ["", "-journal"]) {
    fs.rmSync(`${TEST_DB_FILE}${suffix}`, { force: true });
  }

  const client = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  const migrationsDir = path.resolve(process.cwd(), "prisma", "migrations");
  const dirs = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  try {
    for (const dir of dirs) {
      const sql = fs.readFileSync(path.join(migrationsDir, dir, "migration.sql"), "utf8");
      const statements = sql
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const statement of statements) {
        await client.$executeRawUnsafe(statement);
      }
    }
  } finally {
    await client.$disconnect();
  }
}
