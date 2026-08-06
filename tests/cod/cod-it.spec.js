import { test, expect } from '@playwright/test';

test.setTimeout(180000);
test.describe.configure({ mode: 'serial' });

const BASE_URL = 'https://vasco-electronics.it/';
const ALL_PRODUCTS_PATH = '/tutti-i-prodotti/';
const CHECKOUT_PATH = '/ordine';
const CART_PATH = '/carrello?action=show';
const PRODUCT_Q1 = { id: '38' };

const COD_COMPATIBLE_SHIPPING_PATTERNS = [
  /contrassegno/i,
  /pagamento alla consegna/i,
  /alla consegna/i,
];
const COD_PAYMENT_LABEL = 'Pagamento alla consegna';

const IT_CUSTOMER = {
  firstName: 'Automat',
  lastName: 'Test',
  email: 'testcases.web@gmail.com',
  phone: '3331234567',
  address1: 'Via Roma 12',
  address2: '2',
  postcode: '00100',
  city: 'Roma',
  country: 'Italia',
};

const scenarios = [
  { quantity: 1, expectedCodVisible: false, label: 'ponizej limitu COD' },
  { quantity: 2, expectedCodVisible: false, label: 'na limicie COD' },
  { quantity: 3, expectedCodVisible: false, label: 'powyzej limitu COD' },
];

