import { test, expect } from '@playwright/test';

test.setTimeout(180000);
test.describe.configure({ mode: 'serial' });

const BASE_URL = 'https://vasco-electronics.pl/';
const ALL_PRODUCTS_PATH = '/wszystkie/';
const CHECKOUT_PATH = '/zamowienie';
const CART_PATH = '/koszyk?action=show';
const PRODUCT_Q1 = { id: '38' };

const COD_COMPATIBLE_SHIPPING_METHODS = [
  'Kurier InPost (płatność przy odbiorze)',
  'Kurier UPS (płatność przy odbiorze)',
  'DHL Parcel (płatność przy odbiorze)',
];

const COD_PAYMENT_PATTERNS = [
  /Zapłać gotówką przy odbiorze|Zapl[aą]c got[oó]wk[aą] przy odbiorze/i,
];

const PL_CUSTOMER = {
  firstName: 'Automat',
  lastName: 'Test',
  email: 'testcases.web@gmail.com',
  phone: '888123456',
  address1: 'Marszałkowska 12',
  address2: '2',
  postcode: '00-001',
  city: 'Warszawa',
  country: 'Polska',
};

const scenarios = [
  { quantity: 1, expectedCodVisible: true, label: 'ponizej limitu COD' },
  { quantity: 2, expectedCodVisible: true, label: 'na limicie COD' },
  { quantity: 3, expectedCodVisible: false, label: 'powyzej limitu COD' },
];

for (const scenario of scenarios) {
  test(`PL COD dla ${scenario.quantity}x Q1 jest ${scenario.expectedCodVisible ? 'widoczne' : 'ukryte'} - ${scenario.label}`, async ({ page, browserName }) => {
    await seedCartWithQ1Quantity(page, scenario.quantity);
    await goToCheckout(page);
    await completePersonalInformation(page, browserName);
    await completeAddress(page, PL_CUSTOMER);
    await waitForShippingAndPaymentStep(page);
    await assertPolishCodVisibility(page, scenario.expectedCodVisible);
  });
}

async function seedCartWithQ1Quantity(page, quantity) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);
  await closeBlockingPopups(page);
  await openAllProducts(page);

  for (let index = 0; index < quantity; index += 1) {
    await addProductToCart(page, PRODUCT_Q1, index + 1);
  }
}

async function goToCheckout(page) {
  await closeBlockingPopups(page);
  await page.goto(new URL(CHECKOUT_PATH, BASE_URL).href, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);
  await closeBlockingPopups(page);

  await expect(page).toHaveURL(/\/zamowienie/i);
  await expect(page.getByText(/Informacje osobiste|Dane osobowe/i).first()).toBeVisible({ timeout: 20000 });
}

async function completePersonalInformation(page, browserName) {
  await fillField(page, [/^Imię|^Imie/i], PL_CUSTOMER.firstName);
  await fillField(page, [/^Nazwisko|^Nazwa/i], PL_CUSTOMER.lastName);
  await fillField(page, [/E-mail|Email/i], createUniqueEmail(PL_CUSTOMER.email));

  for (const label of [/Warunki korzystania z serwisu|Regulamin|warunki/i, /Politykę prywatności|Polityke prywatnosci|prywatności|prywatnosci/i]) {
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
    .poll(async () => await isAddressFormReady(page), { timeout: browserName === 'webkit' ? 15000 : 5000 })
    .toBeTruthy()
    .catch(() => {});

  if (await isAddressFormReady(page)) {
    return;
  }

  const addressStepUrl = new URL(`${CHECKOUT_PATH}?id_address=0`, BASE_URL).href;
  await page.goto(addressStepUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1000);

  const addressStepTargets = [
    page.getByText(/^Adresy$|^Adres$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Adresy$|^Adres$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Adresy$|^Adres$/i }).first(),
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
  await fillByPlaceholder(page, /imię|imie/i, customer.firstName);
  await fillByPlaceholder(page, /nazwisko/i, customer.lastName);
  await fillByPlaceholder(page, /wprowadź adres$|adres$/i, customer.address1);
  await fillByPlaceholder(page, /uzupełnienie adresu|uzupelnienie adresu|adres 2/i, customer.address2).catch(() => {});
  await fillByPlaceholder(page, /kod pocztowy|kod/i, customer.postcode);
  await fillByPlaceholder(page, /miasto/i, customer.city);
  await fillPhoneNumber(page, customer.phone);

  const continueButton = page.getByRole('button', { name: /Kontynuuj|Dalej/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  const isShippingOrPaymentReady = async () => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    return /Metoda wysyłki|Metoda wysylki|Wybierz sposób dostawy|Wybierz sposob dostawy|Jak chcesz zapłacić\?|Jak chcesz zaplacic\?/i.test(bodyText);
  };

  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });

  const advancedToShipping = await expect
    .poll(isShippingOrPaymentReady, { timeout: 20000 })
    .toBeTruthy()
    .then(() => true)
    .catch(() => false);

  if (!advancedToShipping) {
    await expect
      .poll(async () => await isAddressFormReady(page), { timeout: 3000 })
      .toBeTruthy()
      .catch(() => {});

    if (await isAddressFormReady(page)) {
      await clickContinueButton(continueButton);
    }

    await expect
      .poll(isShippingOrPaymentReady, { timeout: 15000 })
      .toBeTruthy();
  }
}

