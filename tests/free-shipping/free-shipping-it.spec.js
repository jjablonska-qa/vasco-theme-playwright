import { test, expect } from '../helpers/free-shipping-test.js';
import { readShippingSummary, shippingPriceFromText } from '../helpers/shipping-methods.js';

test.setTimeout(120000);

const it = { base: 'https://vasco-electronics.it/', products: '/tutti-i-prodotti/', checkout: '/ordine', q1: '38', glass: '40', threshold: 50, paid: 9 };

for (const scenario of [{ title: 'poniżej progu', product: it.glass, free: false }, { title: 'powyżej progu', product: it.q1, free: true }]) {
  test(`IT: darmowa dostawa ${scenario.title}`, async ({ page }) => {
    await page.goto(new URL(it.products, it.base).href, { waitUntil: 'domcontentloaded' });
    await closeCookies(page);
    const card = page.locator(`article.product-miniature[data-id-product="${scenario.product}"]`);
    await expect(card).toBeVisible({ timeout: 15000 }); await card.scrollIntoViewIfNeeded(); await card.locator('button.add-to-cart').click();
    await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });
    await page.goto(new URL(it.checkout, it.base).href, { waitUntil: 'domcontentloaded' }); await closeCookies(page);
    await fill(page, /^Nome/i, 'Automat'); await fill(page, /^Cognome/i, 'Test'); await fill(page, /E-mail|Email/i, `testcases.web+free-shipping-it-${Date.now().toString(36)}@gmail.com`);
    for (const name of [/Termini di servizio|Termini e condizioni|condizioni/i, /Informativa sulla privacy|Privacy policy|privacy/i]) { const box = page.getByRole('checkbox', { name }).first(); await expect(box).toBeVisible({ timeout: 15000 }); await box.check({ force: true }).catch(() => box.click({ force: true })); }
    await next(page, 0); await expect(page.getByText(/Qual è il tuo indirizzo di fatturazione|Qual è il vostro indirizzo di fatturazione/i).first()).toBeVisible({ timeout: 30000 });
    await named(page, /^Nome/i, 'Automat'); await named(page, /^Cognome/i, 'Test'); await named(page, /^Indirizzo/i, 'Via Roma 12'); await named(page, /CAP|Codice postale/i, '00100'); await named(page, /Città|Citta|Comune/i, 'Roma'); await named(page, /Telefono/i, '3331234567');
    const province = page.locator('select').filter({ has: page.locator('option:has-text("Roma")') }).last();
    await expect(province).toBeVisible({ timeout: 15000 });
    await province.selectOption({ label: 'Roma' });
    await next(page, -1);
    const shippingReady = async () => /Scegli il tuo metodo di spedizione|Se desideri aggiungere un commento/i.test(await page.locator('body').innerText());
    await expect.poll(shippingReady, { timeout: 20000 }).toBeTruthy().catch(async () => { await next(page, -1); await expect.poll(shippingReady, { timeout: 15000 }).toBeTruthy(); });
    if (!scenario.free) {
      const paidMethod = page.getByText(/^9\s*€$/).first();
      await expect(paidMethod).toBeVisible({ timeout: 15000 });
      expect(Number((await paidMethod.innerText()).replace(/[^\d,]/g, '').replace(',', '.'))).toBe(it.paid);
      return;
    }
    await expect.poll(async () => await readShippingSummary(page, /^Spedizione$/i), { timeout: 15000 }).not.toBeNull();
    const shippingText = await readShippingSummary(page, /^Spedizione$/i);
    expect(shippingPriceFromText(shippingText, { currency: /€|EUR/, freePattern: /gratuit|gratis/i }), `IT shipping summary: ${shippingText}`).toBe(0);
  });
}
async function closeCookies(page) { const d = page.locator('#CybotCookiebotDialog'); await d.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}); const b = page.getByRole('button', { name: /allow all|accetta tutto/i }).first(); if (await b.isVisible().catch(() => false)) await b.click({ force: true }); }
async function fill(page, n, v) { const f = page.getByRole('textbox', { name: n }).first(); await expect(f).toBeVisible({ timeout: 15000 }); await f.fill(v); }
async function named(page, n, v) { const f = page.getByRole('textbox', { name: n }).last(); await expect(f).toBeVisible({ timeout: 15000 }); await f.fill(v); }
async function next(page, i) { const bs = page.getByRole('button', { name: /Continua/i }); const b = i < 0 ? bs.last() : bs.nth(i); await expect(b).toBeVisible({ timeout: 15000 }); await b.click({ force: true }); }
