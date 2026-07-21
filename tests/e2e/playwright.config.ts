import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 120000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  // Keep local/release verification strict. Hosted runners get one retry so a
  // transient window-focus or filesystem refresh race is reported as flaky
  // instead of discarding an otherwise complete multi-platform job.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: '../../test-results/e2e-report.json' }]],
  use: {
    trace: 'retain-on-failure',
  },
});
