import { test, expect } from '../helpers/free-shipping-test.js';

test.setTimeout(120000);

const sk = {
  base: 'https://vasco-electronics.sk/',
  products: '/vsetky-produkty/',
  checkout: '/objednavka',
  paid: 9,
  q1: '38',
  glass: '40',
};

for (const scenario of [
  { name: 'poniżej progu', product: sk.glass, free: false },
  { name: 'powyżej progu', product: sk.q1, free: true },
]) {
  test(`SK: darmowa dostawa ${scenario.name}`, async ({ page }) => {
    await page.goto(new URL(sk.products, sk.base).href, { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);
    await addProduct(page, scenario.product);

    await page.goto(new URL(sk.checkout, sk.base).href, { waitUntil: 'domcontentloaded' });
    await acceptCookies(page);
    await fillPersonalData(page);
    await openAddress(page);
    await fillAddress(page);
    await goToShipping(page);

    const prices = await readPrices(page);
    expect(prices.length).toBeGreaterThan(0);
    if (scenario.free) expect(prices).toContain(0);
    else expect(prices).toContain(sk.paid);
  });
}

async function addProduct(page, productId) {
  const card = page.locator(`article.product-miniature[data-id-product="${productId}"]`);
  await expect(card).toBeVisible({ timeout: 15000 });

  const add = card.locator('button.add-to-cart');
  await add.click({ force: true });
  await expect.poll(async () => Number((await page.locator('#header .cart-count').first().innerText()).trim()), { timeout: 5000 })
    .toBe(1)
    .catch(async () => add.evaluate(element => element.click()));
  await expect(page.locator('#header .cart-count').first()).toHaveText('1', { timeout: 15000 });
}

async function fillPersonalData(page) {
  await page.locator('input[name="firstname"]').fill('Automat');
  await page.locator('input[name="lastname"]').fill('Test');
  await page.locator('input[name="email"]').fill(`testcases.web+free-shipping-sk-${Date.now().toString(36)}@gmail.com`);

  for (const name of [
    /zmluvnými podmienkami|zmluvnymi podmienkami|Obchodné podmienky|Obchodne podmienky/i,
    /Zásady ochrany osobných údajov|Zasady ochrany osobnych udajov/i,
  ]) {
    const checkbox = page.getByRole('checkbox', { name }).first();
    await expect(checkbox).toBeVisible({ timeout: 15000 });
    await checkbox.check({ force: true }).catch(async () => checkbox.evaluate(element => element.click()));
  }
}

async function openAddress(page) {
  const addressReady = async () => page
    .getByPlaceholder(/ulica|názov ulice|nazov ulice|ulica a číslo domu|ulica a cislo domu/i)
    .first()
    .isVisible()
    .catch(() => false);
  const continueButton = page.getByRole('button', { name: /Pokračovať|Pokracovat/i });
  const personalContinue = page.locator('button[name="continue"][data-link-action="register-new-customer"]').first();

  await personalContinue.click({ force: true }).catch(async () => continueButton.first().click({ force: true }));
  await expect.poll(addressReady, { timeout: 10000 })
    .toBeTruthy()
    .catch(async () => personalContinue.evaluate(element => element.click()).catch(() => {}));
  await expect.poll(addressReady, { timeout: 20000 }).toBeTruthy();
}

async function fillAddress(page) {
  await fillLastNamed(page, /Krstné meno|Krstne meno/i, 'Automat');
  await fillLastNamed(page, /Priezvisko/i, 'Test');
  await fillLastNamed(page, /Ulica/i, 'Námestie SNP 12');
  await fillLastNamed(page, /Číslo domu|Cislo domu/i, '12');
  await fillLastNamed(page, /PSČ|PSC|poštové|smerovacie/i, '811 06');
  await fillLastNamed(page, /Mesto|Město|Obec/i, 'Bratislava');
  await fillLastNamed(page, /Telefón|Telefon/i, '0903123456');
}

async function goToShipping(page) {
  const continueButton = page.getByRole('button', { name: /Pokračovať|Pokracovat/i }).last();
  await continueButton.click({ force: true });
  await expect.poll(async () => await page.getByRole('radio').count(), { timeout: 30000 }).toBeGreaterThan(0);
}

async function fillLastNamed(page, name, value) {
  const field = page.getByRole('textbox', { name }).last();
  await expect(field).toBeVisible({ timeout: 15000 });
  await field.fill(value);
}

async function readPrices(page) {
  const texts = await page.locator('p').allTextContents();
  const deliveryIndex = texts.findIndex(text => /^Doručenie\s*$/i.test(text.trim()));
  if (deliveryIndex === -1) return [];
  const text = texts[deliveryIndex + 1]?.trim() || '';
  if (/zadarmo|gratis|free/i.test(text)) return [0];
  const match = text.match(/(?:€|EUR)\s*([\d.,]+)|([\d.,]+)\s*(?:€|EUR)/i);
  return match ? [Number((match[1] || match[2]).replace(',', '.'))] : [];
}

async function acceptCookies(page) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const button = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll,#CybotCookiebotDialogBodyLevelButtonAccept').first();
  if (await button.isVisible().catch(() => false)) await button.click({ force: true });
}
