import { expect } from '@playwright/test';

const PRODUCT_Q1 = { id: '38' };
const PRODUCT_GLASS = { id: '40' };
const CLOSE_LABELS = /Close|Cerrar|Chiudi|Fermer|Sluiten|Fechar|Zamknij|Zavrieť|Zavriet|Zavřít|Zavrit|Stäng|Stang|Bezár|Bezar|Sulje|Schließen|Schliessen|Zatvori|Затвори/i;

export async function runCartScenario(page, market) {
  await gotoWithRetry(page, market.baseUrl);

  await dismissCookieBanner(page);
  await closeBlockingPopups(page);
  await openAllProducts(page, market);

  await addProductToCart(page, market, PRODUCT_Q1, 1);
  await addProductToCart(page, market, PRODUCT_GLASS, 2);

  await expectCartCount(page, market, 2);
  await openCart(page, market);

  await expect(page).toHaveURL(pathToRegex(cartUrlPath(market)));
  await expect(page.locator('[id^="name-38-"]').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[id^="name-40-"]').first()).toBeVisible({ timeout: 15000 });
}

function headerCartLink(page, market) {
  return page.locator(`#header a[href*="${market.cartPath}"]`).first();
}

function cartDialog(page, market) {
  return page
    .locator(
      `#blockcart-modal, [role="dialog"][aria-labelledby="blockcart-modal-title"], [role="dialog"]:has(a[href*="${market.cartPath}"])`
    )
    .first();
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
    '#CybotCookiebotDialogBodyButtonDecline',
  ]) {
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

async function openAllProducts(page, market) {
  await closeBlockingPopups(page);
  await gotoWithRetry(page, new URL(market.allProductsPath, market.baseUrl).href);

  await expect(page).toHaveURL(pathToRegex(market.allProductsPath));
  await closeMenuOverlay(page);
}

async function clickAndWaitForUrl(page, locator, urlPattern) {
  try {
    await Promise.all([
      page.waitForURL(urlPattern, { timeout: 15000 }),
      locator.click({ force: true }),
    ]);
    return true;
  } catch {
    return urlPattern.test(page.url());
  }
}

async function addProductToCart(page, market, product, expectedCartCount) {
  const productCard = page.locator(`article.product-miniature[data-id-product="${product.id}"]`);
  const addButton = productCard.locator('button.add-to-cart');

  await closeBlockingPopups(page);
  await closeCartDialog(page, market);
  await closeMenuOverlay(page);
  await expect(productCard).toBeVisible({ timeout: 15000 });
  await productCard.scrollIntoViewIfNeeded();
  await expect(addButton).toBeVisible({ timeout: 15000 });
  await expect(addButton).toBeEnabled({ timeout: 15000 }).catch(() => {});
  await addButton.click().catch(async () => {
    await addButton.click({ force: true }).catch(async () => {
    await addButton.evaluate(element => element.click()).catch(() => {});
    });
  });
  await expectCartCount(page, market, expectedCartCount);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (expectedCartCount < 2) {
    await closeBlockingPopups(page);
    await closeCartDialog(page, market);
    await closeMenuOverlay(page);
    await gotoWithRetry(page, new URL(market.allProductsPath, market.baseUrl).href);
    await expect(page).toHaveURL(pathToRegex(market.allProductsPath));
  }
}

async function openCart(page, market) {
  await closeMenuOverlay(page);
  const cartUrlPattern = pathToRegex(cartUrlPath(market));
  const dialog = cartDialog(page, market);

  if (await dialog.isVisible().catch(() => false)) {
    const goToCartLink = dialog.locator(`a[href*="${market.cartPath}"]`).first();
    if (await goToCartLink.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForURL(cartUrlPattern, { timeout: 15000 }),
        goToCartLink.click({ force: true }),
      ]).catch(() => {});
    }
  }

  if (cartUrlPattern.test(page.url())) {
    return;
  }

  const cartLink = headerCartLink(page, market);
  await expect(cartLink).toBeVisible({ timeout: 15000 });
  await cartLink.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1000);

  if (cartUrlPattern.test(page.url())) {
    return;
  }

  await cartLink.evaluate(element => element.click()).catch(() => {});
  await page.waitForTimeout(1000);

  if (cartUrlPattern.test(page.url())) {
    return;
  }

  const fallbackGoToCartLink = page.locator(`a[href*="${market.cartPath}"]`).first();
  if (await fallbackGoToCartLink.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForURL(cartUrlPattern, { timeout: 15000 }),
      fallbackGoToCartLink.click({ force: true }),
    ]).catch(() => {});
  }

  if (!cartUrlPattern.test(page.url())) {
    await gotoWithRetry(page, new URL(cartUrlPath(market), market.baseUrl).href);
  }
}

