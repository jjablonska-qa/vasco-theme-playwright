import { test, expect } from '@playwright/test';

test.setTimeout(180000);
test.describe.configure({ mode: 'serial' });

const BASE_URL = 'https://vasco-electronics.sk/';
const ALL_PRODUCTS_PATH = '/vsetky-produkty/';
const CHECKOUT_PATH = '/objednavka';
const CART_PATH = '/nakupny-kosik?action=show';
const PRODUCT_Q1 = { id: '38' };

const COD_COMPATIBLE_SHIPPING_METHODS = [
  'Slovenská Pošta - doručenie na adresu',
  'Slovenska Posta - dorucenie na adresu',
  'UPS Standard',
  'UPS Express',
];

const COD_PAYMENT_PATTERNS = [
  /Platba na dobierku/i,
  /Platba dobierkou/i,
  /Dobierka/i,
];

const SK_CUSTOMER = {
  firstName: 'Automat',
  lastName: 'Test',
  email: 'testcases.web@gmail.com',
  phone: '0903123456',
  address1: 'Námestie SNP 12',
  address2: '12',
  postcode: '811 06',
  city: 'Bratislava',
  country: 'Slovensko',
};

const scenarios = [
  { quantity: 1, expectedCodVisible: true, label: 'ponizej limitu COD' },
  { quantity: 2, expectedCodVisible: true, label: 'na limicie COD' },
  { quantity: 3, expectedCodVisible: false, label: 'powyzej limitu COD' },
];

