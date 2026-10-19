import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration tests hit TEST_DATABASE_URL; run them serially to keep
    // truncate/reset logic deterministic.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
    },
  },
});
