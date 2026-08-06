import { test, expect } from '../helpers/free-shipping-test.js';

test.setTimeout(90000);

const es = {
  baseUrl: 'https://traductor-de-voz.es/', checkoutPath: '/pedido', allProductsPath: '/productos/',
  threshold: 50, paidBelow: 9, currency: 'EUR', currencyPattern: /€|EUR/i,
  products: { q1: '38', glass: '40' },
  customer: { firstName: 'Automat', lastName: 'Test', phone: '612345678', address: 'Calle Mayor 123', postcode: '28013', city: 'Madrid', country: 'España' },
};

for (const scenario of [
  { name: 'poniżej progu', product: es.products.glass, free: false, paid: es.paidBelow },
  { name: 'powyżej progu', product: es.products.q1, free: true },
]) {
  test(`ES: darmowa dostawa ${scenario.name}`, async ({ page }) => {
    await addProduct(page, scenario.product);
    await reachShipping(page);
    const methods = await shippingPrices(page);
    expect(methods, 'ES checkout should expose shipping methods.').not.toHaveLength(0);
    const paid = methods.filter(method => method.price > 0);
    if (!scenario.free) {
      expect(paid, 'ES checkout should expose a paid shipping method with an explicit price.').not.toHaveLength(0);
      expect(paid.every(method => method.currency), 'Every numeric ES shipping price should use EUR.').toBeTruthy();
    }
    expect(methods.some(method => method.price === 0), `Shipping methods: ${JSON.stringify(methods)}`).toBe(scenario.free);
    if (!scenario.free) expect(methods.some(method => method.price === scenario.paid), `Shipping methods: ${JSON.stringify(methods)}`).toBeTruthy();
  });
}

async function addProduct(page, productId) {
  await page.goto(new URL(es.allProductsPath, es.baseUrl).href, { waitUntil: 'domcontentloaded' });
  await dismissCookies(page);
  const card = page.locator(`article.product-miniature[data-id-product="${productId}"]`);
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.scrollIntoViewIfNeeded();
  await card.locator('button.add-to-cart').click();
  await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });
  const dialog = page.locator('#blockcart-modal, [role="dialog"][aria-labelledby="blockcart-modal-title"]').first();
  if (await dialog.isVisible().catch(() => false)) {
    const close = dialog.getByRole('button', { name: /cerrar|close/i }).first();
    if (await close.isVisible().catch(() => false)) await close.click({ force: true });
    else await page.keyboard.press('Escape');
  }
}

async function reachShipping(page) {
  await page.goto(new URL(es.checkoutPath, es.baseUrl).href, { waitUntil: 'domcontentloaded' });
  await dismissCookies(page);
  await expect(page.getByText(/Datos Personales|Información personal|Informacion personal|Tus datos/i).first()).toBeVisible({ timeout: 20000 });
  await fillNamed(page, /^Nombre/i, es.customer.firstName);
  await fillNamed(page, /^Apellido|^Apellidos/i, es.customer.lastName);
  await fillNamed(page, /Dirección de correo electrónico|Correo electrónico|Email|E-mail/i, `testcases.web+free-shipping-es-${Date.now().toString(36)}@gmail.com`);
  for (const name of [/Términos de Servicio|Términos y condiciones|Condiciones generales|condiciones/i, /Política de Privacidad|Política de privacidad|privacidad/i]) {
    const checkbox = page.getByRole('checkbox', { name }).first();
    await expect(checkbox).toBeVisible({ timeout: 15000 });
    await checkbox.check({ force: true });
  }
  await clickContinue(page, 0);
  await expect(page.getByText(/dirección de facturación|Cuál es su dirección|Cuál es tu dirección|Elige si deseas la factura como Particular o Empresa/i).first()).toBeVisible({ timeout: 30000 });
  await selectCountry(page, es.customer.country);
  await fillLastPlaceholder(page, /nombre/i, es.customer.firstName);
  await fillLastPlaceholder(page, /apellido|apellidos/i, es.customer.lastName);
  await fillLastPlaceholder(page, /^escribe dirección$|^direccion$|^dirección$/i, es.customer.address);
  await fillLastPlaceholder(page, /código postal|codigo postal|cp/i, es.customer.postcode);
  await fillLastPlaceholder(page, /ciudad|localidad/i, es.customer.city);
  await fillLastTelephone(page, es.customer.phone);
  const addressContinue = page.getByRole('button', { name: /Continuar/i }).last();
  const shippingReady = async () => !(await page.getByRole('textbox', { name: /^Dirección\*/i }).last().isVisible().catch(() => false)) && /Elige el método de envío|Elige el metodo de envio|Método de envío|Metodo de envio/i.test(await page.locator('body').innerText());
  await addressContinue.click({ force: true });
  await expect.poll(shippingReady, { timeout: 12000 }).toBeTruthy().catch(async () => addressContinue.evaluate(element => element.click()));
  await expect.poll(shippingReady, { timeout: 30000 }).toBeTruthy();
}

