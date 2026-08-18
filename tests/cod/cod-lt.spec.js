import { test, expect } from '@playwright/test';

test.setTimeout(180000);
test.describe.configure({ mode: 'serial' });

const BASE_URL = 'https://vasco-translator.lt/';
const ALL_PRODUCTS_PATH = '/visi-produktai/';
const CHECKOUT_PATH = '/commande';
const CART_PATH = '/krepselis?action=show';
const PRODUCT_Q1 = { id: '38' };

const COD_PAYMENT_LABEL = 'Mokėjimas pristatymo metu';
const COD_COMPATIBLE_SHIPPING_METHODS = [
  'Venipack Pristatymas į namus',
];
const COD_PAYMENT_PATTERNS = [
  /Mokėjimas pristatymo metu/i,
  /Mokejimas pristatymo metu/i,
  /Apmokėti kurjeriui pristatymo metu/i,
  /Apmoketi kurjeriui pristatymo metu/i,
  /Mokėti pristatymo metu/i,
  /Moketi pristatymo metu/i,
  /Grynais.*kurjeri/i,
  /Mokėjimas grynais/i,
  /Mokejimas grynais/i,
];

const LT_CUSTOMER = {
  firstName: 'Automat',
  lastName: 'Test',
  email: 'testcases.web@gmail.com',
  phone: '61234567',
  address1: 'Gedimino pr 12',
  address2: '2',
  postcode: '01103',
  city: 'Vilnius',
  country: 'Lietuva',
};

const scenarios = [
  { quantity: 1, expectedCodVisible: true, label: 'ponizej limitu COD' },
  { quantity: 2, expectedCodVisible: true, label: 'na limicie COD' },
  { quantity: 3, expectedCodVisible: false, label: 'powyzej limitu COD' },
];

for (const scenario of scenarios) {
  test(`LT COD dla ${scenario.quantity}x Q1 jest ${scenario.expectedCodVisible ? 'widoczne' : 'ukryte'} - ${scenario.label}`, async ({ page, browserName }) => {
    await seedCartWithQ1Quantity(page, scenario.quantity);
    await goToCheckout(page);
    await completePersonalInformation(page, browserName);
    await completeAddress(page, LT_CUSTOMER);
    await waitForShippingAndPaymentStep(page);
    await assertLithuanianCodVisibility(page, scenario.expectedCodVisible);
  });
}

async function seedCartWithQ1Quantity(page, quantity) {
  await safeGoto(page, BASE_URL);
  await dismissCookieBanner(page);
  await closeBlockingPopups(page);
  await openAllProducts(page);

  for (let index = 0; index < quantity; index += 1) {
    await addProductToCart(page, PRODUCT_Q1, index + 1);
  }
}

async function goToCheckout(page) {
  await closeBlockingPopups(page);
  await safeGoto(page, new URL(CHECKOUT_PATH, BASE_URL).href);
  await dismissCookieBanner(page);
  await closeBlockingPopups(page);

  await expect(page).toHaveURL(/\/commande/i);
  await expect(page.getByText(/Asmeninė informacija|Asmens duomenys/i).first()).toBeVisible({ timeout: 20000 });
}

async function completePersonalInformation(page, browserName) {
  await fillField(page, [/^Vardas/i], LT_CUSTOMER.firstName);
  await fillField(page, [/^Pavardė/i], LT_CUSTOMER.lastName);
  await fillField(page, [/E-mail|El\.?\s*paštas|Email/i], createUniqueEmail(LT_CUSTOMER.email));

  for (const label of [/Perskaičiau ir susipažinau su sąlygomis|Paslaugų teikimo sąlygos|Naudojimo sąlygos|sąlygos/i, /Perskaičiau ir susipažinau su privatumo politika|Privatumo politika|Privatumo taisyklės|privatumo/i]) {
    const checkbox = page.getByRole('checkbox', { name: label }).first();
    await expect(checkbox).toBeVisible({ timeout: 15000 });
    await checkbox.check({ force: true }).catch(async () => {
      await checkbox.click({ force: true }).catch(() => {});
    });
  }

  await continueToAddressStep(page, browserName);
}

