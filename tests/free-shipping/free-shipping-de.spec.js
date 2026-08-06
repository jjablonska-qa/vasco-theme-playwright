import { test, expect } from '../helpers/free-shipping-test.js';
import { readShippingSummary, shippingPriceFromText } from '../helpers/shipping-methods.js';

test.setTimeout(120000);

const de = { base: 'https://vasco-electronics.de/', products: '/alle-produkte/', checkout: '/bestellung', q1: '38', glass: '40' };

for (const scenario of [{ name: 'niedriger Warenwert', product: de.glass }, { name: 'höherer Warenwert', product: de.q1 }]) {
  test(`DE: kostenloser Versand — ${scenario.name}`, async ({ page }) => {
    await page.goto(new URL(de.products, de.base).href, { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);
    await addProduct(page, scenario.product);
    await page.goto(new URL(de.checkout, de.base).href, { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);

    await page.locator('input[name="firstname"]').fill('Automat');
    await page.locator('input[name="lastname"]').fill('Test');
    await page.locator('input[name="email"]').fill(`testcases.web+free-shipping-de-${Date.now().toString(36)}@gmail.com`);
    for (const name of [/allgemeinen geschäftsbedingungen|allgemeinen geschaftsbedingungen|agb/i, /sendungsverlauf|dhl|ups/i]) {
      const checkbox = page.getByRole('checkbox', { name }).first();
      await expect(checkbox).toBeVisible({ timeout: 15000 });
      await checkbox.check({ force: true }).catch(async () => checkbox.evaluate(element => element.click()));
    }

    const continueButton = page.getByRole('button', { name: /weiter|fortfahren/i });
    const registerContinue = page.locator('button[name="continue"][data-link-action="register-new-customer"]').first();
    await registerContinue.click({ force: true }).catch(async () => continueButton.first().click({ force: true }));
    await expect.poll(async () => page.getByRole('textbox', { name: /straße|strasse|adresse/i }).first().isVisible().catch(() => false), { timeout: 30000 }).toBeTruthy();
    await fill(page, /vorname/i, 'Automat');
    await fill(page, /^name|nachname/i, 'Test');
    await fill(page, /straße und hausnr|strasse und hausnr|straße|strasse/i, 'Friedrichstraße 123');
    await fill(page, /postleitzahl|plz/i, '10117');
    await fill(page, /stadt|ort/i, 'Berlin');
    await fill(page, /telefon/i, '888123456');
    await continueButton.last().click({ force: true });
    await expect.poll(async () => /lieferart|versandart|versand/i.test(await page.locator('body').innerText()), { timeout: 30000 }).toBeTruthy();
    const shipping = await readShippingSummary(page, /^Versand$/i);
    expect(shipping, 'DE shipping summary').not.toBeNull();
    expect(shippingPriceFromText(shipping, { currency: /€|EUR/, freePattern: /kostenlos|gratis|free/i })).toBe(0);
  });
}

async function acceptCookies(page) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const button = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll,#CybotCookiebotDialogBodyLevelButtonAccept').first();
  if (await button.isVisible().catch(() => false)) await button.click({ force: true });
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
  throw new Error(`DE field not found: ${pattern}`);
}
