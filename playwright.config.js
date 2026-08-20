// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * @see https://playwright.dev/docs/test-configuration
 */
const failFast = process.env.FAIL_FAST === '1';
const configuredWorkers = process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : undefined;

export default defineConfig({
  testDir: './tests',
  // Only collect actual test files. Helpers used by VIES must not be treated as tests
  // when Playwright is invoked with a directory path.
  testMatch: /(?:\.spec|vies-checkout-.*)\.js/,
  /* Run tests in files in parallel */
  fullyParallel: failFast ? false : true,
  /* Stop the whole run after the first failure only in explicit fail-fast mode. */
  maxFailures: failFast ? 1 : undefined,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: failFast ? 1 : process.env.CI ? 1 : configuredWorkers || 3,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['line'],
    ['html', { open: 'never' }],
    ['./reporters/free-shipping-audit-reporter.cjs'],
    ['./reporters/vies-audit-reporter.cjs'],
    ['./reporters/cod-audit-reporter.cjs'],
    ['./reporters/variant-audit-reporter.cjs'],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
