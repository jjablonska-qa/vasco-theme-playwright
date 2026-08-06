import { test, expect } from '../helpers/free-shipping-test.js';

test.setTimeout(90000);

const uk = {
  market: 'UK',
  baseUrl: 'https://vasco-electronics.co.uk/',
  checkoutPath: '/order',
  allProductsPath: '/all-products/',
  currency: 'GBP',
  currencyPattern: /£|GBP/i,
  threshold: 50,
  paidShippingBelowThreshold: 9,
  products: { q1: '38', glass: '40' },
  customer: {
    firstName: 'Automat', lastName: 'Test', phone: '07700900123',
    address1: '10 Downing Street', postcode: 'SW1A 2AA', city: 'London', country: 'United Kingdom',
  },
};

const scenarios = [
  { name: 'poniżej progu', product: uk.products.glass, expectedFreeShipping: false, expectedPaidShipping: uk.paidShippingBelowThreshold },
  { name: 'powyżej progu', product: uk.products.q1, expectedFreeShipping: true },
];

for (const scenario of scenarios) {
  test(`UK: darmowa dostawa ${scenario.name}`, async ({ page }) => {
    await seedCart(page, scenario.product);
    await openCheckoutAndAddress(page);
    const methods = await readShippingMethods(page);

    expect(methods, 'UK checkout should expose shipping methods.').not.toHaveLength(0);
    const paidMethods = methods.filter(method => method.price > 0);
    expect(paidMethods, 'UK checkout should expose a paid shipping method with an explicit price.').not.toHaveLength(0);
    expect(paidMethods.every(method => method.currencyMatches), 'Every numeric UK shipping price should use GBP.').toBeTruthy();

    if (scenario.expectedFreeShipping) {
      expect(methods.some(method => method.price === 0), `Expected free shipping above ${uk.threshold} ${uk.currency}; received: ${formatMethods(methods)}`).toBeTruthy();
      return;
    }

    expect(methods.some(method => method.price === 0), `Did not expect free shipping below ${uk.threshold} ${uk.currency}; received: ${formatMethods(methods)}`).toBeFalsy();
    expect(methods.some(method => method.price === scenario.expectedPaidShipping), `Expected ${scenario.expectedPaidShipping} ${uk.currency} shipping below the threshold; received: ${formatMethods(methods)}`).toBeTruthy();
  });
}

async function seedCart(page, productId) {
  await page.goto(new URL(uk.allProductsPath, uk.baseUrl).href, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);
  const card = page.locator(`article.product-miniature[data-id-product="${productId}"]`);
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.scrollIntoViewIfNeeded();
  await card.locator('button.add-to-cart').click();
  await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });
  await closeCartDialog(page);
}

async function openCheckoutAndAddress(page) {
  await page.goto(new URL(uk.checkoutPath, uk.baseUrl).href, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);
  await expect(page.getByText(/Personal information|Your information/i).first()).toBeVisible({ timeout: 20000 });
  await fillField(page, /^First name/i, uk.customer.firstName);
  await fillField(page, /^Last name/i, uk.customer.lastName);
  await fillField(page, /E-mail|Email/i, uniqueEmail());
  await checkConsents(page);
  await clickContinue(page, 0);

  await expect(page.getByText(/What is your billing address|Billing address/i).first()).toBeVisible({ timeout: 30000 });
  await selectCountry(page, uk.customer.country);
  await fillLastVisiblePlaceholder(page, /first name/i, uk.customer.firstName);
  await fillLastVisiblePlaceholder(page, /last name/i, uk.customer.lastName);
  await fillLastVisiblePlaceholder(page, /^enter address$|^address$/i, uk.customer.address1);
  await fillLastVisiblePlaceholder(page, /postal code|postcode|zip/i, uk.customer.postcode);
  await fillLastVisiblePlaceholder(page, /city|town/i, uk.customer.city);
  await fillPhone(page, uk.customer.phone);
  const addressContinue = page.getByRole('button', { name: /Continue/i }).last();
  const shippingReady = async () => !(await page.getByRole('textbox', { name: /^Address\*/i }).last().isVisible().catch(() => false)) && /Choose your (?:shipping|delivery) method|Select (?:a |your )?(?:shipping|delivery) method|Shipping Method/i.test(await page.locator('body').innerText());
  await addressContinue.click();
  await expect.poll(shippingReady, { timeout: 12000 }).toBeTruthy().catch(async () => addressContinue.evaluate(element => element.click()));
  await expect.poll(shippingReady, { timeout: 30000 }).toBeTruthy();
}

