import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    // Each file boots an embedded PostgreSQL in beforeAll; under load that
    // can exceed the 10 s default and skip the whole file.
    hookTimeout: 60000,
  },
});
