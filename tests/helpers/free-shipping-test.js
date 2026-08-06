import { test as base, expect } from '@playwright/test';

export const test = base.extend({});
export { expect };

// The custom HTML reporter reads this attachment to link a failed test to the
// exact checkout page that was open when the failure occurred.
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;

  await testInfo.attach('Current page URL', {
    body: Buffer.from(page.url()),
    contentType: 'text/plain',
  });
});