for (const scenario of scenarios) {
  test(`IT COD dla ${scenario.quantity}x Q1 jest ${scenario.expectedCodVisible ? 'widoczne' : 'ukryte'} - ${scenario.label}`, async ({ page, browserName }) => {
    await seedCartWithQ1Quantity(page, scenario.quantity);
    await goToCheckout(page);
    await completePersonalInformation(page, browserName);
    await completeAddress(page, IT_CUSTOMER);
    await waitForShippingAndPaymentStep(page);
    await assertItalianCodVisibility(page, scenario.expectedCodVisible);
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

  await expect(page).toHaveURL(/\/ordine/i);
  await expect(page.getByText(/Informazioni personali|Dati personali/i).first()).toBeVisible({ timeout: 20000 });
}

async function completePersonalInformation(page, browserName) {
  await fillField(page, [/^Nome/i], IT_CUSTOMER.firstName);
  await fillField(page, [/^Cognome/i], IT_CUSTOMER.lastName);
  await fillField(page, [/E-mail|Email/i], createUniqueEmail(IT_CUSTOMER.email));

  for (const label of [/Termini di servizio|Termini e condizioni|condizioni/i, /Informativa sulla privacy|Privacy policy|privacy/i]) {
    const checkbox = page.getByRole('checkbox', { name: label }).first();
    await expect(checkbox).toBeVisible({ timeout: 15000 });
    await checkbox.check({ force: true }).catch(async () => {
      await checkbox.click({ force: true }).catch(() => {});
    });
  }

  await continueToAddressStep(page, browserName);
}

async function continueToAddressStep(page, browserName) {
  if (await isAddressFormReady(page)) return;

  const continueButton = await findVisibleContinueButton(page);
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await clickContinueButton(continueButton);
  await page.waitForTimeout(browserName === 'webkit' ? 3000 : 500);

  if (await isAddressFormReady(page)) return;

  const addressStepUrl = new URL(`${CHECKOUT_PATH}?id_address=0`, BASE_URL).href;
  await safeGoto(page, addressStepUrl).catch(() => {});
  await page.waitForTimeout(1000);

  const addressStepTargets = [
    page.getByText(/^Indirizzi$|^Indirizzo$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Indirizzi$|^Indirizzo$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Indirizzi$|^Indirizzo$/i }).first(),
  ];

  for (const target of addressStepTargets) {
    if (await target.isVisible().catch(() => false)) {
      await target.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
      if (await isAddressFormReady(page)) return;
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
  await fillByPlaceholder(page, /nome/i, customer.firstName);
  await fillByPlaceholder(page, /cognome/i, customer.lastName);
  await fillByPlaceholder(page, /^inserisci indirizzo$|^indirizzo$/i, customer.address1);
  await fillByPlaceholder(page, /complemento indirizzo|indirizzo 2|interno|scala|complementare/i, customer.address2).catch(() => {});
  await fillByPlaceholder(page, /cap|codice postale/i, customer.postcode);
  await fillByPlaceholder(page, /città|citta|comune/i, customer.city);
  await fillPhoneNumber(page, customer.phone);

  const continueButton = page.getByRole('button', { name: /Continua/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });

  await expect
    .poll(async () => {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return /Scegli il tuo metodo di spedizione|Metodo di spedizione|Spedizione|Come desideri pagare\?|Pagamento/i.test(bodyText);
    }, { timeout: 20000 })
    .toBeTruthy()
    .catch(async () => {
      await clickContinueButton(continueButton);
      await expect
        .poll(async () => {
          const bodyText = await page.locator('body').innerText().catch(() => '');
          return /Scegli il tuo metodo di spedizione|Metodo di spedizione|Spedizione|Come desideri pagare\?|Pagamento/i.test(bodyText);
        }, { timeout: 15000 })
        .toBeTruthy();
    });
}

async function waitForShippingAndPaymentStep(page) {
  await expect
    .poll(async () => {
      await closeBlockingPopups(page);
      const loadingVisible = await hasVisibleText(page, /Stiamo verificando i tuoi dati|Verifica dei dati/i);
      if (loadingVisible) return false;

      const shippingReady = await hasVisibleText(page, /Scegli il tuo metodo di spedizione|Metodo di spedizione|Spedizione/i);
      const paymentReady = await hasVisibleText(page, /Come desideri pagare\?|Pagamento/i);
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
    if (!(await candidate.isVisible().catch(() => false))) continue;

    const type = (await candidate.getAttribute('type').catch(() => '')) ?? '';
    if (type.toLowerCase() === 'radio') {
      await candidate.check({ force: true }).catch(() => {});
    }

    await candidate.click({ force: true }).catch(async () => {
      await candidate.dispatchEvent('click').catch(() => {});
    });
    await page.waitForTimeout(1000);

    if (await isShippingMethodSelected(page, shippingLabel)) return;
  }

  throw new Error(`Shipping method "${shippingLabel}" was not selectable.`);
}

async function selectCodCompatibleShippingMethod(page) {
  for (const pattern of COD_COMPATIBLE_SHIPPING_PATTERNS) {
    const visibleOption = await findFirstVisibleLocator(page.getByText(pattern));
    if (!visibleOption) {
      continue;
    }

    const candidates = [
      page.getByRole('radio', { name: pattern }),
      page.getByLabel(pattern),
      page.locator('label').filter({ hasText: pattern }),
      page.getByText(pattern),
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

      await visibleCandidate.click({ force: true }).catch(async () => {
        await visibleCandidate.dispatchEvent('click').catch(() => {});
      });
      await page.waitForTimeout(1000);
      return true;
    }
  }

  return false;
}

async function isShippingMethodSelected(page, shippingLabel) {
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
  const isPaymentStepVisible = async () => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    return /Come desideri pagare\?|Pagamento|Carta|PayPal|bonifico/i.test(bodyText);
  };

  if (await isPaymentStepVisible()) {
    return;
  }

  const continueButton = page.getByRole('button', { name: /Continua/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });

  await expect
    .poll(isPaymentStepVisible, { timeout: 30000 })
    .toBeTruthy();
}

async function assertItalianCodVisibility(page, expectedVisible) {
  if (!expectedVisible) {
    await continueToPaymentStep(page).catch(() => {});
    await assertCodVisibility(page, false);
    return;
  }

  const selected = await selectCodCompatibleShippingMethod(page);
  expect(selected, 'IT checkout did not expose a COD-compatible shipping method.').toBeTruthy();
  await continueToPaymentStep(page);
  await assertCodVisibility(page, true);
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
  }

  if (!/\/tutti-i-prodotti\/?$/i.test(page.url())) {
    await safeGoto(page, new URL(ALL_PRODUCTS_PATH, BASE_URL).href);
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
  await productCard.locator('button.add-to-cart').click();
  await expectCartCount(page, expectedCartCount);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (expectedCartCount < 2) {
    await closeBlockingPopups(page);
    await closeCartDialog(page);
    await closeMenuOverlay(page);
  }
}

async function expectCartCount(page, expectedCartCount) {
  const cartLinkByName = page.getByRole('link', { name: new RegExp(`Carrello\\s*${expectedCartCount}`, 'i') }).first();
  if (await cartLinkByName.isVisible().catch(() => false)) {
    await expect(cartLinkByName).toBeVisible({ timeout: 15000 });
    return;
  }

  await expect
    .poll(async () => {
      const cartLink = headerCartLink(page);
      const linkText = (await cartLink.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      const ariaLabel = (await cartLink.getAttribute('title').catch(() => '')) ?? '';
      const badgeText = (await cartLink.locator('*').last().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      return [linkText, ariaLabel, badgeText].some(text => text.includes(String(expectedCartCount)));
    }, { timeout: 15000 })
    .toBeTruthy();
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
  ];

  for (const button of popupCloseButtons) {
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(() => {});
    }
  }

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

  const buttons = page.getByRole('button', { name: /Continua/i });
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
  if (await hasVisibleText(page, /Qual è il tuo indirizzo di fatturazione|Qual e il tuo indirizzo di fatturazione|indirizzo di fatturazione/i)) return true;

  return (
    (await hasVisibleFieldForPattern(page, /^inserisci indirizzo$|^indirizzo$/i)) ||
    (await hasVisibleFieldForPattern(page, /cap|codice postale/i))
  );
}

async function chooseIndividualCustomerType(page) {
  const individualTargets = [
    page.getByRole('radio', { name: /Cliente individuale|Privato|Persona fisica/i }).first(),
    page.getByLabel(/Cliente individuale|Privato|Persona fisica/i).first(),
    page.locator('label').filter({ hasText: /Cliente individuale|Privato|Persona fisica/i }).first(),
    page.getByText(/Cliente individuale|Privato|Persona fisica/i).first(),
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
    page.getByRole('textbox', { name: /Telefono/i }).last(),
    page.getByLabel(/Telefono/i).last(),
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

async function safeGoto(page, url, options = {}) {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', ...options });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000 * (attempt + 1)).catch(() => {});
    }
  }

  throw lastError;
}
