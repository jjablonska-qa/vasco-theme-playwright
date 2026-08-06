import { test, expect } from '@playwright/test';

test.setTimeout(180000);
test.describe.configure({ mode: 'serial' });

const BASE_URL = 'https://vasco-translator.pt/';
const ALL_PRODUCTS_PATH = '/todos-produtos/';
const CHECKOUT_PATH = '/encomenda';
const CART_PATH = '/carrinho?action=show';
const PRODUCT_Q1 = { id: '38' };

const COD_COMPATIBLE_SHIPPING_METHODS = [
  'UPS Express 24/48h (contra reembolso)',
];

const COD_PAYMENT_PATTERNS = [
  /Pagamento contra reembolso/i,
  /Pagar contra reembolso/i,
  /Pagamento na entrega/i,
  /Pagar na entrega/i,
  /Contra reembolso/i,
];

const PT_CUSTOMER = {
  firstName: 'Automat',
  lastName: 'Test',
  email: 'testcases.web@gmail.com',
  phone: '912345678',
  address1: 'Rua do Comercio 128',
  address2: '2',
  postcode: '1100-150',
  city: 'Lisboa',
  country: 'Portugal',
};

const scenarios = [
  { quantity: 1, expectedCodVisible: true, label: 'ponizej limitu COD' },
  { quantity: 2, expectedCodVisible: false, label: 'na limicie COD - obecne zachowanie checkoutu' },
  { quantity: 3, expectedCodVisible: false, label: 'powyzej limitu COD' },
];

for (const scenario of scenarios) {
  test(`PT COD dla ${scenario.quantity}x Q1 jest ${scenario.expectedCodVisible ? 'widoczne' : 'ukryte'} - ${scenario.label}`, async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'PT checkout cart counter is currently unstable on Firefox.');
    await seedCartWithQ1Quantity(page, scenario.quantity);
    await goToCheckout(page);
    await completePersonalInformation(page, browserName);
    await completeAddress(page, PT_CUSTOMER);
    await waitForShippingAndPaymentStep(page);
    await assertPortugueseCodVisibility(page, scenario.expectedCodVisible);
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

  await expect(page).toHaveURL(/\/encomenda/i);
  await expect(page.getByText(/Informações pessoais|Informação pessoal/i).first()).toBeVisible({ timeout: 20000 });
}

async function completePersonalInformation(page, browserName) {
  await fillField(page, [/^Nome/i], PT_CUSTOMER.firstName);
  await fillField(page, [/^Apelido|^Sobrenome/i], PT_CUSTOMER.lastName);
  await fillField(page, [/E-mail|Email/i], createUniqueEmail(PT_CUSTOMER.email));

  for (const label of [/Termos de Serviço|Termos e condições|Termos e condicoes|condições|condicoes/i, /Política de Privacidade|Politica de Privacidade|privacidade/i]) {
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
    page.getByText(/^Endereços$|^Enderecos$|^Endereço$|^Endereco$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Endereços$|^Enderecos$|^Endereço$|^Endereco$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Endereços$|^Enderecos$|^Endereço$|^Endereco$/i }).first(),
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
  await fillByPlaceholder(page, /nome/i, customer.firstName);
  await fillByPlaceholder(page, /apelido|sobrenome/i, customer.lastName);
  await fillByPlaceholder(page, /^introduzir endereço$|^introduzir endereco$|^endereço$|^endereco$/i, customer.address1);
  await fillByPlaceholder(page, /complemento do endereço|complemento do endereco|morada 2|complemento/i, customer.address2).catch(() => {});
  await fillByPlaceholder(page, /código postal|codigo postal/i, customer.postcode);
  await fillByPlaceholder(page, /cidade|localidade/i, customer.city);
  await fillPhoneNumber(page, customer.phone);

  const continueButton = page.getByRole('button', { name: /Continuar/i }).last();
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click({ force: true }).catch(async () => {
    await clickContinueButton(continueButton);
  });

  await expect
    .poll(async () => {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return /Método de envio|Metodo de envio|Escolha o seu método de envio|Escolha o seu metodo de envio|Como deseja pagar\?/i.test(bodyText);
    }, { timeout: 20000 })
    .toBeTruthy()
    .catch(async () => {
      await clickContinueButton(continueButton);
      await expect
        .poll(async () => {
          const bodyText = await page.locator('body').innerText().catch(() => '');
          return /Método de envio|Metodo de envio|Escolha o seu método de envio|Escolha o seu metodo de envio|Como deseja pagar\?/i.test(bodyText);
        }, { timeout: 15000 })
        .toBeTruthy();
    });
}

async function waitForShippingAndPaymentStep(page) {
  await expect
    .poll(async () => {
      await closeBlockingPopups(page);
      const loadingVisible = await hasVisibleText(page, /Por favor, aguarde.*verificar os seus dados|Estamos a verificar os seus dados/i);
      if (loadingVisible) {
        return false;
      }

      const shippingReady = await hasVisibleText(page, /Método de envio|Metodo de envio|Escolha o seu método de envio|Escolha o seu metodo de envio/i);
      const paymentReady = await hasVisibleText(page, /Como deseja pagar\?/i);
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
    return;
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
    expect(codLocator, 'PT COD payment option was not visible.').toBeTruthy();
    await expect(codLocator).toBeVisible({ timeout: 15000 });
    return;
  }

  expect(codLocator).toBeFalsy();
}

async function assertPortugueseCodVisibility(page, expectedVisible) {
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
    expect(visibleShippingMethod, 'PT checkout did not expose COD for any supported shipping method.').toBeTruthy();
    await assertCodVisibility(page, true);
    return;
  }

  expect(visibleShippingMethod, `PT checkout exposed COD above the limit via "${visibleShippingMethod}".`).toBeFalsy();
}

