import { test, expect } from '../helpers/free-shipping-test.js';
import { readShippingSummary, shippingPriceFromText } from '../helpers/shipping-methods.js';

test.setTimeout(120000);

const se = {
  base: 'https://vasco-translator.se/',
  products: '/alla-produkter/',
  checkout: '/bestallning',
  q1: '38',
  glass: '40',
  customer: {
    firstName: 'Automat',
    lastName: 'Test',
    address: 'Drottninggatan 1',
    postcode: '111 51',
    city: 'Stockholm',
    phone: '701234567',
  },
};

const scenarios = [
  { name: 'niska wartość', product: se.glass, free: true },
  { name: 'wyższa wartość', product: se.q1, free: true },
];

for (const scenario of scenarios) {
  test(`SE: darmowa dostawa ${scenario.name}`, async ({ page }) => {
    await page.goto(new URL(se.products, se.base).href, { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);
    await addProduct(page, scenario.product);

    await page.goto(new URL(se.checkout, se.base).href, { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);
    await fillVisibleField(page, /förnamn|fornamn/i, se.customer.firstName);
    await fillVisibleField(page, /efternamn/i, se.customer.lastName);
    await fillVisibleField(page, /e-post|epost|email/i, uniqueEmail('se'));
    await acceptRequiredAgreements(page, [/användarvillkoren|anvandarvillkoren|villkor/i, /integritetspolicy|sekretesspolicy/i]);

    const continueButton = page.getByRole('button', { name: /fortsätt|fortsatt|gå vidare|ga vidare/i });
    await continueButton.first().click({ force: true });
    await expect.poll(() => hasVisibleField(page, /^ange adress\*?$|^adress\*?$/i), { timeout: 30000 }).toBeTruthy();

    await fillVisibleField(page, /förnamn|fornamn/i, se.customer.firstName);
    await fillVisibleField(page, /efternamn/i, se.customer.lastName);
    await fillVisibleField(page, /^ange adress\*?$|^adress\*?$/i, se.customer.address);
    await fillVisibleField(page, /postnummer/i, se.customer.postcode);
    await fillVisibleField(page, /ort|stad/i, se.customer.city);
    await fillVisibleField(page, /telefon|mobiltelefon/i, se.customer.phone);
    await continueButton.last().click({ force: true });

    await expect.poll(async () => /leveransmetod|leveranssätt|leverans/i.test(await page.locator('body').innerText()), { timeout: 30000 }).toBeTruthy();
    const shipping = await readShippingSummary(page, /^Leverans$/i);
    expect(shipping, 'SE shipping summary').not.toBeNull();
    const price = shippingPriceFromText(shipping, { currency: /kr|SEK|€|EUR/, freePattern: /gratis|kostnadsfri|free/i });
    expect(price, `SE shipping summary: ${shipping}`).not.toBeNull();
    expect(price === 0).toBe(scenario.free);
  });
}

async function acceptCookies(page) {
  const buttons = [
    page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll,#CybotCookiebotDialogBodyLevelButtonAccept').first(),
    page.getByRole('button', { name: /allow all|accept all|tillåt alla|tillat alla/i }).first(),
  ];
  for (const button of buttons) {
    await button.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(async () => button.evaluate(element => element.click()));
      await button.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      return;
    }
  }
}

async function addProduct(page, id) {
  const card = page.locator(`article.product-miniature[data-id-product="${id}"]`).filter({ has: page.locator('button.add-to-cart:not([disabled])') }).first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.scrollIntoViewIfNeeded();
  const addButton = card.locator('button.add-to-cart:not([disabled])').first();
  await addButton.click({ force: true });
  await expect.poll(async () => Number(((await page.locator('#header .cart-count').first().textContent()) || '0').match(/\d+/)?.[0] || 0), { timeout: 15000 }).toBe(1);
  const modal = page.locator('#blockcart-modal,[role="dialog"][aria-labelledby="blockcart-modal-title"]').first();
  if (await modal.isVisible().catch(() => false)) await page.keyboard.press('Escape');
}

async function acceptRequiredAgreements(page, labels) {
  for (const name of labels) {
    const checkbox = page.getByRole('checkbox', { name }).first();
    await expect(checkbox).toBeVisible({ timeout: 15000 });
    await checkbox.check({ force: true }).catch(async () => checkbox.click({ force: true }));
  }
}

async function hasVisibleField(page, pattern) {
  for (const locator of [page.getByPlaceholder(pattern).first(), page.getByRole('textbox', { name: pattern }).first()]) {
    if (await locator.isVisible().catch(() => false)) return true;
  }
  return false;
}

async function fillVisibleField(page, pattern, value) {
  for (const locator of [page.getByPlaceholder(pattern).last(), page.getByRole('textbox', { name: pattern }).last()]) {
    if (await locator.isVisible().catch(() => false)) {
      await locator.fill(value);
      return;
    }
  }
  throw new Error(`SE field not found: ${pattern}`);
}

function uniqueEmail(market) {
  return `testcases.web+free-shipping-${market}-${Date.now().toString(36)}@gmail.com`;
}
