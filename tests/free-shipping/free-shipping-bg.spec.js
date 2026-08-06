import { test, expect } from '../helpers/free-shipping-test.js';

test.setTimeout(90000);

const bg = {
  market: 'BG',
  baseUrl: 'https://vasco-electronics.bg/',
  checkoutPath: '/poracka',
  allProductsPath: '/vsicki-produkti/',
  currency: 'BGN',
  currencyPattern: /лв\.?|BGN/i,
  threshold: 97.79,
  paidShippingBelowThreshold: 18,
  products: {
    q1: '38',
    glass: '40',
  },
  customer: {
    firstName: 'Automat',
    lastName: 'Test',
    phone: '888123456',
    address1: 'бул. България 1',
    postcode: '1000',
    city: 'София',
  },
};

const scenarios = [
  {
    name: 'poniżej progu',
    products: [{ id: bg.products.glass, quantity: 1 }],
    expectedFreeShipping: false,
    expectedPaidShipping: bg.paidShippingBelowThreshold,
  },
  {
    name: 'powyżej progu',
    products: [{ id: bg.products.q1, quantity: 1 }],
    expectedFreeShipping: true,
  },
];

for (const scenario of scenarios) {
  test(`BG: darmowa dostawa ${scenario.name}`, async ({ page }) => {
    await seedCart(page, scenario.products);
    await openCheckoutAndAddress(page);

    const shippingMethods = await readShippingMethods(page);
    expect(shippingMethods, 'BG checkout should expose at least one shipping method.').not.toHaveLength(0);
    const paidShippingMethods = shippingMethods.filter(method => method.price > 0);
    expect(paidShippingMethods, 'BG checkout should expose at least one paid shipping method with an explicit price.').not.toHaveLength(0);
    expect(paidShippingMethods.every(method => method.currencyMatches), 'Every numeric BG shipping price should use BGN.').toBeTruthy();

    if (scenario.expectedFreeShipping) {
      expect(
        shippingMethods.some(method => method.price === 0),
        `Expected a free shipping method above ${bg.threshold} ${bg.currency}; received: ${formatMethods(shippingMethods)}`
      ).toBeTruthy();
    } else {
      expect(
        shippingMethods.some(method => method.price === 0),
        `Did not expect free shipping below ${bg.threshold} ${bg.currency}; received: ${formatMethods(shippingMethods)}`
      ).toBeFalsy();
      expect(
        shippingMethods.some(method => method.price === scenario.expectedPaidShipping),
        `Expected a ${scenario.expectedPaidShipping} ${bg.currency} shipping method below the threshold; received: ${formatMethods(shippingMethods)}`
      ).toBeTruthy();
    }
  });
}

async function seedCart(page, products) {
  await page.goto(new URL(bg.allProductsPath, bg.baseUrl).href, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);

  let expectedCount = 0;
  for (const product of products) {
    for (let index = 0; index < product.quantity; index += 1) {
      const card = page.locator(`article.product-miniature[data-id-product="${product.id}"]`);
      const addButton = card.locator('button.add-to-cart');
      await expect(card).toBeVisible({ timeout: 15000 });
      await card.scrollIntoViewIfNeeded();
      await addButton.click();
      expectedCount += 1;
      await expect(page.locator('#header .cart-count').first()).toHaveText(String(expectedCount), { timeout: 15000 });
      await closeCartDialog(page);
      await page.goto(new URL(bg.allProductsPath, bg.baseUrl).href, { waitUntil: 'domcontentloaded' });
      await dismissCookieBanner(page);
    }
  }
}

