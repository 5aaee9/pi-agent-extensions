import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup-client.ts"],
    include: ["test/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
