import { test, expect } from '@playwright/test';

test.setTimeout(180000);
test.describe.configure({ mode: 'serial' });

const BASE_URL = 'https://vasco-electronics.ro/';
const ALL_PRODUCTS_PATH = '/toate-produsele/';
const CHECKOUT_PATH = '/comanda';
const CART_PATH = '/cos?action=show';
const PRODUCT_Q1 = { id: '38' };

const COD_COMPATIBLE_SHIPPING_METHODS = [
  'Urgent Cargus',
  'Fan Courier',
  'DHL Express Economy Select',
  'DHL Express Worldwide',
  'Sameday Easybox - punct de ridicare',
];

const COD_PAYMENT_PATTERNS = [
  /Plata la livrare/i,
  /Numerar la livrare/i,
  /Plata ramburs/i,
  /Ramburs/i,
];

const RO_CUSTOMER = {
  firstName: 'Automat',
  lastName: 'Test',
  email: 'testcases.web@gmail.com',
  phone: '0712345678',
  address1: 'Strada Lipscani 12',
  address2: '2',
  postcode: '030167',
  city: 'Bucuresti',
  county: 'Bucuresti',
  country: 'România',
};

const scenarios = [
  { quantity: 1, expectedCodVisible: true, label: 'ponizej limitu COD' },
  { quantity: 2, expectedCodVisible: true, label: 'na limicie COD' },
  { quantity: 3, expectedCodVisible: false, label: 'powyzej limitu COD' },
];

for (const scenario of scenarios) {
  test(`RO COD dla ${scenario.quantity}x Q1 jest ${scenario.expectedCodVisible ? 'widoczne' : 'ukryte'} - ${scenario.label}`, async ({ page, browserName }) => {
    await seedCartWithQ1Quantity(page, scenario.quantity);
    await goToCheckout(page);
    await completePersonalInformation(page, browserName);
    await completeAddress(page, RO_CUSTOMER);
    await waitForShippingAndPaymentStep(page);
    await assertRomanianCodVisibility(page, scenario.expectedCodVisible);
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

  await expect(page).toHaveURL(/\/comanda/i);
  await expect(page.getByText(/Date personale|Informații personale|Informatii personale/i).first()).toBeVisible({ timeout: 20000 });
}

async function completePersonalInformation(page, browserName) {
  await fillField(page, [/Prenume/i], RO_CUSTOMER.firstName);
  await fillField(page, [/^Nume/i], RO_CUSTOMER.lastName);
  await fillField(page, [/E-mail|Email/i], createUniqueEmail(RO_CUSTOMER.email));

  for (const label of [/Termenii și condițiile|Termenii si conditiile|Termeni și condiții|Termeni si conditii/i, /Politica de confidențialitate|Politica de confidentialitate/i]) {
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
    page.getByText(/^Adrese$|^Adresă$|^Adresa$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Adrese$|^Adresă$|^Adresa$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Adrese$|^Adresă$|^Adresa$/i }).first(),
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
  await fillField(page, [/Prenume/i], customer.firstName);
  await fillField(page, [/^Nume/i], customer.lastName);
  await fillByPlaceholder(page, /enter adresa|adresa \( str\. si nr\.\)|adres/i, customer.address1);
  await fillByPlaceholder(page, /detalii suplimentare|completare adres|adresa 2|apartament|etaj/i, customer.address2).catch(() => {});
  await fillByPlaceholder(page, /cod poștal|cod postal|poștal|postal/i, customer.postcode);
  await fillByPlaceholder(page, /oraș|oras|localitate/i, customer.city);
  if (await completeCountyAndPhoneByKeyboard(page, customer.county, customer.phone)) {
    await page.waitForTimeout(300);
  } else {
  await selectCounty(page, customer.county).catch(() => {});
  await fillPhoneNumber(page, customer.phone);
  }

  const continueButton = page.getByRole('button', { name: /Continuă|Continua/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });

  await expect
    .poll(async () => {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return /Alege metoda de livrare|Cum doriți să plătiți|Cum doriti sa platiti/i.test(bodyText);
    }, { timeout: 20000 })
    .toBeTruthy()
    .catch(async () => {
      await clickContinueButton(continueButton);
      await expect
        .poll(async () => {
          const bodyText = await page.locator('body').innerText().catch(() => '');
          return /Alege metoda de livrare|Cum doriți să plătiți|Cum doriti sa platiti/i.test(bodyText);
        }, { timeout: 15000 })
        .toBeTruthy();
    });
}

async function waitForShippingAndPaymentStep(page) {
  await expect
    .poll(async () => {
      await closeBlockingPopups(page);
      const loadingVisible = await hasVisibleText(page, /Verificăm datele dvs|Verificam datele dvs/i);
      if (loadingVisible) {
        return false;
      }

      const shippingReady = await hasVisibleText(page, /Alege metoda de livrare/i);
      const paymentReady = await hasVisibleText(page, /Cum doriți să plătiți|Cum doriti sa platiti/i);
      return shippingReady || paymentReady;
    }, { timeout: 30000 })
    .toBeTruthy();
}

async function selectShippingMethod(page, shippingLabel) {
  const shippingPattern = new RegExp(escapeRegExp(shippingLabel), 'i');
  const visibleShippingText = await findFirstVisibleLocator(page.getByText(shippingPattern));
  if (!visibleShippingText) {
    return false;
  }

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
    return await isShippingContinueEnabled(page);
  }

  return false;
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
    expect(codLocator, 'RO COD payment option was not visible.').toBeTruthy();
    await expect(codLocator).toBeVisible({ timeout: 15000 });
    return;
  }

  expect(codLocator).toBeFalsy();
}

