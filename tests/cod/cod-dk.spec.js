import { test, expect } from '@playwright/test';

test.setTimeout(120000);
test.describe.configure({ mode: 'serial' });

const BASE_URL = 'https://vasco-translator.dk/';
const ALL_PRODUCTS_PATH = '/alle-produkter/';
const CHECKOUT_PATH = '/ordre';
const CART_PATH = '/kurv?action=show';
const PRODUCT_Q1 = { id: '38' };

const SHIPPING_METHOD_LABEL = 'Express levering (kontant ved levering)';
const COD_PAYMENT_LABEL = 'Betal ved levering';

const DK_CUSTOMER = {
  firstName: 'Automat',
  lastName: 'Test',
  email: 'testcases.web@gmail.com',
  phone: '888123456',
  address1: 'Norre Voldgade',
  address2: '123',
  postcode: '1358',
  city: 'Kobenhavn',
  country: 'Danmark',
};

const scenarios = [
  { quantity: 1, expectedCodVisible: true, label: 'ponizej limitu COD' },
  { quantity: 2, expectedCodVisible: true, label: 'na limicie COD' },
  { quantity: 3, expectedCodVisible: false, label: 'powyzej limitu COD' },
];

for (const scenario of scenarios) {
  test(`DK COD dla ${scenario.quantity}x Q1 jest ${scenario.expectedCodVisible ? 'widoczne' : 'ukryte'} - ${scenario.label}`, async ({ page, browserName }) => {
    test.slow(browserName === 'firefox');
    await seedCartWithQ1Quantity(page, scenario.quantity);
    await goToCheckout(page);
    await completePersonalInformation(page, browserName);
    await completeAddress(page, DK_CUSTOMER);
    await waitForShippingAndPaymentStep(page);
    await selectShippingMethod(page, SHIPPING_METHOD_LABEL);
    await continueToPaymentStep(page);
    await assertCodVisibility(page, scenario.expectedCodVisible);
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
  const checkoutUrl = new URL(CHECKOUT_PATH, BASE_URL).href;
  await safeGoto(page, checkoutUrl);
  if (!/\/ordre/i.test(page.url())) {
    await safeGoto(page, checkoutUrl);
  }
  await dismissCookieBanner(page);
  await closeBlockingPopups(page);

  await expect(page).toHaveURL(/\/ordre/i);
  await expect(page.getByText(/Personlige oplysninger|Dine oplysninger/i).first()).toBeVisible({ timeout: 20000 });
}

async function completePersonalInformation(page, browserName) {
  await fillField(page, [/^Fornavn/i], DK_CUSTOMER.firstName);
  await fillField(page, [/^Efternavn|^Navn/i], DK_CUSTOMER.lastName);
  await fillField(page, [/Mailadresse|E-mail/i], createUniqueEmail(DK_CUSTOMER.email));

  for (const label of [/servicevilkar|servicevilkår|servicevilkarene|servicevilkårene|vilkar og betingelser|vilkår og betingelser|betingelser/i, /privatlivspolitik|privatlivspolitikken|persondatapolitik/i]) {
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
    page.getByText(/^Adresser$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Adresser$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Adresser$/i }).first(),
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
  await fillByPlaceholder(page, /fornavn/i, customer.firstName);
  await fillByPlaceholder(page, /efternavn|navn/i, customer.lastName);
  await fillByPlaceholder(page, /^indtast adresse$|^adresse$/i, customer.address1);
  await fillByPlaceholder(page, /adressekomplement|adresse 2|yderligere adresse|husnr/i, customer.address2).catch(() => {});
  await fillByPlaceholder(page, /postnummer/i, customer.postcode);
  await fillByPlaceholder(page, /by/i, customer.city);
  await fillPhoneNumber(page, customer.phone);

  const continueButton = page.getByRole('button', { name: /Fortsæt|Videre/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });
}

async function waitForShippingAndPaymentStep(page) {
  await expect
    .poll(async () => {
      await closeBlockingPopups(page);
      const loadingVisible = await hasVisibleText(page, /Vi kontrollerer dine oplysninger|Vi verificerer dine oplysninger/i);
      if (loadingVisible) {
        return false;
      }

      const shippingReady = await hasVisibleText(page, /Vælg venligst en leveringsmetode|Vaelg venligst en leveringsmetode|Vælg leveringsmetode|Vaelg leveringsmetode|Vælg fragtmetode|Vaelg fragtmetode/i);
      const paymentReady = await hasVisibleText(page, /Hvordan ønsker du at betale\?|Hvordan vil du gerne betale|Vælg betalingsmetode|Vaelg betalingsmetode/i);
      return shippingReady || paymentReady;
    }, { timeout: 30000 })
    .toBeTruthy();
}

async function selectShippingMethod(page, shippingLabel) {
  await expect(page.getByText(new RegExp(escapeRegExp(shippingLabel), 'i')).first()).toBeVisible({ timeout: 15000 });

  const candidates = [
    page.getByRole('radio', { name: new RegExp(escapeRegExp(shippingLabel), 'i') }).first(),
    page.getByLabel(new RegExp(escapeRegExp(shippingLabel), 'i')).first(),
    page.locator('label').filter({ hasText: new RegExp(escapeRegExp(shippingLabel), 'i') }).first(),
    page.getByText(new RegExp(escapeRegExp(shippingLabel), 'i')).first(),
  ];

  for (const candidate of candidates) {
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    const type = (await candidate.getAttribute('type').catch(() => '')) ?? '';
    if (type.toLowerCase() === 'radio') {
      await candidate.check({ force: true }).catch(() => {});
    }

    await candidate.click({ force: true }).catch(async () => {
      await candidate.dispatchEvent('click').catch(() => {});
    });
    await page.waitForTimeout(1000);

    if (await isShippingMethodSelected(page, shippingLabel)) {
      return;
    }
  }

  throw new Error(`Shipping method "${shippingLabel}" was not selectable.`);
}

async function isShippingMethodSelected(page, shippingLabel) {
  const selectedRadio = page.locator('input[type="radio"]:checked').filter({
    has: page.locator(`xpath=following::label[contains(normalize-space(.), "${shippingLabel}")][1]`),
  }).first();

  if (await selectedRadio.isVisible().catch(() => false)) {
    return true;
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  return new RegExp(escapeRegExp(shippingLabel), 'i').test(bodyText);
}

async function assertCodVisibility(page, expectedVisible) {
  const codLocator = page.getByText(new RegExp(escapeRegExp(COD_PAYMENT_LABEL), 'i')).first();

  if (expectedVisible) {
    await expect(codLocator).toBeVisible({ timeout: 15000 });
    return;
  }

  await expect
    .poll(async () => await codLocator.isVisible().catch(() => false), { timeout: 5000 })
    .toBeFalsy();
}

async function continueToPaymentStep(page) {
  const continueButton = page.getByRole('button', { name: /Fortsæt|Videre/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });

  await expect
    .poll(async () => {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return /Hvordan ønsker du at betale\?|Hvordan vil du gerne betale|Vælg betalingsmetode|Vaelg betalingsmetode/i.test(bodyText);
    }, { timeout: 30000 })
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
  const mainMenuLink = page.getByRole('link', { name: /Alle produkter/i }).first();
  const visibleAllProductsLink = page.locator(`a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const shopMenuItem = page.getByRole('menuitem', { name: /butik|oversaettere|produkter/i }).first();

  if (await desktopMenuLink.isVisible().catch(() => false)) {
    await clickAndWaitForUrl(page, desktopMenuLink, /\/alle-produkter\/?$/i);
  } else {
    if (await shopMenuItem.isVisible().catch(() => false)) {
      await shopMenuItem.hover().catch(() => {});
      await shopMenuItem.click().catch(() => {});
      await closeBlockingPopups(page);
    }

    if (await mainMenuLink.isVisible().catch(() => false)) {
      await clickAndWaitForUrl(page, mainMenuLink, /\/alle-produkter\/?$/i);
    }

    if (!/\/alle-produkter\/?$/i.test(page.url()) && (await visibleAllProductsLink.isVisible().catch(() => false))) {
      await clickAndWaitForUrl(page, visibleAllProductsLink, /\/alle-produkter\/?$/i);
    }

    if (!/\/alle-produkter\/?$/i.test(page.url())) {
      await Promise.all([
        page.waitForURL(/\/alle-produkter\/?$/i, { timeout: 15000 }),
        page
          .evaluate(() => {
            const target = Array.from(document.querySelectorAll('a')).find(link => {
              const href = link.getAttribute('href') || '';
              const rect = link.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0;
              return href.includes('/alle-produkter/') && visible;
            });

            if (target) target.click();
          })
          .catch(() => {}),
      ]).catch(() => {});
    }
  }

  if (!/\/alle-produkter\/?$/i.test(page.url())) {
    await safeGoto(page, new URL(ALL_PRODUCTS_PATH, BASE_URL).href);
  }

  await expect(page).toHaveURL(/\/alle-produkter\/?$/i);
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
  await closeBlockingPopups(page);
  await closeCartDialog(page);
  await closeMenuOverlay(page);
}

async function closeCartDialog(page) {
  const blockCartDialog = cartDialog(page);
  if (!(await blockCartDialog.isVisible().catch(() => false))) {
    return;
  }

  const closeButton = blockCartDialog.getByRole('button', { name: /Luk|Close/i }).first();

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
    'button.close-dialog-icon[aria-label="Luk"]',
    'button.close-dialog-icon[aria-label="Zamknij"]',
    'button[aria-label="Luk"]',
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
      const saleText = popup.getByText(/sale|tilbud|rabat/i).first();
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

async function findVisibleContinueButton(page) {
  const genericPrestashopButton = page.locator('button[name="continue"][data-link-action="register-new-customer"]').first();
  if (await genericPrestashopButton.isVisible().catch(() => false)) {
    return genericPrestashopButton;
  }

  const buttons = page.getByRole('button', { name: /Fortsæt|Videre/i });
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
  if (await hasVisibleText(page, /Hvad er din faktureringsadresse\?/i)) {
    return true;
  }

  return (
    (await hasVisibleFieldForPattern(page, /^indtast adresse$|^adresse$/i)) ||
    (await hasVisibleFieldForPattern(page, /postnummer/i))
  );
}

async function chooseIndividualCustomerType(page) {
  const individualTargets = [
    page.getByRole('radio', { name: /Enkeltperson|Privatkunde|Privatperson/i }).first(),
    page.getByLabel(/Enkeltperson|Privatkunde|Privatperson/i).first(),
    page.locator('label').filter({ hasText: /Enkeltperson|Privatkunde|Privatperson/i }).first(),
    page.getByText(/Enkeltperson|Privatkunde|Privatperson/i).first(),
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
    if (await isFillableField(candidate)) {
      return true;
    }
  }

  return false;
}

async function hasVisibleText(page, pattern) {
  const matches = page.getByText(pattern);
  const count = await matches.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    if (await matches.nth(index).isVisible().catch(() => false)) {
      return true;
    }
  }

  return false;
}

async function fillPhoneNumber(page, value) {
  const candidates = [
    page.getByRole('textbox', { name: /Mobiltelefon|Telefon/i }).last(),
    page.getByLabel(/Mobiltelefon|Telefon/i).last(),
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
    if (!(await select.isVisible().catch(() => false))) {
      continue;
    }

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

    if (hasOption) {
      return true;
    }
  }

  return false;
}

async function selectVisibleOption(page, value) {
  const selects = page.locator('select, [role="combobox"]');
  const selectCount = await selects.count();

  for (let index = selectCount - 1; index >= 0; index -= 1) {
    const select = selects.nth(index);
    if (!(await select.isVisible().catch(() => false))) {
      continue;
    }

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

        if (!matchingOption) {
          return false;
        }

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
  if (atIndex === -1) {
    return email;
  }

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const baseLocalPart = localPart.split('+')[0];
  const suffix = `dkcod${Date.now().toString(36)}`;
  return `${baseLocalPart}+${suffix}@${domain}`;
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
    if (currentValue === value || normalizeDigits(currentValue) === targetDigits) {
      return;
    }

    await field.press('Meta+a').catch(() => {});
    await field.press('Control+a').catch(() => {});
    await field.press('Backspace').catch(() => {});
    await field.type(value, { delay: 20 }).catch(() => {});

    const typedValue = await field.inputValue().catch(() => null);
    if (typedValue === value || normalizeDigits(typedValue) === targetDigits) {
      return;
    }
  }

  throw new Error(`Could not set field value to "${value}".`);
}
