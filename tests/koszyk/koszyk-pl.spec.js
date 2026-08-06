import { test, expect } from '@playwright/test';

test.setTimeout(90000);

const BASE_URL = 'https://vasco-electronics.pl/';
const CART_PATH = '/koszyk?action=show';
const PRODUCT_Q1 = {
  id: '38',
};
const PRODUCT_GLASS = {
  id: '40',
};

test('Koszyk PL zachowuje dodane produkty po przejsciu do koszyka', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await dismissCookieBanner(page);
  await closeBlockingPopups(page);
  await openAllProducts(page);

  await addProductToCart(page, PRODUCT_Q1, 1);
  await addProductToCart(page, PRODUCT_GLASS, 2);

  await expectCartCount(page, 2);

  await openCart(page);

  await expect(page).toHaveURL(/\/koszyk/i);
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

  if (!(await dialog.isVisible().catch(() => false))) {
    return;
  }

  const primaryButtons = [
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyLevelButtonAccept',
    '#CybotCookiebotDialogBodyButtonAccept',
    '#CybotCookiebotDialogBodyLevelButtonCustomize',
  ];

  for (const selector of primaryButtons) {
    const button = page.locator(selector);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      break;
    }
  }

  const secondaryButtons = [
    '#CybotCookiebotDialogBodyButtonAccept',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonDecline',
  ];

  for (const selector of secondaryButtons) {
    const button = page.locator(selector);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      break;
    }
  }

  await expect(dialog).toBeHidden({ timeout: 15000 });
}

async function openAllProducts(page) {
  await closeBlockingPopups(page);
  const shopMenuItem = page.getByRole('menuitem', { name: /sklep/i }).first();
  await shopMenuItem.hover().catch(() => {});
  await shopMenuItem.click();
  await closeBlockingPopups(page);

  const desktopMenuLink = page.locator('#desktop-nav').getByRole('link', { name: /^Wszystkie produkty$/i }).first();
  const categoryNavLink = page.locator('main nav').getByRole('link', { name: /^Wszystkie produkty$/i }).first();
  const fallbackAllProductsLink = page
    .locator('a[href*="/wszystkie/"]')
    .filter({ hasText: /^Wszystkie produkty$/i })
    .first();

  if (await desktopMenuLink.isVisible().catch(() => false)) {
    await clickAndWaitForUrl(page, desktopMenuLink, /\/wszystkie\/?$/i);
  } else {
    await closeShopMenu(page, /sklep/i);
    await closeMenuOverlay(page);
    await expect(categoryNavLink).toBeVisible({ timeout: 15000 });
    const reachedAllProducts = await clickAndWaitForUrl(page, categoryNavLink, /\/wszystkie\/?$/i);

    if (!reachedAllProducts) {
      await closeShopMenu(page, /sklep/i);
      await closeMenuOverlay(page);
      if (await fallbackAllProductsLink.isVisible().catch(() => false)) {
        await clickAndWaitForUrl(page, fallbackAllProductsLink, /\/wszystkie\/?$/i);
      }
    }

    if (!/\/wszystkie\/?$/i.test(page.url())) {
      await Promise.all([
        page.waitForURL(/\/wszystkie\/?$/i, { timeout: 15000 }),
        page
          .evaluate(() => {
            const target = Array.from(document.querySelectorAll('a')).find(link => {
              const href = link.getAttribute('href') || '';
              const rect = link.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0;
              return href.includes('/wszystkie/') && visible;
            });

            if (target) {
              target.click();
            }
          })
          .catch(() => {}),
      ]).catch(() => {});
    }
  }

  if (!/\/wszystkie\/?$/i.test(page.url())) {
    await page.goto(new URL('/wszystkie/', BASE_URL).href, { waitUntil: 'domcontentloaded' });
  }

  await expect(page).toHaveURL(/\/wszystkie\/?$/i);
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
    const goToCartLink = blockCartDialog.getByRole('link', { name: /Idź do koszyka/i }).first();
    if (await goToCartLink.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForURL(/\/koszyk/i, { timeout: 15000 }),
        goToCartLink.click({ force: true }),
      ]).catch(() => {});
    }
  }

  if (/\/koszyk/i.test(page.url())) {
    return;
  }

  const cartLink = headerCartLink(page);
  await expect(cartLink).toBeVisible({ timeout: 15000 });
  await cartLink.click({ force: true });
  await page.waitForTimeout(1000);

  if (/\/koszyk/i.test(page.url())) {
    return;
  }

  await cartLink.evaluate(element => element.click()).catch(() => {});
  await page.waitForTimeout(1000);

  if (/\/koszyk/i.test(page.url())) {
    return;
  }

  const goToCartLink = page.getByRole('link', { name: /Idź do koszyka/i }).first();
  if (await goToCartLink.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForURL(/\/koszyk/i, { timeout: 15000 }),
      goToCartLink.click({ force: true }),
    ]).catch(() => {});
  }

  if (!/\/koszyk/i.test(page.url())) {
    await page.goto(new URL('/koszyk', BASE_URL).href, { waitUntil: 'domcontentloaded' });
  }
}

async function expectCartCount(page, expectedCartCount) {
  await expect(
    page.getByRole('link', { name: new RegExp(`Koszyk\\s*${expectedCartCount}`, 'i') }).first()
  ).toBeVisible({ timeout: 15000 });
}

async function closeCartDialog(page) {
  const blockCartDialog = cartDialog(page);
  if (!(await blockCartDialog.isVisible().catch(() => false))) {
    return;
  }

  const closeButton = blockCartDialog.getByRole('button', { name: /Zamknij|Close/i }).first();

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
  if (!(await overlayMenu.isVisible().catch(() => false))) {
    return;
  }

  await page.keyboard.press('Escape').catch(() => {});

  if (await overlayMenu.isVisible().catch(() => false)) {
    await page.locator('body').click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
  }

  await expect(overlayMenu).toBeHidden({ timeout: 5000 }).catch(() => {});
}

async function closeShopMenu(page, menuName) {
  const shopMenuItem = page.getByRole('menuitem', { name: menuName }).first();
  const isExpanded = await shopMenuItem.getAttribute('aria-expanded').catch(() => null);

  if (isExpanded !== 'true') {
    return;
  }

  await page.keyboard.press('Escape').catch(() => {});

  if ((await shopMenuItem.getAttribute('aria-expanded').catch(() => null)) === 'true') {
    await page.locator('body').click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
  }
}

async function closeBlockingPopups(page) {
  const popupCloseButtons = [
    page.locator('#newsletter_popup .close, #newsletter_popup button[aria-label="Close"]').first(),
    page.locator('.modal-dialog .btn-close, .modal-dialog button[aria-label="Close"]').first(),
    page.locator('.popup-close, .close-popup, .close-newsletter').first(),
    page.locator('button[aria-label="Zamknij"]').first(),
  ];

  for (const button of popupCloseButtons) {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(() => {});
    }
  }

  await closeCartDialog(page);
  await closeMenuOverlay(page);
}
