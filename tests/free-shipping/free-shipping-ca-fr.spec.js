import { test, expect } from '../helpers/free-shipping-test.js';

test.setTimeout(90000);

const ca = {
  baseUrl: 'https://vasco-translator.ca/',
  productsPath: '/fr/tous-les-produits/',
  checkoutPath: '/fr/commande',
  currency: /CAD|\$/i,
  products: { adapter: '53', q1: '38' },
  customer: {
    firstName: 'Automat', lastName: 'Test', address: '123 Rue Sainte-Catherine',
    postcode: 'H2B 1A0', city: 'Montréal', province: /Québec|Quebec/i,
    phone: '5145551234', country: 'Canada',
  },
};

for (const scenario of [
  { name: 'przy niskiej wartości koszyka', product: ca.products.adapter, free: false },
  { name: 'przy wyższej wartości koszyka', product: ca.products.q1, free: true },
]) {
  test(`CA: darmowa dostawa ${scenario.name}`, async ({ page }) => {
    await addProduct(page, scenario.product);
    await reachShipping(page);
    const prices = await readShippingPrices(page);

    expect(prices, 'CA checkout should expose shipping prices.').not.toHaveLength(0);
    expect(prices.some(item => item.price === 0), `Shipping prices: ${JSON.stringify(prices)}`).toBe(scenario.free);
  });
}

async function addProduct(page, productId) {
  await page.goto(new URL(ca.productsPath, ca.baseUrl).href, { waitUntil: 'domcontentloaded' });
  await dismissCookies(page);
  const card = page.locator(`article.product-miniature[data-id-product="${productId}"]`);
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.scrollIntoViewIfNeeded();
  await card.locator('button.add-to-cart').click();
  await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });
  await closeCartDialog(page);
}

async function reachShipping(page) {
  await page.goto(new URL(ca.checkoutPath, ca.baseUrl).href, { waitUntil: 'domcontentloaded' });
  await dismissCookies(page);
  await expect(page.getByText(/Informations personnelles|Vos informations/i).first()).toBeVisible({ timeout: 20000 });
  await fillNamedField(page, /^Prénom|^Prenom/i, ca.customer.firstName);
  await fillNamedField(page, /^Nom/i, ca.customer.lastName);
  await fillNamedField(page, /E-mail|Email/i, `testcases.web+free-shipping-ca-${Date.now().toString(36)}@gmail.com`);
  await acceptConsents(page);
  await clickContinue(page, 0);

  await expect(page.getByText(/Quelle est votre adresse de facturation/i).first()).toBeVisible({ timeout: 30000 });
  await selectOption(page, ca.customer.country);
  await expect.poll(async () => (await page.locator('select').last().locator('option').allTextContents()).some(text => ca.customer.province.test(text)), { timeout: 10000 }).toBeTruthy();
  await fillLastNamedField(page, /^prénom|^prenom/i, ca.customer.firstName);
  await fillLastNamedField(page, /^nom/i, ca.customer.lastName);
  await fillLastNamedField(page, /^adresse/i, ca.customer.address);
  await fillLastNamedField(page, /code postal/i, ca.customer.postcode);
  await fillLastNamedField(page, /^ville/i, ca.customer.city);
  await selectOption(page, ca.customer.province);
  await expect.poll(async () => ca.customer.province.test((await page.locator('select').last().locator('option:checked').innerText()).trim()), { timeout: 10000 })
    .toBeTruthy()
    .catch(async () => selectOption(page, ca.customer.province));
  await fillPhone(page, ca.customer.phone);

  const addressContinue = page.getByRole('button', { name: /Continuer/i }).last();
  const shippingReady = async () => !(await page.getByRole('textbox', { name: /^Adresse/i }).last().isVisible().catch(() => false))
    && /Choisissez votre mode de livraison/i.test(await page.locator('body').innerText());
  await addressContinue.click({ force: true });
  await expect.poll(shippingReady, { timeout: 12000 }).toBeTruthy().catch(async () => addressContinue.evaluate(element => element.click()));
  await expect.poll(shippingReady, { timeout: 30000 }).toBeTruthy();
}

async function readShippingPrices(page) {
  const prices = [];
  const nodes = page.getByText(/^Choisissez votre mode de livraison$/i).locator('xpath=..').locator('p');
  for (let index = 0; index < await nodes.count(); index += 1) {
    const text = (await nodes.nth(index).innerText()).trim();
    const match = text.match(/(?:CAD|\$)\s*([\d.,]+)|([\d.,]+)\s*(?:CAD|\$)/i);
    const price = /gratuit/i.test(text) ? 0 : match ? Number((match[1] || match[2]).replace(',', '.')) : null;
    if (price !== null) prices.push({ price, text });
  }
  return prices;
}

async function dismissCookies(page) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (!(await dialog.isVisible().catch(() => false))) return;
  const button = page.getByRole('button', { name: /accepter tout|allow all/i }).first();
  if (await button.isVisible().catch(() => false)) await button.evaluate(element => element.click()).catch(() => button.click({ force: true }));
  await expect(dialog).toBeHidden({ timeout: 10000 }).catch(() => {});
}

async function closeCartDialog(page) {
  const dialog = page.locator('#blockcart-modal, [role="dialog"][aria-labelledby="blockcart-modal-title"]').first();
  if (!(await dialog.isVisible().catch(() => false))) return;
  const close = dialog.getByRole('button', { name: /fermer|close/i }).first();
  if (await close.isVisible().catch(() => false)) await close.click({ force: true });
  else await page.keyboard.press('Escape');
}

async function fillNamedField(page, name, value) {
  const field = page.getByRole('textbox', { name }).first();
  await expect(field).toBeVisible({ timeout: 15000 });
  await field.fill(value);
}

async function fillLastNamedField(page, name, value) {
  const fields = page.getByRole('textbox', { name });
  for (let index = (await fields.count()) - 1; index >= 0; index -= 1) {
    if (await fields.nth(index).isVisible().catch(() => false)) {
      await fields.nth(index).fill(value);
      return;
    }
  }
  throw new Error(`CA address field ${name} is not visible.`);
}

async function selectOption(page, option) {
  const selects = page.locator('select');
  for (let index = (await selects.count()) - 1; index >= 0; index -= 1) {
    const select = selects.nth(index);
    if (!(await select.isVisible().catch(() => false))) continue;
    const options = await select.locator('option').allTextContents();
    const matchingOption = options.find(text => typeof option === 'string' ? text.trim() === option : option.test(text));
    if (matchingOption) {
      await select.selectOption({ label: matchingOption });
      return;
    }
  }
  throw new Error(`CA select option ${option} is not available.`);
}

async function fillPhone(page, value) {
  const phone = page.getByRole('textbox', { name: /téléphone|telephone/i }).last();
  await expect(phone).toBeVisible({ timeout: 15000 });
  await phone.fill(value);
  await phone.press('Tab');
}

async function acceptConsents(page) {
  for (const name of [/Conditions générales|Conditions d'utilisation/i, /Politique de confidentialité/i]) {
    const checkbox = page.getByRole('checkbox', { name }).first();
    await expect(checkbox).toBeVisible({ timeout: 15000 });
    await checkbox.check({ force: true });
  }
}

async function clickContinue(page, index) {
  const buttons = page.getByRole('button', { name: /Continuer/i });
  const button = index < 0 ? buttons.last() : buttons.nth(index);
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.click({ force: true });
}
