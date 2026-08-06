import { test, expect } from '@playwright/test';

test.setTimeout(90000);

const BASE_URL = 'https://vasco-translator.be/fr/';
const ALL_PRODUCTS_PATH = '/fr/tous-les-produits/';
const CART_PATH = '/fr/panier?action=show';
const PRODUCT_Q1 = { id: '38' };
const PRODUCT_GLASS = { id: '40' };

test('Koszyk BE FR zachowuje dodane produkty po przejsciu do koszyka', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await dismissCookieBanner(page);
  await closeBlockingPopups(page);
  await openAllProducts(page);

  await addProductToCart(page, PRODUCT_Q1, 1);
  await addProductToCart(page, PRODUCT_GLASS, 2);

  await expectCartCount(page, 2);
  await openCart(page);

  await expect(page).toHaveURL(/\/fr\/panier/i);
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
  const mainMenuLink = page.getByRole('link', { name: /Tous les produits/i }).first();
  const visibleAllProductsLink = page.locator(`a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const shopMenuItem = page.getByRole('menuitem', { name: /boutique|traducteurs|produits/i }).first();

  if (await desktopMenuLink.isVisible().catch(() => false)) {
    await clickAndWaitForUrl(page, desktopMenuLink, /\/fr\/tous-les-produits\/?$/i);
  } else {
    if (await shopMenuItem.isVisible().catch(() => false)) {
      await shopMenuItem.hover().catch(() => {});
      await shopMenuItem.click().catch(() => {});
      await closeBlockingPopups(page);
    }

    if (await mainMenuLink.isVisible().catch(() => false)) {
      await clickAndWaitForUrl(page, mainMenuLink, /\/fr\/tous-les-produits\/?$/i);
    }

    if (!/\/fr\/tous-les-produits\/?$/i.test(page.url()) && (await visibleAllProductsLink.isVisible().catch(() => false))) {
      await clickAndWaitForUrl(page, visibleAllProductsLink, /\/fr\/tous-les-produits\/?$/i);
    }
  }

  if (!/\/fr\/tous-les-produits\/?$/i.test(page.url())) {
    await page.goto(new URL(ALL_PRODUCTS_PATH, 'https://vasco-translator.be').href, { waitUntil: 'domcontentloaded' });
  }

  await expect(page).toHaveURL(/\/fr\/tous-les-produits\/?$/i);
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
    const goToCartLink = blockCartDialog.getByRole('link', { name: /Aller au panier/i }).first();
    if (await goToCartLink.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForURL(/\/fr\/panier/i, { timeout: 15000 }),
        goToCartLink.click({ force: true }),
      ]).catch(() => {});
    }
  }

  if (/\/fr\/panier/i.test(page.url())) return;

  const cartLink = headerCartLink(page);
  await expect(cartLink).toBeVisible({ timeout: 15000 });
  await cartLink.click({ force: true });
  await page.waitForTimeout(1000);

  if (/\/fr\/panier/i.test(page.url())) return;

  await cartLink.evaluate(element => element.click()).catch(() => {});
  await page.waitForTimeout(1000);

  if (/\/fr\/panier/i.test(page.url())) return;

  const goToCartLink = page.getByRole('link', { name: /Aller au panier/i }).first();
  if (await goToCartLink.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForURL(/\/fr\/panier/i, { timeout: 15000 }),
      goToCartLink.click({ force: true }),
    ]).catch(() => {});
  }

  if (!/\/fr\/panier/i.test(page.url())) {
    await page.goto(new URL('/fr/panier', 'https://vasco-translator.be').href, { waitUntil: 'domcontentloaded' });
  }
}

async function expectCartCount(page, expectedCartCount) {
  const cartLinkByName = page.getByRole('link', { name: new RegExp(`Panier\\s*${expectedCartCount}`, 'i') }).first();
  if (await cartLinkByName.isVisible().catch(() => false)) {
    await expect(cartLinkByName).toBeVisible({ timeout: 15000 });
    return;
  }
  await expect(headerCartLink(page)).toContainText(String(expectedCartCount), { timeout: 15000 });
}

async function closeCartDialog(page) {
  const blockCartDialog = cartDialog(page);
  if (!(await blockCartDialog.isVisible().catch(() => false))) return;

  const closeButton = blockCartDialog.getByRole('button', { name: /Fermer|Close/i }).first();
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
    page.locator('button[aria-label="Fermer"], button[aria-label="Close"]').first(),
  ];

  for (const button of popupCloseButtons) {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(() => {});
    }
  }

  await closeCartDialog(page);
  await closeMenuOverlay(page);
}
