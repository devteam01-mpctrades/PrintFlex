import path from "node:path";

/** Absolute SQLite URL for the throwaway test database. */
export const TEST_DB_FILE = path.resolve(process.cwd(), "prisma", "test.sqlite");
export const TEST_DATABASE_URL = `file:${TEST_DB_FILE}`;