async function assertRomanianCodVisibility(page, expectedVisible) {
  let visibleShippingMethod = await findVisibleRomanianCodShippingMethod(page);

  if (!visibleShippingMethod && expectedVisible) {
    await page.waitForTimeout(1000);
    visibleShippingMethod = await findVisibleRomanianCodShippingMethod(page);
  }

  if (expectedVisible) {
    expect(visibleShippingMethod, 'RO checkout did not expose COD for any supported shipping method.').toBeTruthy();
    await assertCodVisibility(page, true);
    return;
  }

  expect(visibleShippingMethod, `RO checkout exposed COD above the limit via "${visibleShippingMethod}".`).toBeFalsy();
}

async function findVisibleRomanianCodShippingMethod(page) {
  for (const shippingLabel of COD_COMPATIBLE_SHIPPING_METHODS) {
    await openShippingStep(page);

    const shippingOption = await findFirstVisibleLocator(page.getByText(new RegExp(escapeRegExp(shippingLabel), 'i')));
    if (!shippingOption) {
      continue;
    }

    const shippingSelected = await selectShippingMethod(page, shippingLabel);
    if (!shippingSelected) {
      continue;
    }

    const paymentOpened = await continueToPaymentStep(page);
    if (!paymentOpened) {
      continue;
    }

    if (await findVisibleCodLocator(page)) {
      return shippingLabel;
    }
  }

  return null;
}

async function continueToPaymentStep(page) {
  const isPaymentStepVisible = async () => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    return /Cum doriți să plătiți|Cum doriti sa platiti|Aceste date vor fi utilizate pentru plată|Aceste date vor fi utilizate pentru plata|Efectuează plata|Efectueaza plata|Numerar la livrare|Plata la livrare|Plata ramburs/i.test(bodyText);
  };

  if (await isPaymentStepVisible()) {
    return true;
  }

  const continueButton = page.getByRole('button', { name: /Continuă|Continua/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  if (!(await continueButton.isEnabled().catch(() => false))) {
    return false;
  }

  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });

  return await expect
    .poll(isPaymentStepVisible, { timeout: 30000 })
    .toBeTruthy()
    .then(() => true)
    .catch(() => false);
}

async function openShippingStep(page) {
  const shippingStepTargets = [
    page.getByText(/^Metoda de livrare$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Metoda de livrare$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Metoda de livrare$/i }).first(),
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
      return /Alege metoda de livrare/i.test(bodyText);
    }, { timeout: 15000 })
    .toBeTruthy();
}

