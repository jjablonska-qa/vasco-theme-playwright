import { test, expect } from '../helpers/free-shipping-test.js';
import { readShippingMethodPrices } from '../helpers/shipping-methods.js';

test.setTimeout(120000);

const cz = {
  base: 'https://vasco-electronics.cz/', products: '/vsechny-vyrobky/', checkout: '/objednavka',
  threshold: 1850, paid: 80, q1: '38', glass: '40',
  customer: { firstName: 'Automat', lastName: 'Test', address: 'Nádražní', address2: '123', postcode: '110 00', city: 'Praha', phone: '888123456' },
};

for (const scenario of [{ name: 'poniżej progu', product: cz.glass, free: false }, { name: 'powyżej progu', product: cz.q1, free: true }]) {
  test(`CZ: darmowa dostawa ${scenario.name}`, async ({ page }) => {
    await page.goto(new URL(cz.products, cz.base).href, { waitUntil: 'domcontentloaded' });
    await dismissCookies(page);
    const card = page.locator(`article.product-miniature[data-id-product="${scenario.product}"]`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.locator('button.add-to-cart').click();
    await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });

    await page.goto(new URL(cz.checkout, cz.base).href, { waitUntil: 'domcontentloaded' });
    await dismissCookies(page);
    await page.locator('input[name="firstname"]').fill(cz.customer.firstName);
    await page.locator('input[name="lastname"]').fill(cz.customer.lastName);
    await page.locator('input[name="email"]').fill(`testcases.web+free-shipping-cz-${Date.now().toString(36)}@gmail.com`);
    for (const label of [/podminkami|podmínkami|Podminky|Podmínky/i, /Zasady ochrany osobnich udaju|Zásadami ochrany osobních údajů|Ochrana osobnich udaju|Ochrana osobních údajů/i]) {
      const checkbox = page.getByRole('checkbox', { name: label }).first();
      await expect(checkbox).toBeVisible({ timeout: 15000 });
      await checkbox.check({ force: true }).catch(async () => checkbox.evaluate(input => input.click()));
      await expect(checkbox).toBeChecked();
    }
    await continueToAddress(page);
    await fillAddress(page, /jmeno|jméno|krestni jmeno|křestní jméno/i, cz.customer.firstName);
    await fillAddress(page, /prijmeni|příjmení/i, cz.customer.lastName);
    await fillAddress(page, /ulice|adresa/i, cz.customer.address);
    await fillAddress(page, /cislo popisne|číslo popisné/i, cz.customer.address2);
    await fillAddress(page, /psc|psč|postovni smerovaci cislo|poštovní směrovací číslo/i, cz.customer.postcode);
    await fillAddress(page, /mesto\s*\/\s*obec|město\s*\/\s*obec|mesto|město/i, cz.customer.city);
    await fillAddress(page, /telefon|phone/i, cz.customer.phone);
    await next(page, -1);
    await expect.poll(async () => /Vyberte zpusob doruceni|Vyberte způsob doručení|Vyberte zpusob dopravy|Vyberte způsob dopravy/i.test(await page.locator('body').innerText()), { timeout: 30000 }).toBeTruthy();
    const methods = await shippingMethods(page);
    expect(methods.length, 'No CZ shipping prices found.').toBeGreaterThan(0);
    if (scenario.free) expect(methods.some(method => method.price === 0), `CZ shipping: ${JSON.stringify(methods)}`).toBeTruthy();
    else { expect(methods.some(method => method.price === 0), `CZ shipping: ${JSON.stringify(methods)}`).toBeFalsy(); expect(methods.map(method => method.price)).toContain(cz.paid); }
  });
}

async function dismissCookies(page) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const button = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyLevelButtonAccept, #CybotCookiebotDialogBodyButtonAccept').first();
  if (await button.isVisible().catch(() => false)) await button.click({ force: true });
}

async function continueToAddress(page) {
  if (await addressReady(page)) return;
  const button = page.locator('button[name="continue"]').first();
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.click({ force: true });
  await expect.poll(() => addressReady(page), { timeout: 10000 }).toBeTruthy().catch(() => {});
  if (await addressReady(page)) return;
  await page.goto(new URL('/objednavka?id_address=0', cz.base).href, { waitUntil: 'domcontentloaded' });
  const addressTab = page.getByText(/^Adresy$|^Adresa$/i).first();
  if (await addressTab.isVisible().catch(() => false)) await addressTab.click({ force: true });
  await expect.poll(() => addressReady(page), { timeout: 20000 }).toBeTruthy();
}

async function addressReady(page) { return await page.getByRole('textbox', { name: /Ulice|Adresa/i }).last().isVisible().catch(() => false); }
async function fillAddress(page, pattern, value) {
  for (const field of [page.getByPlaceholder(pattern).last(), page.getByRole('textbox', { name: pattern }).last()]) {
    if (await field.isVisible().catch(() => false)) { await field.fill(value); return; }
  }
  throw new Error(`CZ address field not found: ${pattern}`);
}
async function next(page, index) { const buttons = page.getByRole('button', { name: /Pokracovat|Pokračovat/i }); const button = index < 0 ? buttons.last() : buttons.nth(index); await expect(button).toBeVisible({ timeout: 15000 }); await button.click({ force: true }); }
async function shippingMethods(page) {
  return readShippingMethodPrices(page, { currency: /Kč|CZK/, freePattern: /zdarma|gratis|free/ });
}