async function waitForShippingAndPaymentStep(page) {
  await expect
    .poll(async () => {
      await closeBlockingPopups(page);
      const loadingVisible = await hasVisibleText(page, /Sprawdzamy Twoje dane|Trwa sprawdzanie danych/i);
      if (loadingVisible) {
        return false;
      }

      const shippingReady = await hasVisibleText(page, /Metoda wysyłki|Metoda wysylki|Wybierz metodę wysyłki|Wybierz metode wysylki/i);
      const paymentReady = await hasVisibleText(page, /Jak chcesz zapłacić\?|Jak chcesz zaplacic\?|Płatność|Platnosc/i);
      return shippingReady || paymentReady;
    }, { timeout: 30000 })
    .toBeTruthy();
}

async function selectShippingMethod(page, shippingLabel) {
  const shippingPattern = new RegExp(escapeRegExp(shippingLabel), 'i');
  const visibleShippingText = await findFirstVisibleLocator(page.getByText(shippingPattern));
  expect(visibleShippingText, `Visible shipping method "${shippingLabel}" was not found.`).toBeTruthy();

  const candidates = [
    page.getByRole('radio', { name: shippingPattern }),
    page.getByLabel(shippingPattern),
    page.locator('label').filter({ hasText: shippingPattern }),
    page.getByText(shippingPattern),
  ];

  for (const candidate of candidates) {
    const visibleCandidate = await findFirstVisibleLocator(candidate);
    if (!visibleCandidate) {
      continue;
    }

    const type = (await visibleCandidate.getAttribute('type').catch(() => '')) ?? '';
    if (type.toLowerCase() === 'radio') {
      await visibleCandidate.check({ force: true }).catch(() => {});
    }

    await clickSelectableCandidate(visibleCandidate);
    await page.waitForTimeout(1000);

    if (await isShippingMethodSelected(page, shippingLabel)) {
      return;
    }
  }

  throw new Error(`Shipping method "${shippingLabel}" was not selectable.`);
}

async function isShippingMethodSelected(page, shippingLabel) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return new RegExp(escapeRegExp(shippingLabel), 'i').test(bodyText);
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

async function assertCodVisibility(page, expectedVisible) {
  const codLocator = await findVisibleCodLocator(page);

  if (expectedVisible) {
    expect(codLocator, 'PL COD payment option was not visible.').toBeTruthy();
    await expect(codLocator).toBeVisible({ timeout: 15000 });
    return;
  }

  expect(codLocator).toBeFalsy();
}

async function assertPolishCodVisibility(page, expectedVisible) {
  let visibleShippingMethod = null;

  for (const shippingLabel of COD_COMPATIBLE_SHIPPING_METHODS) {
    await openShippingStep(page);

    const shippingOption = await findFirstVisibleLocator(page.getByText(new RegExp(escapeRegExp(shippingLabel), 'i')));
    if (!shippingOption) {
      continue;
    }

    await selectShippingMethod(page, shippingLabel);
    await continueToPaymentStep(page);

    if (await findVisibleCodLocator(page)) {
      visibleShippingMethod = shippingLabel;
      break;
    }
  }

  if (expectedVisible) {
    expect(visibleShippingMethod, 'PL checkout did not expose COD for any supported shipping method.').toBeTruthy();
    await assertCodVisibility(page, true);
    return;
  }

  expect(visibleShippingMethod, `PL checkout exposed COD above the limit via "${visibleShippingMethod}".`).toBeFalsy();
}