async function isShippingContinueEnabled(page) {
  const continueButton = page.getByRole('button', { name: /Continuă|Continua/i }).last();
  if (!(await continueButton.isVisible().catch(() => false))) {
    return false;
  }

  return await continueButton.isEnabled().catch(() => false);
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

  const desktopMenuLink = page.locator(`#desktop-nav a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const mainMenuLink = page.getByRole('link', { name: /Toate produsele/i }).first();
  const visibleAllProductsLink = page.locator(`a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const shopMenuItem = page.getByRole('menuitem', { name: /magazin|translator|produse/i }).first();

  if (await desktopMenuLink.isVisible().catch(() => false)) {
    await clickAndWaitForUrl(page, desktopMenuLink, /\/toate-produsele\/?$/i);
  } else {
    if (await shopMenuItem.isVisible().catch(() => false)) {
      await shopMenuItem.hover().catch(() => {});
      await shopMenuItem.click().catch(() => {});
      await closeBlockingPopups(page);
    }

    if (await mainMenuLink.isVisible().catch(() => false)) {
      await clickAndWaitForUrl(page, mainMenuLink, /\/toate-produsele\/?$/i);
    }

    if (!/\/toate-produsele\/?$/i.test(page.url()) && (await visibleAllProductsLink.isVisible().catch(() => false))) {
      await clickAndWaitForUrl(page, visibleAllProductsLink, /\/toate-produsele\/?$/i);
    }
  }

  if (!/\/toate-produsele\/?$/i.test(page.url())) {
    await page.goto(new URL(ALL_PRODUCTS_PATH, BASE_URL).href, { waitUntil: 'domcontentloaded' });
  }

  await expect(page).toHaveURL(/\/toate-produsele\/?$/i);
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
  const addToCartButton = productCard.locator('button.add-to-cart');
  await addToCartButton.click({ timeout: 5000 }).catch(async () => {
    await addToCartButton.click({ force: true });
  });
  await expectCartCount(page, expectedCartCount);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (expectedCartCount < 2) {
    await closeBlockingPopups(page);
    await closeCartDialog(page);
    await closeMenuOverlay(page);
  }
}

async function expectCartCount(page, expectedCartCount) {
  const cartLinkByName = page.getByRole('link', { name: new RegExp(`Coș\\s*${expectedCartCount}|Cos\\s*${expectedCartCount}`, 'i') }).first();
  if (await cartLinkByName.isVisible().catch(() => false)) {
    await expect(cartLinkByName).toBeVisible({ timeout: 15000 });
    return;
  }

  const countIsUpdated = async () => {
    const headerText = await headerCartLink(page).innerText().catch(() => '');
    if (headerText.includes(String(expectedCartCount))) return true;

    const titleText = (await headerCartLink(page).getAttribute('title').catch(() => '')) ?? '';
    if (titleText.includes(String(expectedCartCount))) return true;

    const badgeText = await page.locator('#header .cart-products-count, #header .cart-count, #header .ajax_cart_quantity').first().innerText().catch(() => '');
    return badgeText.includes(String(expectedCartCount));
  };

  const isUpdatedWithoutRefresh = await expect.poll(countIsUpdated, { timeout: 5000 }).toBeTruthy().then(() => true).catch(() => false);
  if (isUpdatedWithoutRefresh) return;

  // Firefox can keep a stale header badge after the second add-to-cart action.
  // Refreshing reads the already persisted cart state without adding another item.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(countIsUpdated, { timeout: 15000 }).toBeTruthy();
}

async function closeCartDialog(page) {
  const blockCartDialog = cartDialog(page);
  if (!(await blockCartDialog.isVisible().catch(() => false))) return;

  const closeButton = blockCartDialog.getByRole('button', { name: /Închide|Inchide|Close/i }).first();
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
    page.locator('button[aria-label="Închide"], button[aria-label="Inchide"], button[aria-label="Close"]').first(),
    page.getByRole('button', { name: /închide|inchide|close|mai târziu|mai tarziu|skip/i }).first(),
  ];

  for (const button of popupCloseButtons) {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(async () => {
        await button.evaluate(element => element.click()).catch(() => {});
      });
    }
  }

  await closeSurveyOverlay(page);
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
  const filledFromDom = await page
    .evaluate(nextValue => {
      const candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'));
      const matcher = /telefon|phone|712\s*034\s*567/i;

      const getCandidateText = element => {
        const htmlElement = element;
        const parts = [
          htmlElement.getAttribute('placeholder') ?? '',
          htmlElement.getAttribute('aria-label') ?? '',
          htmlElement.getAttribute('role') ?? '',
          htmlElement.getAttribute('name') ?? '',
          htmlElement.getAttribute('id') ?? '',
          htmlElement.textContent ?? '',
          htmlElement.parentElement?.textContent ?? '',
        ];

        if ('labels' in htmlElement && htmlElement.labels) {
          parts.push(...Array.from(htmlElement.labels).map(label => label.textContent ?? ''));
        }

        return parts.join(' ');
      };

      const phoneField = candidates.find(element => matcher.test(getCandidateText(element)));
      if (!phoneField) {
        return false;
      }

      phoneField.scrollIntoView({ block: 'center' });
      phoneField.focus?.();

      if ('value' in phoneField) {
        phoneField.value = '';
        phoneField.value = nextValue;
      } else if (phoneField.isContentEditable) {
        phoneField.textContent = nextValue;
      } else if (phoneField.getAttribute('role') === 'textbox') {
        phoneField.textContent = nextValue;
      } else {
        return false;
      }

      phoneField.dispatchEvent(new Event('input', { bubbles: true }));
      phoneField.dispatchEvent(new Event('change', { bubbles: true }));
      phoneField.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }, value)
    .catch(() => false);

  if (filledFromDom) {
    return;
  }

  const candidates = [
    page.getByRole('textbox', { name: /Telefon/i }),
    page.getByLabel(/Telefon/i),
    page.getByPlaceholder(/712\s*034\s*567/i),
    page.locator('input[placeholder*="712"]'),
    page.locator('input[aria-label*="Telefon" i]'),
    page.locator('input[name*="phone" i], input[id*="phone" i]'),
    page.locator('input[type="tel"]'),
  ];

  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);
    if (!count) {
      continue;
    }

    for (let index = count - 1; index >= 0; index -= 1) {
      const input = candidate.nth(index);
      await input.scrollIntoViewIfNeeded().catch(() => {});

      try {
        await input.fill(value);
        return;
      } catch {}

      try {
        await input.click({ force: true });
        await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
        await input.press('Backspace').catch(() => {});
        await input.type(value, { delay: 20 });
        return;
      } catch {}

      const didSetValue = await input
        .evaluate((element, nextValue) => {
          const inputElement = element;
          inputElement.focus?.();
          if ('value' in inputElement) {
            inputElement.value = '';
            inputElement.value = nextValue;
          } else if (inputElement.isContentEditable) {
            inputElement.textContent = nextValue;
          } else {
            return false;
          }

          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, value)
        .catch(() => false);

      if (didSetValue) {
        return;
      }
    }
  }

  const phoneDebug = await page
    .evaluate(() => {
      return Array.from(document.querySelectorAll('input, textarea, select, label, p, div, span, [role], button'))
        .map(element => {
          const text = [
            element.tagName,
            element.getAttribute('type') ?? '',
            element.getAttribute('role') ?? '',
            element.getAttribute('name') ?? '',
            element.getAttribute('id') ?? '',
            element.getAttribute('placeholder') ?? '',
            element.getAttribute('aria-label') ?? '',
            element.textContent ?? '',
          ]
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

          return text;
        })
        .filter(text => /telefon|phone|712|040|40\b/i.test(text))
        .slice(0, 30);
    })
    .catch(() => []);

  throw new Error(`Phone field not found. Debug: ${phoneDebug.join(' || ')}`);
}

