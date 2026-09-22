import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./test/db";

export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    env: { DATABASE_URL: TEST_DATABASE_URL },
    // The suite shares one SQLite file, so run files one at a time.
    fileParallelism: false,
  },
});
