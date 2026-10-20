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
    // tests/setup.ts runs BEFORE any test file imports "@/lib/*" — it points
    // EMS_DATABASE_URL at TEST_DATABASE_URL (see the file for the guards).
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // One shared database: files must never run concurrently, or two suites
    // would see (and clean up) each other's rows.
    fileParallelism: false,
    testTimeout: 30_000,
    // Fixture setup (scrypt hashes, Neon cold starts) can exceed the 5s default.
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
    },
  },
});
