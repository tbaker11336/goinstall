import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Tests share one database and seed data; run files one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
