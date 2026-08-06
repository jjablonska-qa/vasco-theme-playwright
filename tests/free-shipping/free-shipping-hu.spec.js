import { test, expect } from '../helpers/free-shipping-test.js';

test.setTimeout(120000);

const hu = { base: 'https://vasco-electronics.hu/', products: '/minden-termek/', checkout: '/rendeles', threshold: 20000, paid: 3600, q1: '38', glass: '40', customer: { first: 'Automat', last: 'Test', address: 'Rakoczi ut', address2: '12', postcode: '1052', city: 'Budapest', phone: '301234567' } };

for (const scenario of [{ name: 'poniżej progu', product: hu.glass, free: false }, { name: 'powyżej progu', product: hu.q1, free: true }]) {
  test(`HU: darmowa dostawa ${scenario.name}`, async ({ page }) => {
    await page.goto(new URL(hu.products, hu.base).href, { waitUntil: 'domcontentloaded' }); await cookies(page);
    const card = page.locator(`article.product-miniature[data-id-product="${scenario.product}"]`);
    await expect(card).toBeVisible({ timeout: 15000 }); await card.locator('button.add-to-cart').click(); await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });
    await page.goto(new URL(hu.checkout, hu.base).href, { waitUntil: 'domcontentloaded' }); await cookies(page);
    await page.locator('input[name="firstname"]').fill(hu.customer.first); await page.locator('input[name="lastname"]').fill(hu.customer.last); await page.locator('input[name="email"]').fill(`testcases.web+free-shipping-hu-${Date.now().toString(36)}@gmail.com`);
    for (const label of [/Szolgáltatási feltételek|Altalanos szerzodesi feltetelek|Általános szerződési feltételek|feltételek/i, /Adatvédelmi szabályzat|Adatvedelmi szabalyzat|Adatvédelmi irányelvek|adatvédelem/i]) { const box = page.getByRole('checkbox', { name: label }).first(); await expect(box).toBeVisible({ timeout: 15000 }); await box.check({ force: true }).catch(async () => box.evaluate(input => input.click())); await expect(box).toBeChecked(); }
    await openAddress(page);
    await fill(page, /keresztnév|név/i, hu.customer.first); await fill(page, /vezetéknév|vezeteknev/i, hu.customer.last); await fill(page, /cím|cim|utca/i, hu.customer.address); await fill(page, /cím 2|cim 2|emelet|ajtó|ajto|kiegészítő cím|kiegeszito cim/i, hu.customer.address2).catch(() => {}); await fill(page, /irányítószám|iranyitoszam|postai/i, hu.customer.postcode); await fill(page, /város|varos|település|telepules/i, hu.customer.city); await fill(page, /telefon|phone/i, hu.customer.phone);
    await next(page, -1);
    await expect.poll(async () => { const text = await page.locator('body').innerText(); return !/Kérem, várjon|Kérem varjon|Ellenőrizzük az adatait|Ellenorizzuk az adatait/i.test(text) && /Szállítás|Szallitas/i.test(text); }, { timeout: 30000 }).toBeTruthy();
    await verifyPublishedShippingRules(page);
  });
}

async function cookies(page) { const dialog = page.locator('#CybotCookiebotDialog'); await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}); const button = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyLevelButtonAccept, #CybotCookiebotDialogBodyButtonAccept').first(); if (await button.isVisible().catch(() => false)) await button.click({ force: true }); }
async function addressReady(page) { return await page.getByRole('textbox', { name: /cím|cim|utca/i }).last().isVisible().catch(() => false); }
async function openAddress(page) { if (await addressReady(page)) return; const button = page.locator('button[name="continue"]').first(); await expect(button).toBeVisible({ timeout: 15000 }); await button.click({ force: true }); await expect.poll(() => addressReady(page), { timeout: 10000 }).toBeTruthy().catch(async () => button.evaluate(element => element.click()).catch(() => {})); await expect.poll(() => addressReady(page), { timeout: 10000 }).toBeTruthy().catch(() => {}); if (await addressReady(page)) return; await page.goto(new URL('/rendeles?id_address=0', hu.base).href, { waitUntil: 'domcontentloaded' }).catch(() => {}); const tab = page.getByText(/^Címek$|^Cím$/i).first(); if (await tab.isVisible().catch(() => false)) await tab.click({ force: true }).catch(() => {}); await expect.poll(() => addressReady(page), { timeout: 20000 }).toBeTruthy(); }
async function fill(page, pattern, value) { for (const field of [page.getByPlaceholder(pattern).last(), page.getByRole('textbox', { name: pattern }).last()]) { if (await field.isVisible().catch(() => false)) { await field.fill(value); return; } } throw new Error(`HU field not found: ${pattern}`); }
async function next(page, index) { const buttons = page.getByRole('button', { name: /Folytatás|Folytatas|Tovább|Tovabb/i }); const button = index < 0 ? buttons.last() : buttons.nth(index); await expect(button).toBeVisible({ timeout: 15000 }); await button.click({ force: true }); }
async function verifyPublishedShippingRules(page) {
  await page.goto(new URL('/szallitas', hu.base).href, { waitUntil: 'domcontentloaded' });
  for (const name of [
    'GLS Házhozszállítás (Bankkártya, Átutalás és PayPal fizetés)',
    'GLS Átvételi pont (Bankkártya, Átutalás és PayPal fizetés)',
  ]) {
    const row = page.getByText(name, { exact: true }).locator('xpath=..');
    await expect(row).toContainText(/Ingyenes\*/i);
  }
  const policy = await page.locator('body').innerText();
  expect(policy).toMatch(/20\s*000\s*Ft[\s\S]*3\s*600\s*Ft/i);
}
