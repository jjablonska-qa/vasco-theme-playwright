import { test, expect } from '../helpers/free-shipping-test.js';
import { readShippingSummary, shippingPriceFromText } from '../helpers/shipping-methods.js';

test.setTimeout(120000);

const fi = { base: 'https://vasco-translator.fi/', products: '/kaikki-tuotteet/', checkout: '/tilaus', q1: '38', glass: '40' };

for (const scenario of [{ name: 'pieni arvo', product: fi.glass }, { name: 'suurempi arvo', product: fi.q1 }]) {
  test(`FI: ilmainen toimitus — ${scenario.name}`, async ({ page }) => {
    await page.goto(new URL(fi.products, fi.base).href, { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);
    await addProduct(page, scenario.product);
    await page.goto(new URL(fi.checkout, fi.base).href, { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);

    await page.locator('input[name="firstname"]').fill('Automaatio');
    await page.locator('input[name="lastname"]').fill('Testi');
    await page.locator('input[name="email"]').fill(`testcases.web+free-shipping-fi-${Date.now().toString(36)}@gmail.com`);
    for (const name of [/käyttöehdot|kayttoehdot|ehdot/i, /tietosuojakäytäntö|tietosuojakaytanto|tietosuoja/i]) {
      const checkbox = page.getByRole('checkbox', { name }).first();
      await expect(checkbox).toBeVisible({ timeout: 15000 });
      await checkbox.check({ force: true }).catch(async () => checkbox.evaluate(element => element.click()));
    }

    const continueButton = page.getByRole('button', { name: /jatka/i });
    const registerContinue = page.locator('button[name="continue"][data-link-action="register-new-customer"]').first();
    await registerContinue.click({ force: true }).catch(async () => continueButton.first().click({ force: true }));
    await expect.poll(async () => page.getByPlaceholder(/osoite/i).first().isVisible().catch(() => false), { timeout: 30000 }).toBeTruthy();
    await fill(page, /etunimi/i, 'Automaatio');
    await fill(page, /sukunimi/i, 'Testi');
    await fill(page, /^anna osoite$/i, 'Mannerheimintie 1');
    await fill(page, /postinumero/i, '00100');
    await fill(page, /postitoimipaikka|kaupunki/i, 'Helsinki');
    await fill(page, /matkapuhelin|puhelin/i, '401234567');
    await continueButton.last().click({ force: true });
    await expect.poll(async () => /toimitustapa|toimitus/i.test(await page.locator('body').innerText()), { timeout: 30000 }).toBeTruthy();
    const shipping = await readShippingSummary(page, /^Toimitus$/i);
    expect(shipping, 'FI shipping summary').not.toBeNull();
    expect(shippingPriceFromText(shipping, { currency: /€|EUR/, freePattern: /ilmainen|maksuton|free/i })).toBe(0);
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
  throw new Error(`FI field not found: ${pattern}`);
}
