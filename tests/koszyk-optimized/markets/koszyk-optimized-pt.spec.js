import { test } from '@playwright/test';
import { runCartScenario } from '../shared/cart-scenario.js';
import { cartMarketsByCode } from '../shared/markets.js';

test.setTimeout(90000);

test('Koszyk optimized PT zachowuje dodane produkty po przejsciu do koszyka', async ({ page }) => {
  await runCartScenario(page, cartMarketsByCode.PT);
});