async function continueToPaymentStep(page) {
  const isPaymentStepVisible = async () => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    return /Como deseja pagar\?|Estes dados serão usados para o pagamento|Estes dados serao usados para o pagamento|Efetuar pagamento|Efetuar pagament|contra reembolso/i.test(bodyText);
  };

  if (await isPaymentStepVisible()) {
    return;
  }

  const continueButton = page.getByRole('button', { name: /Continuar/i }).last();
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
    page.getByText(/^Método de envio$|^Metodo de envio$/i).first(),
    page.locator('[role="tab"]').filter({ hasText: /^Método de envio$|^Metodo de envio$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^Método de envio$|^Metodo de envio$/i }).first(),
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
      return /Método de envio|Metodo de envio|Escolha o seu método de envio|Escolha o seu metodo de envio/i.test(bodyText);
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

  const desktopMenuLink = page.locator(`#desktop-nav a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const mainMenuLink = page.getByRole('link', { name: /Todos os produtos/i }).first();
  const visibleAllProductsLink = page.locator(`a[href*="${ALL_PRODUCTS_PATH}"]`).first();
  const shopMenuItem = page.getByRole('menuitem', { name: /loja|shop|tradutor|tradutores|produtos/i }).first();

  if (await desktopMenuLink.isVisible().catch(() => false)) {
    await clickAndWaitForUrl(page, desktopMenuLink, /\/todos-produtos\/?$/i);
  } else {
    if (await shopMenuItem.isVisible().catch(() => false)) {
      await shopMenuItem.hover().catch(() => {});
      await shopMenuItem.click().catch(() => {});
      await closeBlockingPopups(page);
    }

    if (await mainMenuLink.isVisible().catch(() => false)) {
      await clickAndWaitForUrl(page, mainMenuLink, /\/todos-produtos\/?$/i);
    }

    if (!/\/todos-produtos\/?$/i.test(page.url()) && (await visibleAllProductsLink.isVisible().catch(() => false))) {
      await clickAndWaitForUrl(page, visibleAllProductsLink, /\/todos-produtos\/?$/i);
    }
  }

  if (!/\/todos-produtos\/?$/i.test(page.url())) {
    await page.goto(new URL(ALL_PRODUCTS_PATH, BASE_URL).href, { waitUntil: 'domcontentloaded' });
  }

  await expect(page).toHaveURL(/\/todos-produtos\/?$/i);
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

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissCookieBanner(page);
    await closeBlockingPopups(page);
    await closeCartDialog(page);
    await closeMenuOverlay(page);
    await addToCartButton.click({ force: true });

    const cartUpdated = await expectCartCount(page, expectedCartCount).then(() => true).catch(() => false);
    if (cartUpdated) {
      break;
    }
  }

  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (expectedCartCount < 2) {
    await closeBlockingPopups(page);
    await closeCartDialog(page);
    await closeMenuOverlay(page);
  }
}

async function expectCartCount(page, expectedCartCount) {
  const cartLinkByName = page
    .getByRole('link', { name: new RegExp(`Carrinho\\s*${expectedCartCount}|Carrinho\\s*de\\s*compras\\s*${expectedCartCount}`, 'i') })
    .first();
  if (await cartLinkByName.isVisible().catch(() => false)) {
    await expect(cartLinkByName).toBeVisible({ timeout: 15000 });
    return;
  }

  await expect
    .poll(async () => {
      const cartLink = headerCartLink(page);
      const linkText = (await cartLink.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      const ariaLabel = (await cartLink.getAttribute('title').catch(() => '')) ?? '';
      const badgeText = (await cartLink.locator('.cart-products-count, .cart-count, .ajax_cart_quantity, *').last().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      return [linkText, ariaLabel, badgeText].some(text => text.includes(String(expectedCartCount)));
    }, { timeout: 15000 })
    .toBeTruthy();
}

async function closeCartDialog(page) {
  const blockCartDialog = cartDialog(page);
  if (!(await blockCartDialog.isVisible().catch(() => false))) return;

  const closeButton = blockCartDialog.getByRole('button', { name: /Fechar|Close/i }).first();
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
        '.survicate-box',
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
    page.locator('#newsletter_popup .close, #newsletter_popup button[aria-label="Fechar"]').first(),
    page.locator('.newsletter-popup .close, .newsletter-popup .mfp-close, .newsletter-popup button').first(),
    page.locator('.modal.show button.close, .popup.show button.close, .modal.show [class*="close"], .popup.show [class*="close"]').first(),
    page.locator('button[aria-label="Fechar"], button[title="Fechar"]').first(),
    page.locator('button[aria-label="Close"], button[title="Close"]').first(),
    page.getByRole('button', { name: /fechar|close|mais tarde|skip/i }).first(),
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
  const candidates = [
    page.getByLabel(/Telefone/i).first(),
    page.getByPlaceholder(/telefone/i).first(),
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
    page.getByText(/Individual|Cliente individual|Particular/i).first(),
    page.getByLabel(/Individual|Cliente individual|Particular/i).first(),
    page.getByRole('radio', { name: /Individual|Cliente individual|Particular/i }).first(),
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
    page.getByPlaceholder(/^introduzir endereço$|^introduzir endereco$|^endereço$|^endereco$/i).first(),
    page.getByPlaceholder(/código postal|codigo postal/i).first(),
    page.getByPlaceholder(/cidade|localidade/i).first(),
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
    page.getByRole('button', { name: /Continuar/i }).last(),
    page.getByText(/Continuar/i).last(),
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
