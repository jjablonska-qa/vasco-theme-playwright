import { test, expect } from '../helpers/free-shipping-test.js';
import { readShippingSummary, shippingPriceFromText } from '../helpers/shipping-methods.js';

test.setTimeout(120000);

const us = { base: 'https://vasco-translator.com/', products: '/all-products/', checkout: '/order', q1: '38', glass: '40' };

for (const scenario of [
  { name: 'low value', product: us.glass },
  { name: 'higher value', product: us.q1 },
]) {
  test(`US: free shipping — ${scenario.name}`, async ({ page }) => {
    await page.goto(new URL(us.products, us.base).href, { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);
    await addProduct(page, scenario.product);

    await page.goto(new URL(us.checkout, us.base).href, { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);
    await page.locator('input[name="firstname"]').fill('Automation');
    await page.locator('input[name="lastname"]').fill('Test');
    await page.locator('input[name="email"]').fill(`testcases.web+free-shipping-us-${Date.now().toString(36)}@gmail.com`);

    for (const name of [/terms of service|terms and conditions/i, /privacy policy/i]) {
      const checkbox = page.getByRole('checkbox', { name }).first();
      await expect(checkbox).toBeVisible({ timeout: 15000 });
      await checkbox.check({ force: true }).catch(async () => checkbox.evaluate(element => element.click()));
    }

    const continueButton = page.getByRole('button', { name: /continue/i });
    const registerContinue = page.locator('button[name="continue"][data-link-action="register-new-customer"]').first();
    const gdpr = page.getByRole('button', { name: /zgadzam się|zgadzam sie/i }).first();
    if (await gdpr.isVisible().catch(() => false)) await gdpr.click({ force: true });
    const addressReady = async () => page.getByPlaceholder(/enter address|address/i).first().isVisible().catch(() => false);
    const advanceToAddress = async () => {
      if (await registerContinue.isVisible().catch(() => false)) {
        await registerContinue.evaluate(element => element.click());
        return;
      }
      const fallback = continueButton.first();
      await expect(fallback).toBeVisible({ timeout: 15000 });
      await fallback.evaluate(element => element.click());
    };
    await advanceToAddress();
    await expect.poll(addressReady, { timeout: 12000 }).toBeTruthy().catch(async () => {
      await advanceToAddress();
    });
    await expect.poll(addressReady, { timeout: 30000 }).toBeTruthy();

    await fill(page, /first name/i, 'Automation');
    await fill(page, /last name/i, 'Test');
    await fill(page, /^enter address$/i, '350 Fifth Avenue');
    await fill(page, /zip|postal/i, '10018');
    await fill(page, /city/i, 'New York');
    await fill(page, /phone/i, '2125550100');
    const state = page.locator('select').filter({ has: page.locator('option') }).last();
    if (await state.isVisible().catch(() => false)) await state.selectOption({ label: /New York/i }).catch(() => {});
    await continueButton.last().click({ force: true });

    await expect.poll(async () => /shipping method|shipping/i.test(await page.locator('body').innerText()), { timeout: 30000 }).toBeTruthy();
    const shipping = await readShippingSummary(page, /^Shipping$/i);
    expect(shipping, 'US shipping summary').not.toBeNull();
    expect(shippingPriceFromText(shipping, { currency: /\$|USD/, freePattern: /free|gratis/i })).toBe(0);
  });
}

async function acceptCookies(page) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const button = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll,#CybotCookiebotDialogBodyLevelButtonAccept').first();
  if (await button.isVisible().catch(() => false)) await button.click({ force: true });
  const gdpr = page.getByRole('button', { name: /zgadzam się|zgadzam sie/i }).first();
  if (await gdpr.isVisible().catch(() => false)) await gdpr.click({ force: true });
}

async function addProduct(page, id) {
  const card = page.locator(`article.product-miniature[data-id-product="${id}"]`).filter({ has: page.locator('button.add-to-cart:not([disabled])') }).first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.scrollIntoViewIfNeeded();
  const add = card.locator('button.add-to-cart:not([disabled])').first();
  await add.click({ force: true });
  await expect.poll(async () => Number((await page.locator('#header .cart-count').first().innerText()).trim()), { timeout: 5000 }).toBe(1).catch(async () => add.evaluate(element => element.click()));
  await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });
  const modal = page.locator('#blockcart-modal,[role="dialog"][aria-labelledby="blockcart-modal-title"]').first();
  if (await modal.isVisible().catch(() => false)) await page.keyboard.press('Escape');
}

async function fill(page, pattern, value) {
  for (const field of [page.getByPlaceholder(pattern).first(), page.getByRole('textbox', { name: pattern }).first()]) {
    if (await field.isVisible().catch(() => false)) { await field.fill(value); return; }
  }
  throw new Error(`US field not found: ${pattern}`);
}