async function continueToAddressStep(page, browserName) {
  if (await isAddressFormReady(page)) {
    return;
  }

  const continueButton = await findVisibleContinueButton(page);
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await clickContinueButton(continueButton);
  await page.waitForTimeout(browserName === 'webkit' ? 3000 : 500);

  await expect
    .poll(async () => await isAddressFormReady(page), { timeout: browserName === 'webkit' ? 15000 : 8000 })
    .toBeTruthy()
    .catch(() => {});

  if (await isAddressFormReady(page)) {
    return;
  }

  const addressStepUrl = new URL(`${CHECKOUT_PATH}?id_address=0`, BASE_URL).href;
  await safeGoto(page, addressStepUrl).catch(() => {});
  await page.waitForTimeout(1000);

  const addressStepTargets = [
    page.getByText(/^Adresas$|^Adresai$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Adresas$|^Adresai$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Adresas$|^Adresai$/i }).first(),
  ];

  for (const target of addressStepTargets) {
    if (await target.isVisible().catch(() => false)) {
      await target.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
      if (await isAddressFormReady(page)) {
        return;
      }
    }
  }

  throw new Error('Address step did not open.');
}

async function completeAddress(page, customer) {
  if (await hasVisibleSelectOption(page, customer.country)) {
    await selectVisibleOption(page, customer.country).catch(() => {});
    await page.waitForTimeout(300);
  }

  await chooseIndividualCustomerType(page);
  await fillByPlaceholder(page, /vardas/i, customer.firstName);
  await fillByPlaceholder(page, /pavardė|pavarde/i, customer.lastName);
  await fillByPlaceholder(page, /adresas|gatvė|gatve/i, customer.address1);
  await fillByPlaceholder(page, /adresas 2|papildomas adresas|butas|aukštas|aukstas/i, customer.address2).catch(() => {});
  await fillByPlaceholder(page, /pašto kodas|pasto kodas|kodas/i, customer.postcode);
  await fillByPlaceholder(page, /miestas|vietovė|vietove/i, customer.city);
  await fillPhoneNumber(page, customer.phone);

  const continueButton = page.getByRole('button', { name: /Tęsti|Testi/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });
}

async function waitForShippingAndPaymentStep(page) {
  await expect
    .poll(async () => {
      await closeBlockingPopups(page);
      const loadingVisible = await hasVisibleText(page, /Tikriname jūsų duomenis|Tikriname jusu duomenis|Duomenų tikrinimas|Duomenu tikrinimas/i);
      if (loadingVisible) return false;

      const shippingReady = await hasVisibleText(page, /Pristatymo būdas|Pristatymo budas|Pristatymas/i);
      const paymentReady = await hasVisibleText(page, /Kaip norėtumėte sumokėti|Kaip noretumete sumoketi|Mokėjimas|Mokejimas/i);
      return shippingReady || paymentReady;
    }, { timeout: 30000 })
    .toBeTruthy();
}

async function selectShippingMethod(page, shippingLabel) {
  const shippingPattern = new RegExp(escapeRegExp(shippingLabel), 'i');
  const initialVisibleOption = await findFirstVisibleLocator(page.getByText(shippingPattern));
  if (!initialVisibleOption) {
    await expandShippingCarrier(page, shippingLabel);
    await page.waitForTimeout(500);
  }

  const visibleOption = await findFirstVisibleLocator(page.getByText(shippingPattern));
  expect(visibleOption, `Visible shipping method "${shippingLabel}" was not found.`).toBeTruthy();

  const candidates = [
    page.getByRole('radio', { name: shippingPattern }),
    page.getByLabel(shippingPattern),
    page.locator('label').filter({ hasText: shippingPattern }),
    page.getByText(shippingPattern),
  ];

  for (const candidate of candidates) {
    const visibleCandidate = await findFirstVisibleLocator(candidate);
    if (!visibleCandidate) continue;

    const type = (await visibleCandidate.getAttribute('type').catch(() => '')) ?? '';
    if (type.toLowerCase() === 'radio') {
      await visibleCandidate.check({ force: true }).catch(() => {});
    }

    await visibleCandidate.click({ force: true }).catch(async () => {
      await visibleCandidate.dispatchEvent('click').catch(() => {});
    });
    await page.waitForTimeout(1000);

    if (await isShippingMethodSelected(page, shippingLabel)) return;
  }

  throw new Error(`Shipping method "${shippingLabel}" was not selectable.`);
}

async function isShippingMethodSelected(page, shippingLabel) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return new RegExp(escapeRegExp(shippingLabel), 'i').test(bodyText);
}

