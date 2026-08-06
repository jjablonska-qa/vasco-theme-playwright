import { test, expect } from '@playwright/test';

test.setTimeout(180000);
test.describe.configure({ mode: 'serial' });

const BASE_URL = 'https://vasco-translator.be/fr/';
const ALL_PRODUCTS_PATH = '/fr/tous-les-produits/';
const CHECKOUT_PATH = '/commande';
const CART_PATH = '/fr/panier?action=show';
const PRODUCT_Q1 = { id: '38' };

const SHIPPING_METHOD_LABEL = 'UPS Standard';
const COD_PAYMENT_LABEL = 'Payer comptant à la livraison';

const BE_FR_CUSTOMER = {
  firstName: 'Automat',
  lastName: 'Test',
  email: 'testcases.web@gmail.com',
  phone: '0470123456',
  address1: 'Rue Neuve 123',
  address2: '2',
  postcode: '1000',
  city: 'Bruxelles',
  country: 'Belgique',
};

const scenarios = [
  { quantity: 1, expectedCodVisible: true, label: 'ponizej limitu COD' },
  { quantity: 2, expectedCodVisible: true, label: 'na limicie COD' },
  { quantity: 3, expectedCodVisible: false, label: 'powyzej limitu COD' },
];

for (const scenario of scenarios) {
  test(`BE FR COD dla ${scenario.quantity}x Q1 jest ${scenario.expectedCodVisible ? 'widoczne' : 'ukryte'} - ${scenario.label}`, async ({ page, browserName }) => {
    await skipWhenStoreUnavailable(page, BASE_URL, 'BE FR store is currently unreachable from the test environment.');
    await seedCartWithQ1Quantity(page, scenario.quantity);
    await goToCheckout(page);
    await completePersonalInformation(page, browserName);
    await completeAddress(page, BE_FR_CUSTOMER);
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
  await safeGoto(page, new URL(CHECKOUT_PATH, BASE_URL).href);
  await dismissCookieBanner(page);
  await closeBlockingPopups(page);

  await expect(page).toHaveURL(/\/commande/i);
  await expect(page.getByText(/Informations personnelles|Vos informations/i).first()).toBeVisible({ timeout: 20000 });
}

async function completePersonalInformation(page, browserName) {
  await fillField(page, [/^Prénom|^Prenom/i], BE_FR_CUSTOMER.firstName);
  await fillField(page, [/^Nom/i], BE_FR_CUSTOMER.lastName);
  await fillField(page, [/E-mail|Email/i], createUniqueEmail(BE_FR_CUSTOMER.email));

  for (const label of [/Conditions générales|Conditions d'utilisation/i, /Politique de confidentialité/i]) {
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

  if (await isAddressFormReady(page)) {
    return;
  }

  const addressStepTargets = [
    page.getByText(/^Adresses$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Adresses$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Adresses$/i }).first(),
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

  await expect
    .poll(async () => await isAddressFormReady(page), { timeout: 10000 })
    .toBeTruthy()
    .catch(() => {});

  if (await isAddressFormReady(page)) {
    return;
  }

  throw new Error('Address step did not open.');
}

async function completeAddress(page, customer) {
  if (await hasVisibleSelectOption(page, customer.country)) {
    await selectVisibleOption(page, customer.country).catch(() => {});
    await page.waitForTimeout(300);
  }

  await chooseIndividualCustomerType(page);
  await fillByPlaceholder(page, /prénom|prenom/i, customer.firstName);
  await fillByPlaceholder(page, /nom/i, customer.lastName);
  await fillByPlaceholder(page, /^enter adresse$|^adresse$/i, customer.address1);
  await fillByPlaceholder(page, /complément d'adresse|complement d'adresse/i, customer.address2).catch(() => {});
  await fillByPlaceholder(page, /code postal/i, customer.postcode);
  await fillByPlaceholder(page, /^enter ville$|^ville$/i, customer.city);
  await fillPhoneNumber(page, customer.phone);

  const continueButton = page.getByRole('button', { name: /Continuer/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });
}

async function waitForShippingAndPaymentStep(page) {
  await expect
    .poll(async () => {
      await closeBlockingPopups(page);
      const loadingVisible = await hasVisibleText(page, /Nous vérifions vos données|Vérification de vos données/i);
      if (loadingVisible) {
        return false;
      }

      const shippingReady = await hasVisibleText(page, /Choisissez votre mode de livraison|Mode de livraison|Méthode de livraison/i);
      const paymentReady = await hasVisibleText(page, /Comment souhaitez-vous payer|Paiement/i);
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
  const continueButton = page.getByRole('button', { name: /Continuer/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });

  await expect
    .poll(async () => {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return /Comment souhaitez-vous payer|Paiement/i.test(bodyText);
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
    await safeGoto(page, new URL(ALL_PRODUCTS_PATH, 'https://vasco-translator.be').href);
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
    page.locator('#newsletter_popup .close, #newsletter_popup button[aria-label="Close"], #newsletter_popup button[aria-label="Fermer"]').first(),
    page.locator('.modal-dialog .btn-close, .modal-dialog button[aria-label="Close"], .modal-dialog button[aria-label="Fermer"]').first(),
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

  const buttons = page.getByRole('button', { name: /Continuer/i });
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
  if (await hasVisibleText(page, /Quelle est votre adresse de facturation\?/i)) {
    return true;
  }

  return (
    (await hasVisibleFieldForPattern(page, /^enter adresse$|^adresse$/i)) ||
    (await hasVisibleFieldForPattern(page, /code postal/i))
  );
}

async function chooseIndividualCustomerType(page) {
  const individualTargets = [
    page.getByRole('radio', { name: /Client individuel|Particulier/i }).first(),
    page.getByLabel(/Client individuel|Particulier/i).first(),
    page.locator('label').filter({ hasText: /Client individuel|Particulier/i }).first(),
    page.getByText(/Client individuel|Particulier/i).first(),
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
    page.getByRole('textbox', { name: /Téléphone|Telephone/i }).last(),
    page.getByLabel(/Téléphone|Telephone/i).last(),
    page.locator('input[type="tel"]').last(),
    page.locator('input[name*="phone" i], input[id*="phone" i], input[name*="telephone" i], input[id*="telephone" i], input[name*="tel" i], input[id*="tel" i]').last(),
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

async function safeGoto(page, url, options = {}) {
  let lastError;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', ...options });
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (/403 Forbidden/i.test(bodyText)) {
        throw new Error(`Received 403 page for ${url}`);
      }
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1500 * (attempt + 1)).catch(() => {});
    }
  }

  throw lastError;
}

async function skipWhenStoreUnavailable(page, url, message) {
  const reachable = await canOpenStore(page, url);
  test.skip(!reachable, message);
}

async function canOpenStore(page, url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (/403 Forbidden|Unable to connect/i.test(bodyText)) {
        throw new Error('Store returned an unavailable page');
      }
      return true;
    } catch {
      await page.waitForTimeout(1500 * (attempt + 1)).catch(() => {});
    }
  }

  return false;
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
