import { test, expect } from '../helpers/free-shipping-test.js';
import { readShippingSummary, shippingPriceFromText } from '../helpers/shipping-methods.js';

test.setTimeout(120000);

const ro = { base: 'https://vasco-electronics.ro/', products: '/toate-produsele/', checkout: '/comanda', threshold: 250, paid: 45, q1: '38', glass: '40' };

for (const scenario of [{ name: 'poniżej progu', product: ro.glass, free: false }, { name: 'powyżej progu', product: ro.q1, free: true }]) {
  test(`RO: darmowa dostawa ${scenario.name}`, async ({ page }) => {
    await page.goto(new URL(ro.products, ro.base).href, { waitUntil: 'domcontentloaded' }); await dismissCookies(page);
    const card = page.locator(`article.product-miniature[data-id-product="${scenario.product}"]`); await expect(card).toBeVisible({ timeout: 15000 }); const add = card.locator('button.add-to-cart'); await add.click({ force: true }); await expect.poll(async () => Number((await page.locator('#header .cart-count').first().innerText()).trim()), { timeout: 5000 }).toBe(1).catch(async () => add.evaluate(element => element.click())); await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });
    await page.goto(new URL(ro.checkout, ro.base).href, { waitUntil: 'domcontentloaded' });
    await dismissCookies(page);
    await personalField(page, 'firstname', 'Automat');
    await personalField(page, 'lastname', 'Test');
    await personalField(page, 'email', `testcases.web+free-shipping-ro-${Date.now().toString(36)}@gmail.com`);
    for (const name of [/Termenii.*condiți|Termenii.*conditii/i, /Politica de confidențialitate|Politica de confidentialitate/i]) {
      const box = page.getByRole('checkbox', { name }).first();
      await expect(box).toBeVisible({ timeout: 15000 });
      await box.check({ force: true }).catch(async () => { await box.evaluate(input => input.click()); });
      await expect(box).toBeChecked();
    }
    await continueToAddressStep(page);
    await named(page, /Prenume/i, 'Automat'); await named(page, /^Nume/i, 'Test');
    await fillAddress(page, /enter adresa|adresa \( str\. si nr\.\)|adres/i, 'Strada Lipscani 12');
    await fillAddress(page, /detalii suplimentare|completare adres|adresa 2|apartament|etaj/i, '2');
    await fillAddress(page, /cod poștal|cod postal|poștal|postal/i, '030167');
    await fillAddress(page, /oraș|oras|localitate/i, 'Bucuresti');
    await selectCounty(page, 'Bucuresti');
    await fillAddress(page, /telefon|phone|712\s*034\s*567/i, '0712345678');
    const addressContinue = page.getByRole('button', { name: /Continuă|Continua/i }).last();
    const shippingReady = async () => {
      const addressVisible = await page.getByPlaceholder(/enter adresa \( str\. si nr\.\)/i).last().isVisible().catch(() => false);
      return !addressVisible && /Alege metoda de livrare|Metoda de livrare/i.test(await page.locator('body').innerText());
    };
    await addressContinue.click({ force: true });
    await expect.poll(shippingReady, { timeout: 12000 }).toBeTruthy().catch(async () => addressContinue.evaluate(element => element.click()));
    await expect.poll(shippingReady, { timeout: 30000 }).toBeTruthy();
    await expect.poll(async () => await readShippingSummary(page, /^Livrare$/i), { timeout: 15000 }).not.toBeNull();
    const text = await readShippingSummary(page, /^Livrare$/i);
    const price = shippingPriceFromText(text, { currency: /lei|RON/, freePattern: /gratuit|free/i }); expect(price).not.toBeNull(); expect(price === 0).toBe(scenario.free); if (!scenario.free) expect(price).toBe(ro.paid);
  });
}
async function fill(page, n, v) { const f = page.getByRole('textbox', { name: n }).first(); await expect(f).toBeVisible({ timeout: 15000 }); await f.fill(v); }
async function personalField(page, name, value) { const field = page.locator(`input[name="${name}"]`).first(); await expect(field).toBeVisible({ timeout: 20000 }); await field.fill(value); }
async function named(page, n, v) { const f = page.getByRole('textbox', { name: n }).last(); await expect(f).toBeVisible({ timeout: 15000 }); await f.fill(v); }
async function next(page, i) { const bs = page.getByRole('button', { name: /Continuă|Continua/i }); const b = i < 0 ? bs.last() : bs.nth(i); await expect(b).toBeVisible({ timeout: 15000 }); await b.click({ force: true }); }

async function fillAddress(page, pattern, value) {
  const candidates = [page.getByPlaceholder(pattern).last(), page.getByRole('textbox', { name: pattern }).last()];
  for (const field of candidates) {
    if (await field.isVisible().catch(() => false)) { await field.fill(value); return; }
  }
  throw new Error(`Address field not found: ${pattern}`);
}

async function isAddressFormReady(page) {
  return await page.getByPlaceholder(/enter adresa|adresa \( str\. si nr\.\)|adres/i).last().isVisible().catch(() => false);
}

async function continueToAddressStep(page) {
  if (await isAddressFormReady(page)) return;
  const submit = page.locator('button[name="continue"]').first();
  await submit.click().catch(async () => { await submit.click({ force: true }); });
  await expect.poll(() => isAddressFormReady(page), { timeout: 10000 }).toBeTruthy().catch(() => {});
  if (await isAddressFormReady(page)) return;
  await page.goto(new URL('/comanda?id_address=0', ro.base).href, { waitUntil: 'domcontentloaded' });
  for (const target of [page.getByText(/^Adrese$|^Adresă$|^Adresa$/i).first(), page.locator('[role="tab"]').filter({ hasText: /^Adrese$|^Adresă$|^Adresa$/i }).first()]) {
    if (await target.isVisible().catch(() => false)) await target.click({ force: true }).catch(() => {});
    if (await isAddressFormReady(page)) return;
  }
  await expect.poll(() => isAddressFormReady(page), { timeout: 20000 }).toBeTruthy();
}

async function selectCounty(page, label) {
  const selects = page.locator('select');
  for (let i = 0; i < await selects.count(); i += 1) {
    const select = selects.nth(i);
    if (!(await select.isVisible().catch(() => false))) continue;
    const options = await select.locator('option').allTextContents();
    const option = options.find(text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase() === label.toLowerCase());
    if (option) { await select.selectOption({ label: option }); return; }
  }
}

async function dismissCookies(page) {
  const allow = page.getByRole('button', { name: /ALLOW ALL|ACCEPTĂ|ACCEPT/i }).first();
  await allow.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await allow.isVisible().catch(() => false)) await allow.click({ force: true });
}