async function assertCodVisibility(page, expectedVisible) {
  const codLocator = await findVisibleCodLocator(page);

  if (expectedVisible) {
    expect(codLocator, 'LT COD payment option was not visible.').toBeTruthy();
    await expect(codLocator).toBeVisible({ timeout: 15000 });
    return;
  }

  expect(codLocator).toBeFalsy();
}

async function isCodVisible(page) {
  return Boolean(await findVisibleCodLocator(page));
}

async function findVisibleCodLocator(page) {
  for (const pattern of COD_PAYMENT_PATTERNS) {
    const locator = page.getByText(pattern).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return null;
}

async function assertLithuanianCodVisibility(page, expectedVisible) {
  let visibleShippingMethod = null;

  for (const shippingLabel of COD_COMPATIBLE_SHIPPING_METHODS) {
    await openShippingStep(page);

    // Venipack starts as a collapsed carrier card. selectShippingMethod()
    // expands it before looking for the concrete home-delivery/pickup option.
    await selectShippingMethod(page, shippingLabel).catch(() => {});
    const selectedOption = await findFirstVisibleLocator(
      page.getByText(new RegExp(escapeRegExp(shippingLabel), 'i'))
    );
    if (!selectedOption) continue;
    await continueToPaymentStep(page);

    const codVisible = await isCodVisible(page);
    if (codVisible) {
      visibleShippingMethod = shippingLabel;
      break;
    }
  }

  if (expectedVisible) {
    expect(visibleShippingMethod, 'LT checkout did not expose COD for any supported shipping method.').toBeTruthy();
    await assertCodVisibility(page, true);
    return;
  }

  expect(visibleShippingMethod, `LT checkout exposed COD above the limit via "${visibleShippingMethod}".`).toBeFalsy();
}

async function continueToPaymentStep(page) {
  const isPaymentStepVisible = async () => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    return /Kaip norėtumėte apmokėti|Kaip noretumete apmoketi|Kaip norėtumėte sumokėti|Kaip noretumete sumoketi|Apmokėti kortele|Apmoketi kortele|Apmokėti bankiniu pavedimu|Apmoketi bankiniu pavedimu|Paysera/i.test(bodyText);
  };

  if (await isPaymentStepVisible()) {
    return;
  }

  const continueButton = page.getByRole('button', { name: /Tęsti|Testi/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });

  await expect
    .poll(isPaymentStepVisible, { timeout: 30000 })
    .toBeTruthy();
}

async function openShippingStep(page) {
  const shippingStepTargets = [
    page.getByText(/^Pristatymo būdas$|^Pristatymo budas$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Pristatymo būdas$|^Pristatymo budas$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Pristatymo būdas$|^Pristatymo budas$/i }).first(),
  ];

  for (const target of shippingStepTargets) {
    if (await target.isVisible().catch(() => false)) {
      await target.click({ force: true }).catch(() => {});
      break;
    }
  }

  await expect
    .poll(async () => {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return /Pasirinkite pristatymo būdą|Pristatymo būdas|Pristatymo budas/i.test(bodyText);
    }, { timeout: 15000 })
    .toBeTruthy();
}