async function readShippingMethods(page) {
  const priceNodes = page.locator('p').filter({ hasText: /tax incl\.|^free!?$/i });
  const methods = [];
  for (let index = 0; index < await priceNodes.count(); index += 1) {
    const priceNode = priceNodes.nth(index);
    const text = (await priceNode.innerText()).trim();
    const price = parsePrice(text);
    if (price !== null) methods.push({ text: text.replace(/\s+/g, ' ').trim(), price, currencyMatches: uk.currencyPattern.test(text) });
  }
  return methods;
}

function parsePrice(text) {
  if (/\b(?:free|gratis)\b/i.test(text)) return 0;
  const match = text.match(/(?:£|GBP)\s*([\d\s]+(?:[,.]\d{1,2})?)|([\d\s]+(?:[,.]\d{1,2})?)\s*(?:£|GBP)/i);
  return match ? Number((match[1] || match[2]).replace(/\s/g, '').replace(',', '.')) : null;
}

function formatMethods(methods) { return methods.map(method => `${method.price}: ${method.text}`).join(' | '); }

async function dismissCookieBanner(page) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (!(await dialog.isVisible().catch(() => false))) return;
  const button = page.getByRole('button', { name: /allow all|accept all/i }).first();
  if (await button.isVisible().catch(() => false)) await button.evaluate(element => element.click()).catch(() => button.click({ force: true }));
  await expect(dialog).toBeHidden({ timeout: 10000 }).catch(async () => {
    if (await dialog.isVisible().catch(() => false)) await dialog.evaluate(element => element.remove());
  });
}

async function closeCartDialog(page) {
  const dialog = page.locator('#blockcart-modal, [role="dialog"][aria-labelledby="blockcart-modal-title"]').first();
  if (!(await dialog.isVisible().catch(() => false))) return;
  const closeButton = dialog.getByRole('button', { name: /close/i }).first();
  if (await closeButton.isVisible().catch(() => false)) await closeButton.click({ force: true });
  else await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 10000 });
}

async function fillField(page, name, value) {
  for (const input of [page.getByRole('textbox', { name }).first(), page.getByPlaceholder(name).first(), page.getByLabel(name).first()]) {
    if (await input.isVisible().catch(() => false)) { await input.fill(value); return; }
  }
  throw new Error(`UK checkout field matching ${name} is not visible.`);
}

async function fillLastVisiblePlaceholder(page, pattern, value) {
  const inputs = page.locator('input[placeholder], textarea[placeholder]');
  for (let index = (await inputs.count()) - 1; index >= 0; index -= 1) {
    const input = inputs.nth(index);
    if (pattern.test((await input.getAttribute('placeholder').catch(() => '')) || '') && (await input.isVisible().catch(() => false))) { await input.fill(value); return; }
  }
  throw new Error(`Visible UK checkout field with placeholder ${pattern} was not found.`);
}

async function fillLastVisibleNamedField(page, name, value) {
  const fields = page.getByRole('textbox', { name });
  for (let index = (await fields.count()) - 1; index >= 0; index -= 1) {
    const field = fields.nth(index);
    if (await field.isVisible().catch(() => false)) { await field.fill(value); return; }
  }
  throw new Error(`Visible UK checkout field matching ${name} was not found.`);
}

async function fillPhone(page, value) {
  let phone = page.locator('#phone-address');
  await expect(phone).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(750);
  phone = page.locator('#phone-address');
  await phone.click();
  await phone.press('ControlOrMeta+A');
  await phone.pressSequentially(value);
  await phone.press('Tab');
  await expect.poll(async () => (await phone.inputValue()).replace(/\s/g, ''), { timeout: 5000 }).toBe(value);
}

async function checkConsents(page) {
  for (const name of [/Terms of Service|Terms and Conditions/i, /Privacy Policy/i]) {
    const checkbox = page.getByRole('checkbox', { name }).first();
    await expect(checkbox).toBeVisible({ timeout: 15000 });
    await checkbox.check({ force: true });
  }
}

async function clickContinue(page, index) {
  const buttons = page.getByRole('button', { name: /Continue/i });
  const button = index < 0 ? buttons.last() : buttons.nth(index);
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.click({ force: true });
}

async function selectCountry(page, country) {
  const select = page.locator('select').filter({ has: page.locator(`option:has-text("${country}")`) }).first();
  if (await select.isVisible().catch(() => false)) await select.selectOption({ label: country });
}

function uniqueEmail() { return `testcases.web+free-shipping-uk-${Date.now().toString(36)}@gmail.com`; }