async function openCheckoutAndAddress(page) {
  await page.goto(new URL(bg.checkoutPath, bg.baseUrl).href, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);

  await expect(page.getByText(/Лична информация|Лични данни|Информация за клиента/i).first()).toBeVisible({ timeout: 20000 });
  await fillField(page, /^Име/i, bg.customer.firstName);
  await fillField(page, /^Фамилия|^Име на семейство/i, bg.customer.lastName);
  await fillField(page, /E-mail|Имейл/i, uniqueEmail());
  await checkRequiredConsents(page);
  await continueToAddress(page);

  await selectCountry(page, 'България');
  await fillByPlaceholder(page, /(enter\s*)?име/i, bg.customer.firstName);
  await fillByPlaceholder(page, /(enter\s*)?фамилия|(enter\s*)?име на семейство/i, bg.customer.lastName);
  await fillByPlaceholder(page, /^въведете адрес$|^адрес$/i, bg.customer.address1);
  await fillByPlaceholder(page, /(enter\s*)?пощенски код/i, bg.customer.postcode);
  await fillByPlaceholder(page, /(enter\s*)?град/i, bg.customer.city);
  const phone = page.getByRole('textbox', { name: /телефон/i }).last();
  await expect(phone).toBeVisible({ timeout: 15000 });
  await phone.fill(bg.customer.phone);

  const continueButton = page.getByRole('button', { name: /Продължи|Продължете/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  const shippingReady = async () => /Изберете вашия метод за доставка/i.test(await page.locator('body').innerText());
  await continueButton.click({ force: true });
  await expect.poll(shippingReady, { timeout: 12000 }).toBeTruthy().catch(async () => continueButton.evaluate(element => element.click()));
  await expect.poll(shippingReady, { timeout: 30000 }).toBeTruthy();
}

async function readShippingMethods(page) {
  const radios = page.locator('input[type="radio"]');
  const count = await radios.count();
  const methods = [];

  for (let index = 0; index < count; index += 1) {
    const radio = radios.nth(index);
    const container = radio.locator('xpath=ancestor::*[self::li or self:div][.//label][1]').first();
    const text = (await container.innerText().catch(() => '')) || (await radio.evaluate(element => element.parentElement?.innerText || ''));
    const price = parsePrice(text);
    if (price === null) continue;
    methods.push({ text: text.replace(/\s+/g, ' ').trim(), price, currencyMatches: bg.currencyPattern.test(text) });
  }

  return methods;
}

function parsePrice(text) {
  if (/\b(?:free|gratis)\b|безплат/i.test(text)) return 0;
  const match = text.match(/([\d\s]+(?:[,.]\d{1,2})?)\s*(?:лв\.?|BGN)/i);
  return match ? Number(match[1].replace(/\s/g, '').replace(',', '.')) : null;
}

function formatMethods(methods) {
  return methods.map(method => `${method.price}: ${method.text}`).join(' | ');
}

async function dismissCookieBanner(page) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (!(await dialog.isVisible().catch(() => false))) return;

  const buttons = [
    page.getByRole('button', { name: /allow all|разреши всички/i }).first(),
    page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll').first(),
    page.locator('#CybotCookiebotDialogBodyLevelButtonAccept').first(),
    page.locator('#CybotCookiebotDialogBodyButtonAccept').first(),
  ];
  for (const button of buttons) {
    if (await button.isVisible().catch(() => false)) {
      await button.evaluate(element => element.click()).catch(async () => {
        await button.click({ force: true });
      });
      await expect(dialog).toBeHidden({ timeout: 10000 }).catch(() => {});
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.evaluate(element => element.remove());
      }
      return;
    }
  }
}

async function closeCartDialog(page) {
  const dialog = page.locator('#blockcart-modal, [role="dialog"][aria-labelledby="blockcart-modal-title"]').first();
  if (!(await dialog.isVisible().catch(() => false))) return;
  const closeButton = dialog.getByRole('button', { name: /Затвори|Close/i }).first();
  if (await closeButton.isVisible().catch(() => false)) await closeButton.click({ force: true });
  else await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 10000 });
}

async function fillField(page, label, value) {
  const candidates = [
    page.getByRole('textbox', { name: label }).first(),
    page.getByPlaceholder(label).first(),
    page.getByLabel(label).first(),
  ];
  for (const input of candidates) {
    if (await input.isVisible().catch(() => false)) {
      await input.fill(value);
      return;
    }
  }
  throw new Error(`BG checkout field matching ${label} is not visible.`);
}

async function fillByPlaceholder(page, placeholder, value) {
  const inputs = page.locator('input[placeholder], textarea[placeholder]');
  const count = await inputs.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const input = inputs.nth(index);
    const text = (await input.getAttribute('placeholder').catch(() => '')) || '';
    if (placeholder.test(text) && (await input.isVisible().catch(() => false))) {
      await input.fill(value);
      return;
    }
  }
  throw new Error(`Visible BG checkout field with placeholder ${placeholder} was not found.`);
}

async function checkRequiredConsents(page) {
  for (const name of [/Условия(та)?/i, /Политика(та)? за поверителност/i]) {
    const checkbox = page.getByRole('checkbox', { name }).first();
    await expect(checkbox).toBeVisible({ timeout: 15000 });
    await checkbox.check({ force: true });
  }
}

async function continueToAddress(page) {
  const button = page.getByRole('button', { name: /Продължи|Продължете/i }).first();
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.click({ force: true });
  await expect(page.getByText(/Какъв е вашият адрес за фактуриране\?/i).first()).toBeVisible({ timeout: 30000 });
}

async function selectCountry(page, country) {
  const select = page.locator('select').filter({ has: page.locator(`option:has-text("${country}")`) }).first();
  if (await select.isVisible().catch(() => false)) await select.selectOption({ label: country });
}

function uniqueEmail() {
  return `testcases.web+free-shipping-bg-${Date.now().toString(36)}@gmail.com`;
}
