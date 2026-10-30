import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  fullyParallel: false,
  timeout: 360000,
  expect: { timeout: 15000 },
  reporter: [["list"], ["json", { outputFile: "../reports/playwright.json" }]],
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    channel: "msedge",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Edge"] } }],
});
