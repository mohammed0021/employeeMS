import { defineConfig, devices } from "@playwright/test";
import type { Config } from "@playwright/test";

/**
 * E2E suite configuration.
 *
 * The dev server on port 3002 is expected to already be running (ports 3000
 * and 3001 belong to other projects and are never touched), so `webServer`
 * only declares a health URL and reuses whatever is listening — Playwright
 * neither spawns nor kills a server here.
 *
 * NOTE: Playwright 1.64's published types mark `webServer.command` as
 * required, but the runner itself accepts a URL-only entry whenever the URL
 * is already serving and `reuseExistingServer` is set (see the
 * `WebServer` setup in playwright/lib/runner: it returns early on
 * "WebServer is already available" before ever reading `command`). The cast
 * below reflects that supported runtime behaviour.
 */
type WebServer = NonNullable<Config["webServer"]>;

// The published type requires `command`, which we deliberately omit (see the
// note above); `as unknown as` records that intentional deviation.
const webServer = {
  url: "http://localhost:3002",
  reuseExistingServer: true,
  timeout: 60_000,
} as unknown as WebServer;

export default defineConfig({
  testDir: "e2e",
  // The suite shares one dev database (seeded rows + rate limits), so it runs
  // serially: deterministic data, no cross-test races.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3002",
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer,
});
