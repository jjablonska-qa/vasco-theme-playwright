import { test, expect } from '@playwright/test';

test.setTimeout(90000);

const BASE_URL = 'https://vasco-electronics.bg/';
const CART_PATH = '/kolicka?action=show';
const PRODUCT_Q1 = {
  id: '38',
};
const PRODUCT_GLASS = {
  id: '40',
};

test('Koszyk BG zachowuje dodane produkty po przejsciu do koszyka', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await dismissCookieBanner(page);
  await closeBlockingPopups(page);
  await openAllProducts(page);

  await addProductToCart(page, PRODUCT_Q1, 1);
  await addProductToCart(page, PRODUCT_GLASS, 2);

  await expect(headerCartLink(page)).toContainText('2', { timeout: 15000 });

  await openCart(page);

  await expect(page).toHaveURL(/\/kolicka/i);
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

  const primaryButtons = [
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyLevelButtonAccept',
    '#CybotCookiebotDialogBodyButtonAccept',
    '#CybotCookiebotDialogBodyLevelButtonCustomize',
  ];

  for (const selector of primaryButtons) {
    const button = page.locator(selector);
    if (await button.isVisible().catch(() => false)) {
      await button.evaluate(element => element.click()).catch(async () => {
        await button.click({ force: true, timeout: 1000 }).catch(() => {});
      });
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
      await button.evaluate(element => element.click()).catch(async () => {
        await button.click({ force: true, timeout: 1000 }).catch(() => {});
      });
      break;
    }
  }

  await expect(dialog).toBeHidden({ timeout: 15000 }).catch(() => {});
}

async function openAllProducts(page) {
  await closeBlockingPopups(page);
  const shopMenuItem = page.getByRole('menuitem', { name: /магазин/i }).first();
  await shopMenuItem.hover().catch(() => {});
  await shopMenuItem.click();
  await closeBlockingPopups(page);

  const desktopMenuLink = page.locator('#desktop-nav').getByRole('link', { name: /^Всички продукти$/i }).first();
  const categoryNavLink = page.locator('main nav').getByRole('link', { name: /^Всички продукти$/i }).first();
  const fallbackAllProductsLink = page
    .locator('a[href*="/vsicki-produkti/"]')
    .filter({ hasText: /^Всички продукти$/i })
    .first();

  if (await desktopMenuLink.isVisible().catch(() => false)) {
    await clickAndWaitForUrl(page, desktopMenuLink, /\/vsicki-produkti\/?$/i);
  } else {
    await closeShopMenu(page, /магазин/i);
    await closeMenuOverlay(page);
    await expect(categoryNavLink).toBeVisible({ timeout: 15000 });
    const reachedAllProducts = await clickAndWaitForUrl(page, categoryNavLink, /\/vsicki-produkti\/?$/i);

    if (!reachedAllProducts) {
      await closeShopMenu(page, /магазин/i);
      await closeMenuOverlay(page);
      if (await fallbackAllProductsLink.isVisible().catch(() => false)) {
        await clickAndWaitForUrl(page, fallbackAllProductsLink, /\/vsicki-produkti\/?$/i);
      }
    }

    if (!/\/vsicki-produkti\/?$/i.test(page.url())) {
      await Promise.all([
        page.waitForURL(/\/vsicki-produkti\/?$/i, { timeout: 15000 }),
        page
          .evaluate(() => {
            const target = Array.from(document.querySelectorAll('a')).find(link => {
              const href = link.getAttribute('href') || '';
              const rect = link.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0;
              return href.includes('/vsicki-produkti/') && visible;
            });

            if (target) {
              target.click();
            }
          })
          .catch(() => {}),
      ]).catch(() => {});
    }
  }

  if (!/\/vsicki-produkti\/?$/i.test(page.url())) {
    await page.goto(new URL('/vsicki-produkti/', BASE_URL).href, { waitUntil: 'domcontentloaded' });
  }

  await expect(page).toHaveURL(/\/vsicki-produkti\/?$/i);
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

  await expect(headerCartLink(page)).toContainText(String(expectedCartCount), { timeout: 15000 });
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (expectedCartCount < 2) {
    await closeBlockingPopups(page);
    await closeCartDialog(page);
    await closeMenuOverlay(page);
  }
}

async function openCart(page) {
  await closeBlockingPopups(page);
  const blockCartDialog = cartDialog(page);

  if (await blockCartDialog.isVisible().catch(() => false)) {
    const goToCartLink = blockCartDialog.locator(`a[href*="${CART_PATH}"]`).first();
    await expect(goToCartLink).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/kolicka/i, { timeout: 15000 }),
      goToCartLink.click({ force: true }),
    ]).catch(async () => {
      await goToCartLink.click({ force: true });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    });
    return;
  }

  const cartLink = page.getByRole('link', { name: /Количка/i }).first();
  await expect(cartLink).toBeVisible({ timeout: 15000 });
  await cartLink.click({ force: true });
  await page.waitForTimeout(1000);

  if (/\/kolicka/i.test(page.url())) {
    return;
  }

  await cartLink.evaluate(element => element.click()).catch(() => {});
  await page.waitForTimeout(1000);

  if (/\/kolicka/i.test(page.url())) {
    return;
  }

  const goToCartLink = page.locator(`a[href*="${CART_PATH}"]`).filter({ hasText: /Отидете до Вашата количка/i }).first();
  if (await goToCartLink.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForURL(/\/kolicka/i, { timeout: 15000 }),
      goToCartLink.click({ force: true }),
    ]).catch(async () => {
      await goToCartLink.click({ force: true });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    });
  }
}

async function closeCartDialog(page) {
  const blockCartDialog = cartDialog(page);
  if (!(await blockCartDialog.isVisible().catch(() => false))) {
    return;
  }

  const closeButton = blockCartDialog.getByRole('button', { name: /Затвори|Close/i }).first();

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
  const popupSelectors = [
    'dialog#discount-popup',
    '#blockcart-modal',
    'dialog[open]',
    '[role="dialog"]',
    '.modal.show',
    '.popup.show',
  ];

  const closeSelectors = [
    'button.close-dialog-icon[aria-label="Затвори"]',
    'button.close-dialog-icon[aria-label="Zamknij"]',
    'button[aria-label="Затвори"]',
    'button[aria-label="Close"]',
    'button.close-modal',
    'button.close',
    '[data-dismiss="modal"]',
  ];

  for (const popupSelector of popupSelectors) {
    const popup = page.locator(popupSelector).first();
    if (!(await popup.isVisible().catch(() => false))) {
      continue;
    }

    if (await popup.locator('#CybotCookiebotDialog').isVisible().catch(() => false)) {
      continue;
    }

    for (const closeSelector of closeSelectors) {
      const closeButton = popup.locator(closeSelector).first();
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click({ force: true }).catch(() => {});
        break;
      }
    }

    if (await popup.isVisible().catch(() => false)) {
      const saleText = popup.getByText(/sale|разпродаж/i).first();
      if (await saleText.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
  }
}
