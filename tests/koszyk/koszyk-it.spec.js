import { test, expect } from '@playwright/test';

test.setTimeout(90000);

const BASE_URL = 'https://vasco-electronics.it/';
const ALL_PRODUCTS_PATH = '/tutti-i-prodotti/';
const CART_PATH = '/carrello?action=show';
const PRODUCT_Q1 = { id: '38' };
const PRODUCT_GLASS = { id: '40' };

test('Koszyk IT zachowuje dodane produkty po przejsciu do koszyka', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await dismissCookieBanner(page);
  await closeBlockingPopups(page);
  await openAllProducts(page);

  await addProductToCart(page, PRODUCT_Q1, 1);
  await addProductToCart(page, PRODUCT_GLASS, 2);

  await expectCartCount(page, 2);
  await openCart(page);

  await expect(page).toHaveURL(/\/carrello/i);
  await expect(page.locator('[id^="name-38-"]').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[id^="name-40-"]').first()).toBeVisible({ timeout: 15000 });
});

function headerCartLink(page) {
  return page.locator(`#header a[href*="${CART_PATH}"]`).first();
}

function cartDialog(page) {
  return page.locator('#blockcart-modal, [role="dialog"][aria-labelledby="blockcart-modal-title"]').first();
}

async function dismissCookieBanner(page) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (!(await dialog.isVisible().catch(() => false))) return;

  for (const selector of [
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyLevelButtonAccept',
    '#CybotCookiebotDialogBodyButtonAccept',
    '#CybotCookiebotDialogBodyLevelButtonCustomize',
  ]) {
    const button = page.locator(selector);
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(async () => {
        await button.evaluate(element => element.click()).catch(() => {});
      });
      break;
    }
  }

  for (const selector of [
    '#CybotCookiebotDialogBodyButtonAccept',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonDecline',
  ]) {
    const button = page.locator(selector);
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(async () => {
        await button.evaluate(element => element.click()).catch(() => {});
      });
      break;
    }
  }

  await expect(dialog).toBeHidden({ timeout: 15000 }).catch(() => {});
}

