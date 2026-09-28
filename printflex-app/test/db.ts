/**
 * The throwaway PostgreSQL database the test suite runs against. It is wiped
 * and rebuilt from the committed migrations on every run, so point it only at
 * a database that exists for tests. Override with TEST_DATABASE_URL.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://mpctradesbackup@127.0.0.1:5433/printflex_test";