async function closeCartDialog(page, market) {
  const dialog = cartDialog(page, market);
  if (!(await dialog.isVisible().catch(() => false))) return;

  const closeButton = dialog.getByRole('button', { name: CLOSE_LABELS }).first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true }).catch(async () => {
      await closeButton.press('Enter').catch(() => {});
    });
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }

  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
  }

  await expect(dialog).toBeHidden({ timeout: 15000 }).catch(() => {});
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

async function closeSurveyOverlay(page) {
  await page
    .evaluate(() => {
      const selectors = [
        '#survicate-box',
        '.survicate-box',
        '.survicate-box-WidgetSurvey',
        '[class*="survicate_overlay"]',
        '[class*="sv__overlay"]',
        '.fancybox-overlay',
      ];

      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          element.remove();
        }
      }
    })
    .catch(() => {});
}

async function closeBlockingPopups(page) {
  const popupCloseButtons = [
    page.locator('#newsletter_popup .close, #newsletter_popup button[aria-label="Close"]').first(),
    page.locator('.modal-dialog .btn-close, .modal-dialog button[aria-label="Close"]').first(),
    page.locator('.popup-close, .close-popup, .close-newsletter, .callback-popup .popup-close').first(),
    page.locator('button[aria-label]').filter({ hasText: CLOSE_LABELS }).first(),
    page.getByRole('button', { name: CLOSE_LABELS }).first(),
    page.getByRole('button', { name: /Zgadzam się|Zgadzam sie|Agree|Accept/i }).first(),
  ];

  for (const button of popupCloseButtons) {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(async () => {
        await button.evaluate(element => element.click()).catch(() => {});
      });
    }
  }

  await closeSurveyOverlay(page);
  await page.keyboard.press('Escape').catch(() => {});
  await closeMenuOverlay(page);
}

async function extractCartCount(page, market) {
  const badge = headerCartLink(page, market).locator('.cart-count').first();
  if (!(await badge.isVisible().catch(() => false))) return -1;

  const text = (await badge.textContent().catch(() => '')) || '';
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : -1;
}

async function expectCartCount(page, market, expectedCartCount) {
  const headerCart = headerCartLink(page, market);

  if (market.cartLabelPattern) {
    const headerNamePattern = new RegExp(
      `${market.cartLabelPattern.source}\\s*${expectedCartCount}`,
      market.cartLabelPattern.flags
    );

    if (await headerCart.isVisible().catch(() => false)) {
      await expect(headerCart).toHaveAccessibleName(headerNamePattern, { timeout: 15000 }).catch(() => {});
      const currentCount = await extractCartCount(page, market);
      if (currentCount === expectedCartCount) {
        return;
      }

      const accessibleName = (await headerCart.evaluate(el => {
        return el.getAttribute('aria-label') || el.textContent || '';
      }).catch(() => '')) || '';

      if (headerNamePattern.test(accessibleName) && currentCount === -1) {
        return;
      }
    }

  }

  const badge = headerCart.locator('.cart-count').first();
  if (await badge.isVisible().catch(() => false)) {
    await expect
      .poll(() => extractCartCount(page, market), { timeout: 30000 })
      .toBe(expectedCartCount);
    return;
  }

  await expect(headerCart).toContainText(String(expectedCartCount), { timeout: 30000 });
}

async function gotoWithRetry(page, url, options = { waitUntil: 'domcontentloaded' }) {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { ...options, timeout: 30000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000 * attempt).catch(() => {});
    }
  }

  throw lastError;
}

function cartUrlPath(market) {
  return market.cartPath.split('?')[0];
}

function pathToRegex(path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\/?$`, 'i');
}