async function completeCountyAndPhoneByKeyboard(page, county, phone) {
  await page.keyboard.press('Tab').catch(() => {});
  await page.waitForTimeout(200);

  const countyFocused = await page
    .evaluate(() => {
      const activeElement = document.activeElement;
      if (!activeElement) {
        return false;
      }

      const text = [
        activeElement.tagName,
        activeElement.getAttribute('role') ?? '',
        activeElement.getAttribute('aria-label') ?? '',
        activeElement.getAttribute('placeholder') ?? '',
        activeElement.parentElement?.textContent ?? '',
      ]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      return /judet|select/i.test(text) || activeElement.tagName === 'SELECT';
    })
    .catch(() => false);

  if (!countyFocused) {
    return false;
  }

  await page.keyboard.type(county, { delay: 20 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(300);
  await page.keyboard.press('Tab').catch(() => {});
  await page.waitForTimeout(150);

  const maybeCountryCodeButton = await page
    .evaluate(() => {
      const activeElement = document.activeElement;
      if (!activeElement) {
        return false;
      }

      const text = [
        activeElement.tagName,
        activeElement.getAttribute('role') ?? '',
        activeElement.getAttribute('aria-label') ?? '',
        activeElement.textContent ?? '',
      ]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      return /\+40|țara selectată|tara selectata/i.test(text);
    })
    .catch(() => false);

  if (maybeCountryCodeButton) {
    await page.keyboard.press('Tab').catch(() => {});
    await page.waitForTimeout(150);
  }

  const phoneFocused = await page
    .evaluate(() => {
      const activeElement = document.activeElement;
      if (!activeElement) {
        return false;
      }

      const text = [
        activeElement.tagName,
        activeElement.getAttribute('role') ?? '',
        activeElement.getAttribute('aria-label') ?? '',
        activeElement.getAttribute('placeholder') ?? '',
        activeElement.parentElement?.textContent ?? '',
      ]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      return /telefon|712\s*034\s*567/i.test(text);
    })
    .catch(() => false);

  if (!phoneFocused) {
    return false;
  }

  await page.keyboard.type(phone, { delay: 20 }).catch(() => {});
  return true;
}

async function chooseIndividualCustomerType(page) {
  const candidates = [
    page.getByText(/Client individual|Persoană fizică|Persoana fizica|Individual/i).first(),
    page.getByLabel(/Client individual|Persoană fizică|Persoana fizica|Individual/i).first(),
    page.getByRole('radio', { name: /Client individual|Persoană fizică|Persoana fizica|Individual/i }).first(),
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

async function selectCounty(page, label) {
  const selectedInDom = await page
    .evaluate(nextLabel => {
      const selects = Array.from(document.querySelectorAll('select'));
      const target = selects.find(select => {
        const labels = select.labels ? Array.from(select.labels).map(label => label.textContent ?? '') : [];
        const parentText = select.parentElement?.textContent ?? '';
        return /judet/i.test(`${labels.join(' ')} ${parentText}`);
      });

      if (!target) {
        return false;
      }

      const option = Array.from(target.options).find(entry => entry.text.trim().toLowerCase() === nextLabel.toLowerCase());
      if (!option) {
        return false;
      }

      target.value = option.value;
      option.selected = true;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, label)
    .catch(() => false);

  if (selectedInDom) {
    await page.waitForTimeout(300);
    return;
  }

  const countyContainer = page.locator('p').filter({ hasText: /^Judet\*?$/i }).locator('..');
  const countySelect = countyContainer.locator('select').first();

  if (await countySelect.count().catch(() => 0)) {
    await countySelect.scrollIntoViewIfNeeded().catch(() => {});
    await countySelect.selectOption({ label }).catch(() => {});
    await countySelect.dispatchEvent('change').catch(() => {});
    await page.waitForTimeout(300);

    const selectedText = await countySelect.locator('option:checked').first().innerText().catch(() => '');
    if (new RegExp(escapeRegExp(label), 'i').test(selectedText)) {
      return;
    }
  }

  const selects = page.locator('select');
  const count = await selects.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const select = selects.nth(index);
    if (!(await select.isVisible().catch(() => false))) {
      continue;
    }

    await select.selectOption({ label }).catch(() => {});
    await select.dispatchEvent('change').catch(() => {});
    await page.waitForTimeout(300);

    const selectedText = await select.locator('option:checked').first().innerText().catch(() => '');
    if (new RegExp(escapeRegExp(label), 'i').test(selectedText)) {
      return;
    }
  }
}

async function isAddressFormReady(page) {
  const markers = [
    page.getByPlaceholder(/enter adresa|adresa \( str\. si nr\.\)|adres/i).first(),
    page.getByPlaceholder(/cod poștal|cod postal|poștal|postal/i).first(),
    page.getByPlaceholder(/oraș|oras|localitate/i).first(),
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
    page.getByRole('button', { name: /Continuă|Continua/i }).last(),
    page.getByText(/Continuă|Continua/i).last(),
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
