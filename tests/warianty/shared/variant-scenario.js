import { expect } from '@playwright/test';

const CATEGORIES = [
  { key: 'translator', ids: ['38', '14', '62'], source: 'listing' },
  { key: 'case', ids: ['64', '63'], source: 'listing' },
  { key: 'socks', ids: ['56'], source: 'listing', needsSize: true },
  { key: 'bundle', ids: ['43', '31'], source: 'product-page' },
];

export async function runVariantScenario(page, market) {
  const selected = [];
  const skipped = [];
  await goto(page, new URL(market.allProductsPath, market.baseUrl));
  await dismissCookies(page);
  await dismissPrivacyConsent(page);
  await clearBlockingOverlays(page);

  for (const category of CATEGORIES.filter(({ source }) => source === 'listing')) {
    const result = await addFromListing(page, category);
    (result ? selected : skipped).push(result || category.key);
  }
  const productPageCategory = CATEGORIES.find(({ source }) => source === 'product-page');
  const productPageResult = await addFromProductPage(page, market, productPageCategory);
  (productPageResult ? selected : skipped).push(productPageResult || productPageCategory.key);

  await goto(page, new URL(market.cartPath, market.baseUrl));
  await assertCartVariants(page, selected);
  if (skipped.length) console.warn(`[${market.code}] Skipped: ${skipped.join(', ')} — products are out of stock or have no alternative available variant.`);
  return { selected, skipped };
}

async function addFromListing(page, category) {
  for (const id of category.ids) {
    let card = page.locator(`article.product-miniature[data-id-product="${id}"]`).first();
    await clearBlockingOverlays(page);
    if (!(await card.isVisible().catch(() => false))) continue;
    const colour = await selectNextColour(card);
    if (!colour) continue;
    await page.waitForTimeout(1200);
    const size = category.needsSize ? await selectNextSize(card) : null;
    if (category.needsSize && !size) continue;
    const productName = await visibleProductName(card);
    if (!productName || !(await addToCart(page, card))) continue;
    await clearBlockingOverlays(page, { waitForCartModal: true });
    return { category: category.key, productName, colour: colour.title, size: size?.title || null };
  }
  return null;
}

async function addFromProductPage(page, market, category) {
  for (const id of category.ids) {
    await goto(page, new URL(market.allProductsPath, market.baseUrl));
    await clearBlockingOverlays(page);
    const card = page.locator(`article.product-miniature[data-id-product="${id}"]`).first();
    if (!(await card.isVisible().catch(() => false))) continue;
    const href = await card.locator('a.product-link').first().getAttribute('href');
    if (!href) continue;
    await goto(page, href);
    await clearBlockingOverlays(page);
    const productForm = page.locator('#add-to-cart-or-refresh').first();
    const colour = await selectNextColour(productForm);
    if (!colour) continue;
    if (colour.href) await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);
    const productName = await visibleProductName(page.locator('body'));
    const button = page.locator('button.add-to-cart:not([disabled])').first();
    if (!productName || !(await button.isVisible().catch(() => false))) continue;
    await button.click({ force: true });
    await page.waitForTimeout(1000);
    await clearBlockingOverlays(page, { waitForCartModal: true });
    return { category: category.key, productName, colour: colour.title, size: null };
  }
  return null;
}

async function selectNextColour(container) {
  return selectNextVariant(container, 'input[data-analytics-type="colour"]');
}

async function selectNextSize(container) {
  // The shop currently marks sizes on socks as analytics type "other", not "size".
  return selectNextVariant(container, 'input[data-analytics-type="other"]');
}

async function selectNextVariant(container, selector) {
  const inputs = container.locator(selector);
  const count = await inputs.count();
  if (count < 2) return null;
  const variants = [];
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    const data = await input.evaluate(element => {
      const labelElement = element.closest('label');
      return {
      title: element.getAttribute('title') || '', checked: element.checked,
      active: labelElement?.getAttribute('data-active') === '1',
      unavailable: element.disabled || labelElement?.getAttribute('data-has-quantity') === '0' || /disabled|out-of-stock|unavailable/i.test(labelElement?.className || ''),
      };
    }).catch(() => null);
    if (data) variants.push({ index, ...data });
  }
  const active = variants.find(({ checked, active }) => checked || active)?.index ?? 0;
  const ordered = [...variants.filter(({ index }) => index > active), ...variants.filter(({ index }) => index <= active)];
  const target = ordered.find(({ index, unavailable }) => index !== active && !unavailable);
  if (!target) return null;
  const targetInput = inputs.nth(target.index);
  const type = await targetInput.getAttribute('type');

  if (type === 'button') {
    const link = targetInput.locator('xpath=ancestor::a[1]');
    const href = await link.getAttribute('href');
    if (!href) return null;
    await link.click();
    return { title: target.title, productId: await targetInput.getAttribute('data-product-id'), href };
  }

  const visibleControl = targetInput.locator('xpath=ancestor::label[1]');
  await visibleControl.scrollIntoViewIfNeeded();
  await visibleControl.click();
  await expect.poll(() => targetInput.isChecked(), { timeout: 10000 }).toBeTruthy();
  return { title: target.title, productId: await targetInput.getAttribute('data-product-id') };
}

