import { test, expect } from '../helpers/free-shipping-test.js';
import { readShippingSummary, shippingPriceFromText } from '../helpers/shipping-methods.js';

test.setTimeout(90000);

const market = {
  baseUrl: 'https://vasco-translator.hr/', checkoutPath: '/narudzba',
  threshold: 50, paidBelow: 9, products: { q1: '/prevoditelji/vasco-translator-q1', glass: '/dodatna-oprema/kaljeno-staklo-q1' },
  customer: { firstName: 'Automat', lastName: 'Test', email: 'testcases.web+free-shipping-hr@gmail.com', address: 'Ilica 1', postcode: '10000', city: 'Zagreb', phone: '0912345678', country: 'Hrvatska' },
};

for (const scenario of [
  { name: 'poniżej progu', product: market.products.glass, free: false, paid: market.paidBelow },
  { name: 'powyżej progu', product: market.products.q1, free: true },
]) test(`HR: darmowa dostawa ${scenario.name}`, async ({ page }) => {
  await page.goto(new URL(scenario.product, market.baseUrl).href, { waitUntil: 'domcontentloaded' }); await cookies(page);
  const add = page.locator('button.add-to-cart:not([disabled])').first(); await expect(add).toBeVisible({ timeout: 15000 }); await add.click({ force: true }); await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });
  await page.goto(new URL(market.checkoutPath, market.baseUrl).href, { waitUntil: 'domcontentloaded' }); await cookies(page);
  await expect(page.getByText(/Osobni podaci|Osobne informacije/i).first()).toBeVisible({ timeout: 20000 });
  await fill(page, /^Ime/i, market.customer.firstName); await fill(page, /^Prezime/i, market.customer.lastName); await fill(page, /E-mail|Email/i, `${market.customer.email.split('@')[0]}-${Date.now().toString(36)}@gmail.com`);
  for (const name of [/Uvjete pružanja usluge|Uvjeti/i, /Pravila o privatnosti|Pravila privatnosti|Politika privatnosti/i]) { const box = page.getByRole('checkbox', { name }).first(); await expect(box).toBeVisible({ timeout: 15000 }); await box.check({ force: true }).catch(async () => { await box.evaluate(element => element.click()); }); await expect(box).toBeChecked(); }
  const personalContinue = page.locator('button[name="continue"][data-link-action="register-new-customer"]').first();
  const addressReady = async () => page.getByText(/Koja je vaša adresa|Adresa za naplatu/i).first().isVisible().catch(() => false);
  if (await personalContinue.isVisible().catch(() => false)) await personalContinue.click({ force: true }); else await click(page, 0);
  await expect.poll(addressReady, { timeout: 12000 }).toBeTruthy().catch(async () => personalContinue.evaluate(element => element.click()).catch(async () => click(page, 0)));
  await expect.poll(addressReady, { timeout: 30000 }).toBeTruthy();
  const select = page.locator('select').filter({ has: page.locator('option:has-text("Hrvatska")') }).first();
  if (await select.isVisible().catch(() => false)) {
    const selected = await select.locator('option:checked').textContent();
    if (!/Hrvatska/i.test(selected || '')) await select.selectOption({ label: market.country });
  }
  await lastNamed(page, /^Ime/i, market.customer.firstName); await lastNamed(page, /^Prezime/i, market.customer.lastName); await lastNamed(page, /^Adresa/i, market.customer.address); await lastNamed(page, /^Poštanski broj/i, market.customer.postcode); await lastNamed(page, /^Grad/i, market.customer.city); await lastNamed(page, /Telefon/i, market.customer.phone); await click(page, -1);
  await expect.poll(async () => /Odaberite.*dostav|Način dostave/i.test(await page.locator('body').innerText()), { timeout: 30000 }).toBeTruthy();
  const shipping = await readShippingSummary(page, /^Dostava$/i); expect(shipping, 'HR shipping summary').not.toBeNull(); const price = shippingPriceFromText(shipping, { currency: /€|EUR/, freePattern: /besplat/i }); expect(price).not.toBeNull(); expect(price === 0).toBe(scenario.free); if (!scenario.free) expect(price).toBe(scenario.paid);
});

async function fill(page, n, v) { const field = page.getByRole('textbox', { name: n }).first(); await expect(field).toBeVisible({ timeout: 15000 }); await field.fill(v); }
async function last(page, n, v) { const fields = page.locator('input[placeholder], textarea[placeholder]'); for (let i = (await fields.count()) - 1; i >= 0; i -= 1) { const f = fields.nth(i); if (n.test((await f.getAttribute('placeholder').catch(() => '')) || '') && await f.isVisible().catch(() => false)) { await f.fill(v); return; } } throw new Error(`HR field ${n} not found`); }
async function lastNamed(page, n, v) { const fs = page.getByRole('textbox', { name: n }); const f = fs.last(); await expect(f).toBeVisible({ timeout: 15000 }); await f.fill(v); }
async function click(page, i) { const buttons = page.getByRole('button', { name: /Nastavi|Nastavite/i }); const b = i < 0 ? buttons.last() : buttons.nth(i); await expect(b).toBeVisible({ timeout: 15000 }); await b.click({ force: true }); }
async function cookies(page) { const dialog = page.locator('#CybotCookiebotDialog'); await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}); if (!(await dialog.isVisible().catch(() => false))) return; const button = page.getByRole('button', { name: /allow all|prihvati sve/i }).first(); if (await button.isVisible().catch(() => false)) await button.evaluate(el => el.click()).catch(() => button.click({ force: true })); await expect(dialog).toBeHidden({ timeout: 10000 }).catch(async () => { if (await dialog.isVisible().catch(() => false)) await dialog.evaluate(el => el.remove()); }); }
