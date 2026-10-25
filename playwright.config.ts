import { defineConfig, devices } from "@playwright/test";

const port = 4174;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "./node_modules/.bin/tsx apps/api/src/server.ts",
      url: "http://127.0.0.1:4173/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { ...process.env, GITHUB_REPO_ALLOWLIST: "octo/demo", GITHUB_DRY_RUN: "true" },
    },
    {
      command: `./node_modules/.bin/vite apps/web --config apps/web/vite.config.ts --host 127.0.0.1 --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