async function expandShippingCarrier(page, shippingLabel) {
  const shippingPattern = new RegExp(escapeRegExp(shippingLabel), 'i');
  const candidates = [
    page.getByText(/^Venipack$/i).first(),
    page.locator('img[alt="Venipack"]').first(),
    page.locator('p').filter({ hasText: /^Venipack$/i }).first(),
    page.locator('p').filter({ hasText: /^Venipack$/i }).locator('..').first(),
    page.locator('p').filter({ hasText: /^Venipack$/i }).locator('..').locator('..').first(),
  ];

  for (const candidate of candidates) {
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    await candidate.click({ force: true }).catch(async () => {
      await candidate.dispatchEvent('click').catch(() => {});
      await candidate.press('Enter').catch(() => {});
    });
    await page.waitForTimeout(700);

    const expandedOption = await findFirstVisibleLocator(page.getByText(shippingPattern));
    if (expandedOption) {
      return;
    }
  }
}

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
  const mainMenuLink = page.getByRole('link', { name: /Visi produktai/i }).first();
  const visibleAllProductsLink = page.locator(`a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const shopMenuItem = page.getByRole('menuitem', { name: /vertimo įrenginiai|vertimo irenginiai|produktai|priedai/i }).first();

  if (await desktopMenuLink.isVisible().catch(() => false)) {
    await clickAndWaitForUrl(page, desktopMenuLink, /\/visi-produktai\/?$/i);
  } else {
    if (await shopMenuItem.isVisible().catch(() => false)) {
      await shopMenuItem.hover().catch(() => {});
      await shopMenuItem.click().catch(() => {});
      await closeBlockingPopups(page);
    }

    if (await mainMenuLink.isVisible().catch(() => false)) {
      await clickAndWaitForUrl(page, mainMenuLink, /\/visi-produktai\/?$/i);
    }

    if (!/\/visi-produktai\/?$/i.test(page.url()) && (await visibleAllProductsLink.isVisible().catch(() => false))) {
      await clickAndWaitForUrl(page, visibleAllProductsLink, /\/visi-produktai\/?$/i);
    }

    if (!/\/visi-produktai\/?$/i.test(page.url())) {
      await Promise.all([
        page.waitForURL(/\/visi-produktai\/?$/i, { timeout: 15000 }),
        page
          .evaluate(() => {
            const target = Array.from(document.querySelectorAll('a')).find(link => {
              const href = link.getAttribute('href') || '';
              const rect = link.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0;
              return href.includes('/visi-produktai/') && visible;
            });

            if (target) target.click();
          })
          .catch(() => {}),
      ]).catch(() => {});
    }
  }

  if (!/\/visi-produktai\/?$/i.test(page.url())) {
    await safeGoto(page, new URL(ALL_PRODUCTS_PATH, BASE_URL).href);
  }

  await expect(page).toHaveURL(/\/visi-produktai\/?$/i);
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

async function findFirstVisibleLocator(locator) {
  const count = await locator.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  return null;
}

async function addProductToCart(page, product, expectedCartCount) {
  const productCard = page.locator(`article.product-miniature[data-id-product="${product.id}"]`);
  await closeBlockingPopups(page);
  await closeCartDialog(page);
  await closeMenuOverlay(page);
  await expect(productCard).toBeVisible({ timeout: 15000 });
  await productCard.scrollIntoViewIfNeeded();
  await dismissCookieBanner(page);
  await productCard.locator('button.add-to-cart').click({ force: true });
  await expectCartCount(page, expectedCartCount);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (expectedCartCount < 2) {
    await closeBlockingPopups(page);
    await closeCartDialog(page);
    await closeMenuOverlay(page);
  }
}

async function expectCartCount(page, expectedCartCount) {
  const cartLinkByName = page.getByRole('link', { name: new RegExp(`Krepšelis\\s*${expectedCartCount}|Krepselis\\s*${expectedCartCount}`, 'i') }).first();
  if (await cartLinkByName.isVisible().catch(() => false)) {
    await expect(cartLinkByName).toBeVisible({ timeout: 15000 });
    return;
  }
  await expect(headerCartLink(page)).toContainText(String(expectedCartCount), { timeout: 15000 });
}

async function safeGoto(page, url, options = {}) {
  let lastError;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', ...options });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1500 * (attempt + 1)).catch(() => {});
    }
  }

  throw lastError;
}

async function closeCartDialog(page) {
  const blockCartDialog = cartDialog(page);
  if (!(await blockCartDialog.isVisible().catch(() => false))) return;

  const closeButton = blockCartDialog.getByRole('button', { name: /Uždaryti|Uždaryti|Close/i }).first();
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

async function closeSurveyOverlay(page) {
  await page
    .evaluate(() => {
      const selectors = [
        '#survicate-box',
        '.survicate-box-WidgetSurvey',
        '[class*="survicate_overlay"]',
        '[class*="sv__overlay"]',
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
    page.locator('.popup-close, .close-popup, .close-newsletter').first(),
    page.locator('button[aria-label="Uždaryti"], button[aria-label="Close"]').first(),
  ];

  for (const button of popupCloseButtons) {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(() => {});
    }
  }

  await closeSurveyOverlay(page);
  await closeCartDialog(page);
  await closeMenuOverlay(page);
}

async function fillField(page, labelPatterns, value) {
  for (const pattern of labelPatterns) {
    const candidates = [
      page.getByRole('textbox', { name: pattern }).first(),
      page.getByLabel(pattern).first(),
      page.getByPlaceholder(pattern).first(),
    ];

    for (const field of candidates) {
      if (await field.isVisible().catch(() => false)) {
        await setFieldValue(field, value);
        return;
      }
    }
  }

  throw new Error(`Field not found for ${labelPatterns.join(', ')}`);
}

async function fillByPlaceholder(page, pattern, value) {
  const placeholderCandidates = page.locator('input[placeholder], textarea[placeholder]');
  const placeholderCount = await placeholderCandidates.count();

  for (let index = placeholderCount - 1; index >= 0; index -= 1) {
    const candidate = placeholderCandidates.nth(index);
    const placeholder = (await candidate.getAttribute('placeholder').catch(() => '')) ?? '';
    if (pattern.test(placeholder) && (await candidate.isVisible().catch(() => false))) {
      await setFieldValue(candidate, value);
      return;
    }
  }

  const labelCandidates = [
    page.getByRole('textbox', { name: pattern }).last(),
    page.getByLabel(pattern).last(),
  ];

  for (const candidate of labelCandidates) {
    if (await isFillableField(candidate)) {
      await setFieldValue(candidate, value);
      return;
    }
  }

  throw new Error(`Field not found for pattern ${pattern}`);
}

async function isFillableField(candidate) {
  if (!(await candidate.isVisible().catch(() => false))) return false;
  const tagName = await candidate.evaluate(element => element.tagName.toLowerCase()).catch(() => '');
  if (!['input', 'textarea'].includes(tagName)) return false;
  const type = ((await candidate.getAttribute('type').catch(() => '')) ?? '').toLowerCase();
  return !['radio', 'checkbox', 'hidden', 'submit', 'button'].includes(type);
}

async function findVisibleContinueButton(page) {
  const genericPrestashopButton = page.locator('button[name="continue"][data-link-action="register-new-customer"]').first();
  if (await genericPrestashopButton.isVisible().catch(() => false)) {
    return genericPrestashopButton;
  }

  const buttons = page.getByRole('button', { name: /Tęsti|Testi/i });
  const count = await buttons.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible().catch(() => false)) {
      return button;
    }
  }

  return buttons.first();
}

async function clickContinueButton(button) {
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await button.focus().catch(() => {});
  await button.click({ timeout: 1000 }).catch(async () => {
    await button.click({ force: true }).catch(() => {});
    await button.dispatchEvent('click').catch(() => {});
    await button.evaluate(element => {
      element.click?.();
      element.closest('form')?.requestSubmit?.();
    }).catch(() => {});
    const box = await button.boundingBox().catch(() => null);
    if (box) {
      await button.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    }
  });
}

async function isAddressFormReady(page) {
  if (await hasVisibleText(page, /Koks jūsų atsiskaitymo adresas|Koks jusu atsiskaitymo adresas|atsiskaitymo adresas/i)) {
    return true;
  }

  return (
    (await hasVisibleFieldForPattern(page, /adresas|gatvė|gatve/i)) ||
    (await hasVisibleFieldForPattern(page, /pašto kodas|pasto kodas|kodas/i))
  );
}

async function chooseIndividualCustomerType(page) {
  const individualTargets = [
    page.getByRole('radio', { name: /Privatus klientas|Fizinis asmuo/i }).first(),
    page.getByLabel(/Privatus klientas|Fizinis asmuo/i).first(),
    page.locator('label').filter({ hasText: /Privatus klientas|Fizinis asmuo/i }).first(),
    page.getByText(/Privatus klientas|Fizinis asmuo/i).first(),
    page.locator('input[type="radio"][value="private"]').first(),
    page.locator('input[type="radio"][value="individual"]').first(),
  ];

  for (const target of individualTargets) {
    if (await target.isVisible().catch(() => false)) {
      if ((await target.getAttribute('type').catch(() => '')) === 'radio') {
        await target.check?.().catch(() => {});
      }
      await target.click().catch(() => {});
      return;
    }
  }
}

async function hasVisibleFieldForPattern(page, pattern) {
  const placeholderCandidates = page.locator('input[placeholder], textarea[placeholder]');
  const placeholderCount = await placeholderCandidates.count();

  for (let index = placeholderCount - 1; index >= 0; index -= 1) {
    const candidate = placeholderCandidates.nth(index);
    const placeholder = (await candidate.getAttribute('placeholder').catch(() => '')) ?? '';
    if (pattern.test(placeholder) && (await candidate.isVisible().catch(() => false))) {
      return true;
    }
  }

  const labelCandidates = [
    page.getByRole('textbox', { name: pattern }).last(),
    page.getByLabel(pattern).last(),
  ];

  for (const candidate of labelCandidates) {
    if (await isFillableField(candidate)) return true;
  }

  return false;
}

async function hasVisibleText(page, pattern) {
  const matches = page.getByText(pattern);
  const count = await matches.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    if (await matches.nth(index).isVisible().catch(() => false)) return true;
  }

  return false;
}

async function fillPhoneNumber(page, value) {
  const candidates = [
    page.getByRole('textbox', { name: /Telefonas/i }).last(),
    page.getByLabel(/Telefonas/i).last(),
    page.locator('input[type="tel"]').last(),
    page.locator('input[name*="phone" i], input[id*="phone" i], input[name*="telephone" i], input[id*="telephone" i], input[name*="telefon" i], input[id*="telefon" i]').last(),
  ];

  for (const field of candidates) {
    if (await field.isVisible().catch(() => false)) {
      await setFieldValue(field, value);
      return;
    }
  }

  throw new Error('Phone field not found.');
}

async function hasVisibleSelectOption(page, value) {
  const selects = page.locator('select, [role="combobox"]');
  const selectCount = await selects.count();

  for (let index = selectCount - 1; index >= 0; index -= 1) {
    const select = selects.nth(index);
    if (!(await select.isVisible().catch(() => false))) continue;

    const hasOption = await select
      .evaluate((element, targetValue) => {
        const normalize = input =>
          String(input ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();

        const target = normalize(targetValue);
        const options = Array.from(element.options ?? []);
        return options.some(option => {
          const label = normalize(option.label ?? option.textContent);
          const text = normalize(option.textContent);
          const valueAttr = normalize(option.value ?? option.getAttribute?.('value'));
          return label === target || text === target || valueAttr === target;
        });
      }, value)
      .catch(() => false);

    if (hasOption) return true;
  }

  return false;
}

async function selectVisibleOption(page, value) {
  const selects = page.locator('select, [role="combobox"]');
  const selectCount = await selects.count();

  for (let index = selectCount - 1; index >= 0; index -= 1) {
    const select = selects.nth(index);
    if (!(await select.isVisible().catch(() => false))) continue;

    const selected = await select
      .evaluate((element, targetValue) => {
        const normalize = input =>
          String(input ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();

        const target = normalize(targetValue);
        const options = Array.from(element.options ?? []);
        const matchingOption =
          options.find(option => normalize(option.label ?? option.textContent) === target) ??
          options.find(option => normalize(option.textContent) === target) ??
          options.find(option => normalize(option.value ?? option.getAttribute?.('value')) === target);

        if (!matchingOption) return false;

        element.value = matchingOption.value;
        matchingOption.selected = true;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, value)
      .catch(() => false);

    if (selected) {
      await page.waitForTimeout(300);
      return;
    }
  }

  throw new Error(`Visible select option "${value}" not found.`);
}

function createUniqueEmail(email) {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) return email;
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const baseLocalPart = localPart.split('+')[0];
  const suffix = `decod${Date.now().toString(36)}`;
  return `${baseLocalPart}+${suffix}@${domain}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

async function setFieldValue(field, value) {
  await field.scrollIntoViewIfNeeded().catch(() => {});
  const targetDigits = normalizeDigits(value);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await field.click({ force: true }).catch(() => {});
    await field.fill('').catch(() => {});
    await field.fill(value).catch(() => {});
    await field.dispatchEvent('input').catch(() => {});
    await field.dispatchEvent('change').catch(() => {});

    const currentValue = await field.inputValue().catch(() => null);
    if (currentValue === value || normalizeDigits(currentValue) === targetDigits) return;

    await field.press('Meta+a').catch(() => {});
    await field.press('Control+a').catch(() => {});
    await field.press('Backspace').catch(() => {});
    await field.type(value, { delay: 20 }).catch(() => {});

    const typedValue = await field.inputValue().catch(() => null);
    if (typedValue === value || normalizeDigits(typedValue) === targetDigits) return;
  }

  throw new Error(`Could not set field value to "${value}".`);
}