async function continueToPaymentStep(page) {
  const isPaymentStepVisible = async () => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    return /Jak chcesz zapłacić\?|Jak chcesz zaplacic\?|Dane te zostaną wykorzystane do dokonania płatności|Dane te zostana wykorzystane do dokonania platnosci|Dokonaj płatności|Dokonaj platnosci|Zapłać gotówką przy odbiorze|Zapl[aą]c got[oó]wk[aą] przy odbiorze/i.test(bodyText);
  };

  if (await isPaymentStepVisible()) {
    return;
  }

  const continueButton = page.getByRole('button', { name: /Kontynuuj|Dalej/i }).last();
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
    page.getByText(/^Metoda wysyłki$|^Metoda wysylki$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Metoda wysyłki$|^Metoda wysylki$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Metoda wysyłki$|^Metoda wysylki$/i }).first(),
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
      return /Metoda wysyłki|Metoda wysylki|Wybierz metodę wysyłki|Wybierz metode wysylki/i.test(bodyText);
    }, { timeout: 15000 })
    .toBeTruthy();
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
  await closeMenuOverlay(page);

  const desktopMenuLink = page.locator('#desktop-nav').getByRole('link', { name: /^Wszystkie produkty$/i }).first();
  const categoryNavLink = page.locator('main nav').getByRole('link', { name: /^Wszystkie produkty$/i }).first();
  const fallbackAllProductsLink = page.locator('a[href*="/wszystkie/"]').filter({ hasText: /^Wszystkie produkty$/i }).first();

  if (await desktopMenuLink.isVisible().catch(() => false)) {
    await clickAndWaitForUrl(page, desktopMenuLink, /\/wszystkie\/?$/i);
  } else {
    await expect(categoryNavLink).toBeVisible({ timeout: 15000 }).catch(() => {});
    const reachedAllProducts = await clickAndWaitForUrl(page, categoryNavLink, /\/wszystkie\/?$/i);

    if (!reachedAllProducts && await fallbackAllProductsLink.isVisible().catch(() => false)) {
      await clickAndWaitForUrl(page, fallbackAllProductsLink, /\/wszystkie\/?$/i);
    }
  }

  if (!/\/wszystkie\/?$/i.test(page.url())) {
    await page.goto(new URL(ALL_PRODUCTS_PATH, BASE_URL).href, { waitUntil: 'domcontentloaded' });
  }

  await expect(page).toHaveURL(/\/wszystkie\/?$/i);
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
  await closeMenuOverlay(page);
  await closeCartDialog(page);
  await expect(productCard).toBeVisible({ timeout: 15000 });
  await productCard.scrollIntoViewIfNeeded();
  await productCard.locator('button.add-to-cart').click({ force: true });

  await expectCartCount(page, expectedCartCount);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (expectedCartCount < 2) {
    await closeBlockingPopups(page);
    await closeMenuOverlay(page);
    await closeCartDialog(page);
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

async function closeBlockingPopups(page) {
  const popupContainers = [
    'dialog#discount-popup',
    'dialog[open]',
    '[role="dialog"]',
    '.modal.show',
    '.popup.show',
    '#newsletter_popup',
    '.newsletter-popup',
    '.newsletter-modal',
    '[id*="newsletter" i]',
    '[class*="newsletter" i]',
  ];

  const closeButtons = [
    'button.close-dialog-icon[aria-label="Zamknij"]',
    'button[aria-label="Zamknij"]',
    'button[aria-label="Close"]',
    'button[title="Close"]',
    'button[title="Zamknij"]',
    'button.close-modal',
    'button.close',
    'button[class*="close" i]',
    '.mfp-close',
    '.modal-close',
    '.newsletter-close',
    '[class*="close" i]',
    '[data-dismiss="modal"]',
  ];

  for (const containerSelector of popupContainers) {
    const container = page.locator(containerSelector).first();
    if (!(await container.isVisible().catch(() => false))) {
      continue;
    }

    for (const buttonSelector of closeButtons) {
      const button = container.locator(buttonSelector).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click({ force: true }).catch(async () => {
          await button.evaluate(element => element.click()).catch(() => {});
        });
        break;
      }
    }

    if (await container.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
}

async function fillField(page, labelPatterns, value) {
  for (const pattern of labelPatterns) {
    const textbox = page.getByRole('textbox', { name: pattern }).first();
    if (await textbox.isVisible().catch(() => false)) {
      await textbox.fill(value);
      return;
    }

    const field = page.getByLabel(pattern).first();
    if (await field.isVisible().catch(() => false)) {
      await field.fill(value);
      return;
    }

    const placeholderField = page.getByPlaceholder(pattern).first();
    if (await placeholderField.isVisible().catch(() => false)) {
      await placeholderField.fill(value);
      return;
    }
  }

  throw new Error(`Field not found for patterns: ${labelPatterns}`);
}

async function fillByPlaceholder(page, pattern, value) {
  const fields = page.getByPlaceholder(pattern);
  const count = await fields.count();

  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);
    if (await field.isVisible().catch(() => false)) {
      await field.fill(value);
      return;
    }
  }

  throw new Error(`Visible placeholder field not found for pattern: ${pattern}`);
}

