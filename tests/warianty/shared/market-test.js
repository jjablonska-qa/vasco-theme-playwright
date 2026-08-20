import { test } from '@playwright/test';
import { variantMarketsByCode } from './markets.js';
import { runVariantScenario } from './variant-scenario.js';

export function registerVariantMarketTest(code) {
  const market = variantMarketsByCode[code];
  if (!market) throw new Error(`Unknown variant-test market: ${code}`);

  test(`Warianty ${market.code}: listing i PDP zachowują wybrane warianty w koszyku`, async ({ page }, testInfo) => {
    testInfo.setTimeout(180000);
    const result = await runVariantScenario(page, market);
    await testInfo.attach('Variant scenario', {
      body: Buffer.from(JSON.stringify(result)),
      contentType: 'application/json',
    });
    testInfo.annotations.push({ type: 'variant-inventory', description: 'Unavailable categories are reported as skipped, not failures.' });
  });
}