async function addToCart(page, card) {
  const button = card.locator('button.add-to-cart:not([disabled])').first();
  if (!(await button.isVisible().catch(() => false))) return false;
  await button.click();
  // The header badge on the listing is refreshed asynchronously and can lag by
  // one product. The authoritative assertion is made for every selected item
  // on the cart page at the end of the scenario.
  await page.waitForTimeout(1000);
  return true;
}

async function visibleProductName(container) {
  return ((await container.locator('.product-title, h1').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
}

async function assertCartVariants(page, selected) {
  for (const item of selected) {
    const line = page.locator('.cart-item, article, li').filter({ hasText: item.productName }).filter({ hasText: item.colour }).first();
    await expect.soft(line, `${item.category}: product and selected colour in cart`).toBeVisible({ timeout: 20000 });
    if (item.size) await expect.soft(line, `${item.category}: selected size in cart`).toContainText(item.size);
  }
}

async function dismissCookies(page) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (!(await dialog.isVisible().catch(() => false))) return;

  const button = page.locator(
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll,' +
    '#CybotCookiebotDialogBodyLevelButtonAccept,' +
    '#CybotCookiebotDialogBodyButtonAccept'
  ).first();
  await expect(button).toBeVisible({ timeout: 10000 });
  await button.click({ force: true }).catch(async () => button.evaluate(element => element.click()));
  await expect(dialog).toBeHidden({ timeout: 15000 });
  // Cookiebot can leave its full-screen underlay after consent, blocking normal
  // user clicks on product variants although the dialog itself is hidden.
  await page.locator('#CybotCookiebotDialogBodyUnderlay').evaluate(element => element.remove()).catch(() => {});
}

async function dismissPrivacyConsent(page) {
  const consentButtons = [
    page.getByRole('button', { name: /zgadzam się|zgadzam sie|i agree|agree/i }).first(),
    page.locator('button').filter({ hasText: /zgadzam się|zgadzam sie|i agree|agree/i }).first(),
  ];

  for (const button of consentButtons) {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(async () => button.evaluate(element => element.click()).catch(() => {}));
      await page.waitForTimeout(300);
      return;
    }
  }
}

async function clearBlockingOverlays(page, { waitForCartModal = false } = {}) {
  await dismissPrivacyConsent(page);
  const cartModal = page.locator('#blockcart-modal,.cart-drawer,[role="dialog"][aria-labelledby="blockcart-modal-title"]').first();
  if (waitForCartModal) await cartModal.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});

  for (let attempt = 0; attempt < 1; attempt += 1) {
  const closeButtons = [
    page.locator('#blockcart-modal button.close, #blockcart-modal [aria-label="Close"]').first(),
    page.locator('.cart-drawer button.close-modal, .cart-drawer [data-dismiss="modal"]').first(),
      page.locator('#newsletter_popup .close, #newsletter_popup [aria-label="Close"]').first(),
      page.locator('.newsletter-popup .close, .popup-close, .close-popup, .close-newsletter').first(),
    ];

    let closedSomething = false;
    for (const button of closeButtons) {
      if (await button.isVisible().catch(() => false)) {
        await button.click({ force: true }).catch(async () => button.evaluate(element => element.click()).catch(() => {}));
        closedSomething = true;
      }
    }

    if (await cartModal.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => {});
      closedSomething = true;
    }
    if (!closedSomething) break;
    await page.waitForTimeout(300);
  }

}
async function goto(page, url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url.href || url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return;
    } catch (error) {
      lastError = error;
      if (page.isClosed()) throw error;
      await page.waitForTimeout(1000 * attempt);
    }
  }
  throw lastError;
}