async function fillPhoneNumber(page, value) {
  const candidates = [
    page.getByLabel(/Telefon/i).first(),
    page.getByPlaceholder(/telefon/i).first(),
    page.locator('input[type="tel"]').first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.fill(value);
      return;
    }
  }

  throw new Error('Phone field not found.');
}

async function chooseIndividualCustomerType(page) {
  const candidates = [
    page.getByText(/Indywidualny klient/i).first(),
    page.getByLabel(/Indywidualny klient/i).first(),
    page.getByRole('radio', { name: /Indywidualny klient/i }).first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ force: true }).catch(() => {});
      return;
    }
  }
}

async function hasVisibleSelectOption(page, label) {
  const option = page.getByRole('option', { name: new RegExp(escapeRegExp(label), 'i') }).first();
  return await option.isVisible().catch(() => false);
}

async function selectVisibleOption(page, label) {
  const selects = page.locator('select');
  const count = await selects.count();

  for (let index = 0; index < count; index += 1) {
    const select = selects.nth(index);
    if (!(await select.isVisible().catch(() => false))) {
      continue;
    }

    await select.selectOption({ label }).catch(() => {});
  }
}

async function isAddressFormReady(page) {
  const markers = [
    page.getByPlaceholder(/wprowadź adres$|adres$/i).first(),
    page.getByPlaceholder(/kod pocztowy|kod/i).first(),
    page.getByPlaceholder(/miasto/i).first(),
  ];

  for (const marker of markers) {
    if (await marker.isVisible().catch(() => false)) {
      return true;
    }
  }

  return false;
}

async function findVisibleContinueButton(page) {
  const candidates = [
    page.getByRole('button', { name: /Kontynuuj|Dalej/i }).last(),
    page.getByText(/Kontynuuj|Dalej/i).last(),
  ];

  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  throw new Error('Continue button not found.');
}

async function clickContinueButton(button) {
  await button.click({ force: true }).catch(async () => {
    await button.evaluate(element => element.click()).catch(async () => {
      await button.press('Enter').catch(() => {});
    });
  });
}

async function hasVisibleText(page, pattern) {
  return await page.getByText(pattern).first().isVisible().catch(() => false);
}

async function clickSelectableCandidate(locator) {
  await locator.click({ force: true }).catch(async () => {
    await locator.evaluate(element => {
      let current = element;

      while (current && current !== document.body) {
        const htmlElement = current;
        const style = window.getComputedStyle(htmlElement);
        const role = htmlElement.getAttribute('role');

        if (style.cursor === 'pointer' || role === 'button' || role === 'radio' || htmlElement.tagName === 'LABEL') {
          htmlElement.click();
          return;
        }

        current = htmlElement.parentElement;
      }

      element.click();
    }).catch(async () => {
      await locator.dispatchEvent('click').catch(() => {});
    });
  });
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

function createUniqueEmail(baseEmail) {
  const [localPart, domain] = baseEmail.split('@');
  return `${localPart}+${Date.now()}${Math.floor(Math.random() * 1000)}@${domain}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