async function shippingPrices(page) {
  const nodes = page.getByText(/^Elige el método de envío$/i).locator('xpath=..').locator('p');
  const prices = [];
  for (let i = 0; i < await nodes.count(); i += 1) {
    const text = (await nodes.nth(i).innerText()).trim();
    const price = /gratis/i.test(text) ? 0 : parseEuro(text);
    if (price !== null) prices.push({ price, currency: es.currencyPattern.test(text), text });
  }
  return prices;
}

function parseEuro(text) {
  const match = text.match(/(?:€|EUR)\s*([\d\s]+(?:[,.]\d{1,2})?)|([\d\s]+(?:[,.]\d{1,2})?)\s*(?:€|EUR)/i);
  return match ? Number((match[1] || match[2]).replace(/\s/g, '').replace(',', '.')) : null;
}

async function dismissCookies(page) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (!(await dialog.isVisible().catch(() => false))) return;
  const button = page.getByRole('button', { name: /allow all|aceptar todo/i }).first();
  if (await button.isVisible().catch(() => false)) await button.evaluate(element => element.click()).catch(() => button.click({ force: true }));
  await expect(dialog).toBeHidden({ timeout: 10000 }).catch(async () => { if (await dialog.isVisible().catch(() => false)) await dialog.evaluate(element => element.remove()); });
}

async function fillNamed(page, name, value) {
  for (const field of [page.getByRole('textbox', { name }).first(), page.getByPlaceholder(name).first(), page.getByLabel(name).first()]) if (await field.isVisible().catch(() => false)) { await field.fill(value); return; }
  throw new Error(`ES field ${name} is not visible.`);
}
async function fillLastNamed(page, name, value) {
  const fields = page.getByRole('textbox', { name });
  for (let i = (await fields.count()) - 1; i >= 0; i -= 1) if (await fields.nth(i).isVisible().catch(() => false)) { await fields.nth(i).fill(value); return; }
  throw new Error(`ES field ${name} is not visible.`);
}
async function fillLastTelephone(page, value) {
  const fields = page.getByRole('textbox', { name: /teléfono|telefono/i });
  for (let i = (await fields.count()) - 1; i >= 0; i -= 1) {
    const field = fields.nth(i);
    if (!(await field.isVisible().catch(() => false))) continue;
    await field.click({ force: true });
    await field.fill(value);
    await field.dispatchEvent('input');
    await field.dispatchEvent('change');
    if ((await field.inputValue()).replace(/\D/g, '') === value) return;
  }
  throw new Error('Visible ES telephone field was not found.');
}
async function fillLastPlaceholder(page, pattern, value) {
  const fields = page.locator('input[placeholder], textarea[placeholder]');
  for (let i = (await fields.count()) - 1; i >= 0; i -= 1) {
    const field = fields.nth(i);
    if (pattern.test((await field.getAttribute('placeholder').catch(() => '')) || '') && (await field.isVisible().catch(() => false))) { await field.fill(value); return; }
  }
  throw new Error(`ES placeholder ${pattern} is not visible.`);
}
async function clickContinue(page, index) { const buttons = page.getByRole('button', { name: /Continuar/i }); const button = index < 0 ? buttons.last() : buttons.nth(index); await expect(button).toBeVisible({ timeout: 15000 }); await button.click({ force: true }); }
async function selectCountry(page, country) { const select = page.locator('select').filter({ has: page.locator(`option:has-text("${country}")`) }).first(); if (await select.isVisible().catch(() => false)) await select.selectOption({ label: country }); }
