import { test, expect } from '../helpers/free-shipping-test.js';

test.setTimeout(90000);

const be = {
  baseUrl: 'https://vasco-translator.be/fr/', productsPath: '/fr/tous-les-produits/', checkoutPath: '/commande',
  threshold: 50, paidBelow: 9, products: { q1: '38', glass: '40' },
  customer: { firstName: 'Automat', lastName: 'Test', address: 'Rue Neuve 123', postcode: '1000', city: 'Bruxelles', phone: '0470123456', country: 'Belgique' },
};

for (const scenario of [
  { name: 'poniżej progu', product: be.products.glass, free: false, paid: be.paidBelow },
  { name: 'powyżej progu', product: be.products.q1, free: true },
]) {
  test(`BE FR: darmowa dostawa ${scenario.name}`, async ({ page }) => {
    await addProduct(page, scenario.product);
    await reachShipping(page);
    const prices = await readPrices(page);
    expect(prices, 'BE checkout should expose shipping prices.').not.toHaveLength(0);
    expect(prices.some(item => item.price === 0), `Shipping prices: ${JSON.stringify(prices)}`).toBe(scenario.free);
    if (!scenario.free) expect(prices.some(item => item.price === scenario.paid), `Shipping prices: ${JSON.stringify(prices)}`).toBeTruthy();
  });
}

async function addProduct(page, product) {
  await page.goto(new URL(be.productsPath, be.baseUrl).href, { waitUntil: 'domcontentloaded' }); await cookies(page);
  const card = page.locator(`article.product-miniature[data-id-product="${product}"]`);
  await expect(card).toBeVisible({ timeout: 15000 }); await card.scrollIntoViewIfNeeded(); await card.locator('button.add-to-cart').click();
  await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });
  const dialog = page.locator('#blockcart-modal, [role="dialog"][aria-labelledby="blockcart-modal-title"]').first();
  if (await dialog.isVisible().catch(() => false)) { const close = dialog.getByRole('button', { name: /fermer|close/i }).first(); if (await close.isVisible().catch(() => false)) await close.click({ force: true }); else await page.keyboard.press('Escape'); }
}

async function reachShipping(page) {
  await page.goto(new URL(be.checkoutPath, be.baseUrl).href, { waitUntil: 'domcontentloaded' }); await cookies(page);
  await expect(page.getByText(/Informations personnelles|Vos informations/i).first()).toBeVisible({ timeout: 20000 });
  await fill(page, /^Prénom|^Prenom/i, be.customer.firstName); await fill(page, /^Nom/i, be.customer.lastName);
  await fill(page, /E-mail|Email/i, `testcases.web+free-shipping-be-${Date.now().toString(36)}@gmail.com`);
  for (const name of [/Conditions générales|Conditions d'utilisation/i, /Politique de confidentialité/i]) { const box = page.getByRole('checkbox', { name }).first(); await expect(box).toBeVisible({ timeout: 15000 }); await box.check({ force: true }); }
  await continueButton(page, 0);
  await expect(page.getByText(/Quelle est votre adresse de facturation/i).first()).toBeVisible({ timeout: 30000 });
  const select = page.locator('select').filter({ has: page.locator('option:has-text("Belgique")') }).first(); if (await select.isVisible().catch(() => false)) await select.selectOption({ label: be.customer.country });
  await lastNamed(page, /^prénom|^prenom/i, be.customer.firstName); await lastNamed(page, /^nom/i, be.customer.lastName); await lastNamed(page, /^adresse/i, be.customer.address); await lastNamed(page, /code postal/i, be.customer.postcode); await lastNamed(page, /^ville/i, be.customer.city); await fillPhone(page, be.customer.phone);
  const addressContinue = page.getByRole('button', { name: /Continuer/i }).last();
  const shippingReady = async () => !(await page.getByRole('textbox', { name: /^Adresse/i }).last().isVisible().catch(() => false)) && /Choisissez votre mode de livraison/i.test(await page.locator('body').innerText());
  await addressContinue.click({ force: true });
  await expect.poll(shippingReady, { timeout: 12000 }).toBeTruthy().catch(async () => addressContinue.evaluate(element => element.click()));
  await expect.poll(shippingReady, { timeout: 30000 }).toBeTruthy();
}

async function readPrices(page) { const out = []; const nodes = page.locator('p'); for (let i = 0; i < await nodes.count(); i += 1) { const text = (await nodes.nth(i).innerText()).trim(); const m = text.match(/(?:€|EUR)\s*([\d.,]+)|([\d.,]+)\s*(?:€|EUR)/i); const price = /gratuit/i.test(text) ? 0 : m ? Number((m[1] || m[2]).replace(',', '.')) : null; if (price !== null) out.push({ price, text }); } return out; }
async function cookies(page) { const dialog = page.locator('#CybotCookiebotDialog'); await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}); if (!(await dialog.isVisible().catch(() => false))) return; const button = page.getByRole('button', { name: /allow all|accepter tout/i }).first(); if (await button.isVisible().catch(() => false)) await button.evaluate(el => el.click()).catch(() => button.click({ force: true })); await expect(dialog).toBeHidden({ timeout: 10000 }).catch(async () => { if (await dialog.isVisible().catch(() => false)) await dialog.evaluate(el => el.remove()); }); }
async function fill(page, name, value) { for (const field of [page.getByRole('textbox', { name }).first(), page.getByPlaceholder(name).first(), page.getByLabel(name).first()]) if (await field.isVisible().catch(() => false)) { await field.fill(value); return; } throw new Error(`BE field ${name} is not visible.`); }
async function lastNamed(page, name, value) { const fields = page.getByRole('textbox', { name }); await expect.poll(async () => { for (let i = (await fields.count()) - 1; i >= 0; i -= 1) if (await fields.nth(i).isVisible().catch(() => false)) return true; return false; }, { timeout: 15000 }).toBeTruthy(); for (let i = (await fields.count()) - 1; i >= 0; i -= 1) if (await fields.nth(i).isVisible().catch(() => false)) { await fields.nth(i).fill(value); return; } throw new Error(`BE field ${name} is not visible.`); }
async function lastPlaceholder(page, pattern, value) { const fields = page.locator('input[placeholder], textarea[placeholder]'); for (let i = (await fields.count()) - 1; i >= 0; i -= 1) { const field = fields.nth(i); if (pattern.test((await field.getAttribute('placeholder').catch(() => '')) || '') && (await field.isVisible().catch(() => false))) { await field.fill(value); return; } } throw new Error(`BE placeholder ${pattern} is not visible.`); }
async function fillPhone(page, value) { const fields = page.locator('input[type="tel"], input[name*="phone" i], input[name*="telephone" i]'); for (let i = (await fields.count()) - 1; i >= 0; i -= 1) if (await fields.nth(i).isVisible().catch(() => false)) { await fields.nth(i).fill(value); return; } await lastNamed(page, /téléphone|telephone/i, value); }
async function continueButton(page, index) { const buttons = page.getByRole('button', { name: /Continuer/i }); const button = index < 0 ? buttons.last() : buttons.nth(index); await expect(button).toBeVisible({ timeout: 15000 }); await button.click({ force: true }); }