for (const scenario of scenarios) {
  test(`SK COD dla ${scenario.quantity}x Q1 jest ${scenario.expectedCodVisible ? 'widoczne' : 'ukryte'} - ${scenario.label}`, async ({ page, browserName }) => {
    await seedCartWithQ1Quantity(page, scenario.quantity);
    await goToCheckout(page);
    await completePersonalInformation(page, browserName);
    await completeAddress(page, SK_CUSTOMER);
    await waitForShippingAndPaymentStep(page);
    await assertSlovakCodVisibility(page, scenario.expectedCodVisible);
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

  await expect(page).toHaveURL(/\/objednavka/i);
  await expect(page.getByText(/Osobné údaje|Osobne udaje|Osobné informácie|Osobne informacie/i).first()).toBeVisible({ timeout: 20000 });
}

async function completePersonalInformation(page, browserName) {
  await fillField(page, [/^Krstné meno|^Krstne meno/i], SK_CUSTOMER.firstName);
  await fillField(page, [/^Priezvisko/i], SK_CUSTOMER.lastName);
  await fillField(page, [/E-mailová adresa|E-mailova adresa|E-mail/i], createUniqueEmail(SK_CUSTOMER.email));

  for (const label of [/zmluvnými podmienkami|zmluvnymi podmienkami|Obchodné podmienky|Obchodne podmienky/i, /Zásady ochrany osobných údajov|Zasady ochrany osobnych udajov|ochranu osobných údajov|ochranu osobnych udajov/i]) {
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
    .poll(async () => await isAddressFormReady(page), { timeout: 15000 })
    .toBeTruthy()
    .catch(() => {});

  if (await isAddressFormReady(page)) {
    return;
  }

  const addressStepUrl = new URL(`${CHECKOUT_PATH}?id_address=0`, BASE_URL).href;
  await page.goto(addressStepUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1000);

  const addressStepTargets = [
    page.getByText(/^Adresy$|^Adresa$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Adresy$|^Adresa$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Adresy$|^Adresa$/i }).first(),
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
  await fillByPlaceholder(page, /meno/i, customer.firstName);
  await fillByPlaceholder(page, /priezvisko/i, customer.lastName);
  await fillByPlaceholder(page, /ulica|názov ulice|nazov ulice|ulica a číslo domu|ulica a cislo domu/i, customer.address1);
  await fillByPlaceholder(page, /číslo domu|cislo domu|súpisné číslo|supisne cislo|orientačné číslo|orientacne cislo/i, customer.address2).catch(() => {});
  await fillByPlaceholder(page, /psč|psc|poštové smerovacie číslo|postove smerovacie cislo/i, customer.postcode);
  await fillByPlaceholder(page, /mesto|obec/i, customer.city);
  await fillPhoneNumber(page, customer.phone);

  const continueButton = page.getByRole('button', { name: /Pokračovať|Pokracovat/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });
}

async function waitForShippingAndPaymentStep(page) {
  await expect
    .poll(async () => {
      await closeBlockingPopups(page);
      const loadingVisible = await hasVisibleText(page, /Čakajte prosím|Cakajte prosim|Kontrolujeme vaše údaje|Kontrolujeme vase udaje/i);
      if (loadingVisible) {
        return false;
      }

      const shippingReady = await hasVisibleText(page, /Vyberte si spôsob doručenia|Vyberte si sposob dorucenia|Vyberte spôsob dopravy|Vyberte sposob dopravy/i);
      const paymentReady = await hasVisibleText(page, /Ako chcete zaplatiť|Ako chcete zaplatit|Ako by ste chceli zaplatiť|Ako by ste chceli zaplatit/i);
      return shippingReady || paymentReady;
    }, { timeout: 30000 })
    .toBeTruthy();
}

async function selectShippingMethod(page, shippingLabel) {
  const shippingPattern = new RegExp(escapeRegExp(shippingLabel), 'i');
  const visibleShippingText = await findFirstVisibleLocator(page.getByText(shippingPattern));
  if (!visibleShippingText) {
    await expandShippingCarrier(page, shippingLabel);
    await page.waitForTimeout(500);
  }

  const shippingTextAfterExpand = await findFirstVisibleLocator(page.getByText(shippingPattern));
  const targetShippingText = shippingTextAfterExpand ?? visibleShippingText;
  if (!targetShippingText) {
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
    return true;
  }

  return false;
}

async function expandShippingCarrier(page, shippingLabel) {
  const carrierPatterns = [];

  if (/Slovensk[aá]\s+Po[sš]ta/i.test(shippingLabel)) {
    carrierPatterns.push(/^Slovenská Pošta$|^Slovenska Posta$/i);
  }

  if (/UPS/i.test(shippingLabel)) {
    carrierPatterns.push(/^UPS Standard$/i, /^UPS Express$/i);
  }

  if (/GLS/i.test(shippingLabel)) {
    carrierPatterns.push(/^GLS$/i);
  }

  for (const pattern of carrierPatterns) {
    const carrier = page.getByText(pattern).first();
    if (await carrier.isVisible().catch(() => false)) {
      await clickSelectableCandidate(carrier);
      await page.waitForTimeout(500);
    }
  }
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
    expect(codLocator, 'SK COD payment option was not visible.').toBeTruthy();
    await expect(codLocator).toBeVisible({ timeout: 15000 });
    return;
  }

  expect(codLocator).toBeFalsy();
}

async function assertSlovakCodVisibility(page, expectedVisible) {
  if (!expectedVisible) {
    await continueToPaymentStep(page).catch(() => false);
    await assertCodVisibility(page, false);
    return;
  }

  let visibleShippingMethod = null;

  for (const shippingLabel of COD_COMPATIBLE_SHIPPING_METHODS) {
    await openShippingStep(page);

    const shippingSelected = await selectShippingMethod(page, shippingLabel);
    if (!shippingSelected) {
      continue;
    }

    const paymentOpened = await continueToPaymentStep(page);
    if (!paymentOpened) {
      continue;
    }

    if (await findVisibleCodLocator(page)) {
      visibleShippingMethod = shippingLabel;
      break;
    }
  }

  if (expectedVisible) {
    expect(visibleShippingMethod, 'SK checkout did not expose COD for any supported shipping method.').toBeTruthy();
    await assertCodVisibility(page, true);
    return;
  }

  expect(visibleShippingMethod, `SK checkout exposed COD above the limit via "${visibleShippingMethod}".`).toBeFalsy();
}

async function continueToPaymentStep(page) {
  const isPaymentStepVisible = async () => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    return /Ako chcete zaplatiť|Ako chcete zaplatit|Ako by ste chceli zaplatiť|Ako by ste chceli zaplatit|Tieto údaje budú použité na platbu|Tieto udaje budu pouzite na platbu|Platba na dobierku|Dobierka/i.test(bodyText);
  };

  if (await isPaymentStepVisible()) {
    return true;
  }

  const continueButton = page.getByRole('button', { name: /Pokračovať|Pokracovat/i }).last();
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
    page.getByText(/^Spôsob doručenia$|^Sposob dorucenia$|^Doprava$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Spôsob doručenia$|^Sposob dorucenia$|^Doprava$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Spôsob doručenia$|^Sposob dorucenia$|^Doprava$/i }).first(),
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
      return /Vyberte si spôsob doručenia|Vyberte si sposob dorucenia|Vyberte spôsob dopravy|Vyberte sposob dopravy/i.test(bodyText);
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
  const desktopMenuLink = page.locator(`#desktop-nav a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const mainMenuLink = page.getByRole('link', { name: /Všetky produkty|Vsetky produkty/i }).first();
  const visibleAllProductsLink = page.locator(`a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const shopMenuItem = page.getByRole('menuitem', { name: /obchod|prekladače|prekladace|výrobky|vyrobky/i }).first();

  if (await desktopMenuLink.isVisible().catch(() => false)) {
    await clickAndWaitForUrl(page, desktopMenuLink, /\/vsetky-produkty\/?$/i);
  } else {
    if (await shopMenuItem.isVisible().catch(() => false)) {
      await shopMenuItem.hover().catch(() => {});
      await shopMenuItem.click().catch(() => {});
      await closeBlockingPopups(page);
    }

    if (await mainMenuLink.isVisible().catch(() => false)) {
      await clickAndWaitForUrl(page, mainMenuLink, /\/vsetky-produkty\/?$/i);
    }

    if (!/\/vsetky-produkty\/?$/i.test(page.url()) && (await visibleAllProductsLink.isVisible().catch(() => false))) {
      await clickAndWaitForUrl(page, visibleAllProductsLink, /\/vsetky-produkty\/?$/i);
    }
  }

  if (!/\/vsetky-produkty\/?$/i.test(page.url())) {
    await page.goto(new URL(ALL_PRODUCTS_PATH, BASE_URL).href, { waitUntil: 'domcontentloaded' });
  }

  await expect(page).toHaveURL(/\/vsetky-produkty\/?$/i);
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
  await closeBlockingPopups(page);
  await closeCartDialog(page);
  await closeMenuOverlay(page);
}

async function expectCartCount(page, expectedCartCount) {
  await expect
    .poll(async () => {
      const headerText = await headerCartLink(page).innerText().catch(() => '');
      if (headerText.includes(String(expectedCartCount))) {
        return true;
      }

      const titleText = (await headerCartLink(page).getAttribute('title').catch(() => '')) ?? '';
      if (titleText.includes(String(expectedCartCount))) {
        return true;
      }

      const badgeText = await page.locator('#header .cart-products-count, #header .cart-count, #header .ajax_cart_quantity').first().innerText().catch(() => '');
      return badgeText.includes(String(expectedCartCount));
    }, { timeout: 15000 })
    .toBeTruthy();
}

async function closeCartDialog(page) {
  const blockCartDialog = cartDialog(page);
  if (!(await blockCartDialog.isVisible().catch(() => false))) {
    return;
  }

  const closeButton = blockCartDialog.getByRole('button', { name: /Zavrieť|Zavriet|Close/i }).first();

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
  const popupSelectors = [
    'dialog#discount-popup',
    '#blockcart-modal',
    'dialog[open]',
    '[role="dialog"]',
    '.modal.show',
    '.popup.show',
  ];

  const closeSelectors = [
    'button.close-dialog-icon[aria-label="Zavrieť"]',
    'button.close-dialog-icon[aria-label="Zavriet"]',
    'button[aria-label="Zavrieť"]',
    'button[aria-label="Zavriet"]',
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
      const saleText = popup.getByText(/sale|zľava|zlava|akcia/i).first();
      if (await saleText.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
  }
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
  if (!(await candidate.isVisible().catch(() => false))) {
    return false;
  }

  const tagName = await candidate.evaluate(element => element.tagName.toLowerCase()).catch(() => '');
  if (!['input', 'textarea'].includes(tagName)) {
    return false;
  }

  const type = ((await candidate.getAttribute('type').catch(() => '')) ?? '').toLowerCase();
  return !['radio', 'checkbox', 'hidden', 'submit', 'button'].includes(type);
}

async function setFieldValue(field, value) {
  await field.fill('').catch(() => {});
  await field.fill(value).catch(async () => {
    await field.click({ force: true }).catch(() => {});
    await field.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await field.press('Backspace').catch(() => {});
    await field.type(value, { delay: 20 }).catch(() => {});
  });
}

async function fillPhoneNumber(page, value) {
  const candidates = [
    page.locator('input[type="tel"]').last(),
    page.getByRole('textbox', { name: /Telefón|Telefon/i }).last(),
    page.getByLabel(/Telefón|Telefon/i).last(),
    page.getByPlaceholder(/telefón|telefon/i).last(),
  ];

  for (const candidate of candidates) {
    if (await isFillableField(candidate)) {
      await setFieldValue(candidate, value);
      return;
    }
  }

  throw new Error('Phone field not found.');
}

async function chooseIndividualCustomerType(page) {
  const candidates = [
    page.getByText(/Súkromná osoba|Sukromna osoba|Fyzická osoba|Fyzicka osoba|Jednotlivec/i).first(),
    page.getByLabel(/Súkromná osoba|Sukromna osoba|Fyzická osoba|Fyzicka osoba|Jednotlivec/i).first(),
    page.getByRole('radio', { name: /Súkromná osoba|Sukromna osoba|Fyzická osoba|Fyzicka osoba|Jednotlivec/i }).first(),
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
    page.getByPlaceholder(/ulica|názov ulice|nazov ulice|ulica a číslo domu|ulica a cislo domu/i).first(),
    page.getByPlaceholder(/psč|psc|poštové smerovacie číslo|postove smerovacie cislo/i).first(),
    page.getByPlaceholder(/mesto|obec/i).first(),
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
    page.getByRole('button', { name: /Pokračovať|Pokracovat/i }).last(),
    page.getByText(/Pokračovať|Pokracovat/i).last(),
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