async function openAllProducts(page) {
  await closeBlockingPopups(page);

  const desktopMenuLink = page.locator(`#desktop-nav a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const mainMenuLink = page.getByRole('link', { name: /Tutti i prodotti/i }).first();
  const visibleAllProductsLink = page.locator(`a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const shopMenuItem = page.getByRole('menuitem', { name: /negozio|traduttori|prodotti/i }).first();

  if (await desktopMenuLink.isVisible().catch(() => false)) {
    await clickAndWaitForUrl(page, desktopMenuLink, /\/tutti-i-prodotti\/?$/i);
  } else {
    if (await shopMenuItem.isVisible().catch(() => false)) {
      await shopMenuItem.hover().catch(() => {});
      await shopMenuItem.click().catch(() => {});
      await closeBlockingPopups(page);
    }

    if (await mainMenuLink.isVisible().catch(() => false)) {
      await clickAndWaitForUrl(page, mainMenuLink, /\/tutti-i-prodotti\/?$/i);
    }

    if (!/\/tutti-i-prodotti\/?$/i.test(page.url()) && (await visibleAllProductsLink.isVisible().catch(() => false))) {
      await clickAndWaitForUrl(page, visibleAllProductsLink, /\/tutti-i-prodotti\/?$/i);
    }

    if (!/\/tutti-i-prodotti\/?$/i.test(page.url())) {
      await Promise.all([
        page.waitForURL(/\/tutti-i-prodotti\/?$/i, { timeout: 15000 }),
        page
          .evaluate(() => {
            const target = Array.from(document.querySelectorAll('a')).find(link => {
              const href = link.getAttribute('href') || '';
              const rect = link.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0;
              return href.includes('/tutti-i-prodotti/') && visible;
            });

            if (target) target.click();
          })
          .catch(() => {}),
      ]).catch(() => {});
    }
  }

  if (!/\/tutti-i-prodotti\/?$/i.test(page.url())) {
    await page.goto(new URL(ALL_PRODUCTS_PATH, BASE_URL).href, { waitUntil: 'domcontentloaded' });
  }

  await expect(page).toHaveURL(/\/tutti-i-prodotti\/?$/i);
  await closeMenuOverlay(page);
}

async function clickAndWaitForUrl(page, link, urlPattern) {
  try {
    await Promise.all([
      page.waitForURL(urlPattern, { timeout: 15000 }),
      link.click({ force: true }),
    ]);
    return true;
  } catch {
    return urlPattern.test(page.url());
  }
}

async function addProductToCart(page, product, expectedCartCount) {
  const productCard = page.locator(`article.product-miniature[data-id-product="${product.id}"]`);
  await closeBlockingPopups(page);
  await closeCartDialog(page);
  await closeMenuOverlay(page);
  await expect(productCard).toBeVisible({ timeout: 15000 });
  await productCard.scrollIntoViewIfNeeded();
  await productCard.locator('button.add-to-cart').click();
  await expectCartCount(page, expectedCartCount);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (expectedCartCount < 2) {
    await closeBlockingPopups(page);
    await closeCartDialog(page);
    await closeMenuOverlay(page);
  }
}

async function openCart(page) {
  await closeMenuOverlay(page);
  const blockCartDialog = cartDialog(page);

  if (await blockCartDialog.isVisible().catch(() => false)) {
    const goToCartLink = blockCartDialog.locator(`a[href*="${CART_PATH}"]`).first();
    if (await goToCartLink.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForURL(/\/carrello/i, { timeout: 15000 }),
        goToCartLink.click({ force: true }),
      ]).catch(() => {});
    }
  }

  if (/\/carrello/i.test(page.url())) return;

  const cartLink = headerCartLink(page);
  await expect(cartLink).toBeVisible({ timeout: 15000 });
  await cartLink.click({ force: true });
  await page.waitForTimeout(1000);

  if (/\/carrello/i.test(page.url())) return;

  await cartLink.evaluate(element => element.click()).catch(() => {});
  await page.waitForTimeout(1000);

  if (/\/carrello/i.test(page.url())) return;

  const goToCartLink = page.locator(`a[href*="${CART_PATH}"]`).first();
  if (await goToCartLink.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForURL(/\/carrello/i, { timeout: 15000 }),
      goToCartLink.click({ force: true }),
    ]).catch(() => {});
  }

  if (!/\/carrello/i.test(page.url())) {
    await page.goto(new URL('/carrello', BASE_URL).href, { waitUntil: 'domcontentloaded' });
  }
}

async function expectCartCount(page, expectedCartCount) {
  const cartLinkByName = page.getByRole('link', { name: new RegExp(`Carrello\\s*${expectedCartCount}`, 'i') }).first();
  if (await cartLinkByName.isVisible().catch(() => false)) {
    await expect(cartLinkByName).toBeVisible({ timeout: 15000 });
    return;
  }
  await expect(headerCartLink(page)).toContainText(String(expectedCartCount), { timeout: 15000 });
}

async function closeCartDialog(page) {
  const blockCartDialog = cartDialog(page);
  if (!(await blockCartDialog.isVisible().catch(() => false))) return;

  const closeButton = blockCartDialog.getByRole('button', { name: /Chiudi|Close/i }).first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true }).catch(async () => {
      await closeButton.press('Enter').catch(() => {});
    });
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }

  if (await blockCartDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
  }

  await expect(blockCartDialog).toBeHidden({ timeout: 15000 }).catch(() => {});
}

async function closeMenuOverlay(page) {
  const overlayMenu = page.locator('#overlay-menu');
  if (!(await overlayMenu.isVisible().catch(() => false))) return;
  await page.keyboard.press('Escape').catch(() => {});
  if (await overlayMenu.isVisible().catch(() => false)) {
    await page.locator('body').click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
  }
  await expect(overlayMenu).toBeHidden({ timeout: 5000 }).catch(() => {});
}

async function closeBlockingPopups(page) {
  const popupCloseButtons = [
    page.locator('#newsletter_popup .close, #newsletter_popup button[aria-label="Close"]').first(),
    page.locator('.modal-dialog .btn-close, .modal-dialog button[aria-label="Close"]').first(),
    page.locator('.popup-close, .close-popup, .close-newsletter').first(),
    page.locator('button[aria-label="Chiudi"], button[aria-label="Close"]').first(),
    page.locator('.callback-popup .popup-close').first(),
  ];

  for (const button of popupCloseButtons) {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(() => {});
    }
  }

  await closeCartDialog(page);
  await closeMenuOverlay(page);
}
