import { expect } from '@playwright/test';

const SHORT_TIMEOUT = 5000;
const MEDIUM_TIMEOUT = 10000;
const LONG_TIMEOUT = 20000;
const VIES_TIMEOUT = 30000;
const NAVIGATION_RETRY_DELAY = 1500;
const serialVies = process.env.VIES_SERIAL !== '0';
const debugVies = process.env.DEBUG_VIES === '1';

export function registerViesMarketTests(test, market) {
  test.describe(`${market.key} VIES checkout`, () => {
    if (serialVies) {
      test.describe.configure({ mode: 'serial' });
    }
    test.setTimeout(120000);

    for (const scenario of market.scenarios) {
      test(`Checkout VIES ${scenario.key} - ${scenario.description}`, async ({ page, browserName }) => {
        if (browserName === 'firefox' || browserName === 'webkit') {
          test.setTimeout(180000);
        }

        await runScenario(page, market, scenario, browserName);
      });
    }
  });
}

async function runScenario(page, market, scenario, browserName) {
  const business = createScenarioBusinessData(market, scenario, browserName);
  logViesDebug(market, scenario, 'start');
  await addProductToCart(page, market, market.product, 1);
  logViesDebug(market, scenario, 'added product');

  await gotoWithRetry(page, new URL(market.checkoutPath, market.baseUrl).href, {
    waitUntil: 'domcontentloaded',
  });
  await dismissCookieBanner(page, market);
  await closeBlockingPopups(page, market);
  logViesDebug(market, scenario, 'opened checkout');

  await expect(page).toHaveURL(new RegExp(`/${market.checkoutPath}`, 'i'));
  await expect(page.getByText(market.labels.personalInfoStep).first()).toBeVisible({ timeout: MEDIUM_TIMEOUT });
  await expect(page.getByText(market.labels.addressesStep).first()).toBeVisible({ timeout: MEDIUM_TIMEOUT });
  await expect(page.getByText(market.product.name, { exact: false })).toBeVisible({ timeout: MEDIUM_TIMEOUT });

  const summaryBeforeAddressSave = await readSummary(page, market);
  expect(summaryBeforeAddressSave.total).toBeGreaterThan(0);

  await fillPersonalInformation(page, market, business);
  logViesDebug(market, scenario, 'filled personal info');
  await continueFromPersonalInformation(page, market, browserName);
  logViesDebug(market, scenario, 'continued from personal info');
  await fillAddress(page, market, { ...scenario, business });
  logViesDebug(market, scenario, 'filled address');
  await submitBillingAddress(page, market);
  logViesDebug(market, scenario, 'submitted address');
  if (scenario.skipValidationWait || !market.forceValidationWait) {
    await page.waitForLoadState('domcontentloaded', { timeout: SHORT_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(250);
    logViesDebug(market, scenario, 'skipped validation wait');
  } else {
    await waitForViesValidation(page, market);
    logViesDebug(market, scenario, 'validated VIES / advanced');
  }

  const summaryAfterAddressSave = await readSummary(page, market);
  await assertScenarioOutcome(page, market, scenario, summaryBeforeAddressSave, summaryAfterAddressSave, browserName);
  logViesDebug(market, scenario, 'asserted outcome');
}

function createScenarioBusinessData(market, scenario, browserName) {
  const business = { ...scenario.business };

  if (business.email) {
    business.email = createUniqueEmailAlias(business.email, market, scenario, browserName);
  }

  return business;
}

function createUniqueEmailAlias(email, market, scenario, browserName) {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) {
    return email;
  }

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const baseLocalPart = localPart.split('+')[0];
  const suffix = `${market.key}-${scenario.key}-${browserName}-${Date.now().toString(36)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);

  return `${baseLocalPart}+${suffix}@${domain}`;
}

async function fillPersonalInformation(page, market, business) {
  await fillField(page, [market.labels.firstName], business.firstName);
  await fillField(page, [market.labels.lastName], business.lastName);
  await fillField(page, [market.labels.email], business.email);

  for (const label of [market.labels.terms, market.labels.privacy]) {
    await closeBlockingPopups(page, market);
    const checkbox = page.getByRole('checkbox', { name: label }).first();
    await expect(checkbox).toBeVisible({ timeout: MEDIUM_TIMEOUT });
    await checkbox.check({ timeout: SHORT_TIMEOUT }).catch(async () => {
      await closeBlockingPopups(page, market);
      await checkbox.check({ force: true }).catch(async () => {
        await checkbox.click({ force: true }).catch(() => {});
      });
    });
    logViesDebug(market, { key: 'personal-info' }, `checkbox ${String(label)} checked=${await checkbox.isChecked().catch(() => false)}`);
  }

  if (debugVies) {
    const continueButton = await findVisibleContinueButton(page, market);
    const disabled = await continueButton.isDisabled().catch(() => false);
    const visible = await continueButton.isVisible().catch(() => false);
    logViesDebug(market, { key: 'personal-info' }, `continue visible=${visible} disabled=${disabled}`);
    const formState = await continueButton
      .evaluate(button => {
        const form = button.closest('form');
        if (!form) {
          return { hasForm: false };
        }

        const invalidFields = Array.from(form.querySelectorAll(':invalid')).map(field => ({
          name: field.getAttribute('name'),
          type: field.getAttribute('type'),
          placeholder: field.getAttribute('placeholder'),
          ariaLabel: field.getAttribute('aria-label'),
          value: field.value,
        }));

        return {
          hasForm: true,
          valid: form.checkValidity(),
          action: form.getAttribute('action'),
          method: form.getAttribute('method'),
          buttonType: button.getAttribute('type'),
          buttonName: button.getAttribute('name'),
          buttonOuterHtml: button.outerHTML,
          invalidFields,
        };
      })
      .catch(() => ({ hasForm: false, error: true }));
    logViesDebug(market, { key: 'personal-info' }, `form-state=${JSON.stringify(formState)}`);
    const addressStepMarkup = await page
      .getByText(market.labels.addressesStep)
      .first()
      .evaluate(element => {
        const parent = element.parentElement;
        const grandParent = parent?.parentElement;
        return {
          self: element.outerHTML,
          parent: parent?.outerHTML ?? null,
          grandParent: grandParent?.outerHTML ?? null,
        };
      })
      .catch(() => null);
    logViesDebug(market, { key: 'personal-info' }, `address-step=${JSON.stringify(addressStepMarkup)}`);
  }
}

async function continueFromPersonalInformation(page, market, browserName) {
  const continueTimeout =
    market.timeouts?.continueFromPersonalInformation ??
    45000;

  if (browserName === 'webkit' && market.forceAddressStepAfterContinue) {
    await continueFromPersonalInformationDirectAddressNavigation(page, market);
    return;
  }

  if (browserName === 'webkit' && market.webkitDebugContinueFlow) {
    await continueFromPersonalInformationWebkitDebug(page, market, continueTimeout);
    return;
  }

  if (browserName === 'webkit' && market.waitForAddressSubmitButtonAfterContinue) {
    await continueFromPersonalInformationByAddressSubmitButton(page, market, continueTimeout);
    return;
  }

  if (market.simpleContinueFlow) {
    await continueFromPersonalInformationSimple(page, market, continueTimeout);
    return;
  }

  if (market.debugLikeContinueFlow) {
    await continueFromPersonalInformationDebugLike(page, market, continueTimeout);
    return;
  }

  if (market.panelPlusStepContinueFlow) {
    await continueFromPersonalInformationPanelPlusStep(page, market, continueTimeout);
    return;
  }

  if (market.domClickContinueFlow) {
    await continueFromPersonalInformationDomClick(page, market, continueTimeout);
    return;
  }

  if (market.directPostContinueFlow) {
    await continueFromPersonalInformationByDirectPost(page, market);
    return;
  }

  if (browserName === 'webkit') {
    await continueFromPersonalInformationByAddressSubmitButton(page, market, continueTimeout).catch(async () => {
      await continueFromPersonalInformationByDirectPost(page, market);
    });
    return;
  }

  if (market.useDirectAddressReadyCheck) {
    const continueButton = page
      .locator('[role="tabpanel"]').first()
      .getByRole('button', { name: market.labels.continue })
      .first();

    await expect
      .poll(async () => {
        if (
          (market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) ||
          (await isAddressFormReady(page, market))
        ) {
          return true;
        }

        if (await continueButton.isVisible().catch(() => false)) {
          await page.keyboard.press('Tab').catch(() => {});
          await clickContinueButton(continueButton);
          if (market.repeatPersonalContinueClick) {
            await page.waitForTimeout(300);
            await clickContinueButton(continueButton);
          }
        }

        await page.waitForTimeout(500);
        return (
          (market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) ||
          (await isAddressFormReady(page, market))
        );
      }, { timeout: continueTimeout })
      .toBeTruthy();

    return;
  }

  if (browserName !== 'webkit') {
    await continueFromPersonalInformationByAddressSubmitButton(page, market, continueTimeout).catch(async () => {
      await continueFromPersonalInformationByDirectPost(page, market);
    });
    return;
  }

  await continueFromPersonalInformationPanelPlusStep(page, market, continueTimeout);
}

async function continueFromPersonalInformationSimple(page, market, continueTimeout) {
  await expect
    .poll(async () => {
      if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
        return true;
      }

      const continueButton = await findVisibleContinueButton(page, market);
      if (await continueButton.isVisible().catch(() => false)) {
        const navigation = waitForPotentialNavigation(page, market);
        await page.keyboard.press('Tab').catch(() => {});
        await clickContinueButton(continueButton);
        if (market.repeatPersonalContinueClick) {
          await page.waitForTimeout(300);
          await clickContinueButton(continueButton);
        }
        await navigation;
        await page.waitForTimeout(500);
      }

      const redirectCatcherHeading = page.getByText(/Caught redirection to/i).first();
      const redirectVisible = await redirectCatcherHeading.isVisible().catch(() => false);
      if (redirectVisible) {
        const redirectUrl = market.redirectFallbackUrl ?? new URL(market.checkoutPath, market.baseUrl).href;
        await page.goto(redirectUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      return (market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market));
    }, { timeout: continueTimeout })
    .toBeTruthy();
}

async function continueFromPersonalInformationWebkitDebug(page, market, continueTimeout) {
  const deadline = Date.now() + continueTimeout;

  while (Date.now() < deadline) {
    if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
      return;
    }

    const continueButton = await findVisibleContinueButton(page, market);
    if (await continueButton.isVisible().catch(() => false)) {
      const navigation = waitForPotentialNavigation(page, market);
      await page.waitForTimeout(market.timeouts?.preContinueWait ?? 0);
      await continueButton.click({ force: true }).catch(() => {});
      await navigation;
      await page.waitForTimeout(market.timeouts?.postContinueWait ?? 3000);

      if (market.forceAddressStepAfterContinue) {
        const reloadUrl = market.addressStepUrl
          ? new URL(market.addressStepUrl, market.baseUrl).href
          : new URL(market.checkoutPath, market.baseUrl).href;
        await page.goto(reloadUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(market.timeouts?.postContinueWait ?? 3000);
        return;
      }

      const buttonName = await continueButton.getAttribute('name').catch(() => null);
      if (buttonName === 'confirm-addresses') {
        return;
      }

      if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
        return;
      }
    }

    if (market.reloadCheckoutAfterContinue) {
      const reloadUrl = market.addressStepUrl
        ? new URL(market.addressStepUrl, market.baseUrl).href
        : new URL(market.checkoutPath, market.baseUrl).href;
      await page.goto(reloadUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(market.timeouts?.postContinueWait ?? 3000);

      if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
        return;
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Address step did not open after continue on ${market.key}.`);
}

async function continueFromPersonalInformationByAddressSubmitButton(page, market, continueTimeout) {
  const addressSubmitButton = page
    .locator(market.addressSubmitSelector ?? 'button[name="confirm-addresses"]')
    .first();

  await expect
    .poll(async () => {
      const addressSubmitVisible = await addressSubmitButton.isVisible().catch(() => false);
      const addressFieldsVisible = await hasVisibleAddressFields(page, market);
      if (debugVies) {
        logViesDebug(
          market,
          { key: 'continue' },
          `pre-click submitVisible=${addressSubmitVisible} fieldsVisible=${addressFieldsVisible} url=${page.url()}`
        );
      }

      if (addressSubmitVisible || addressFieldsVisible) {
        return true;
      }

      const continueButton = await findVisibleContinueButton(page, market);
      if (await continueButton.isVisible().catch(() => false)) {
        const navigation = waitForPotentialNavigation(page, market);
        if (debugVies) {
          const buttonName = await continueButton.getAttribute('name').catch(() => null);
          const buttonText = (await continueButton.textContent().catch(() => '')).trim();
          logViesDebug(
            market,
            { key: 'continue' },
            `clicking continue name=${String(buttonName)} text=${JSON.stringify(buttonText)}`
          );
        }
        await page.waitForTimeout(market.timeouts?.preContinueWait ?? 0);
        await continueButton.click({ force: true }).catch(() => {});
        await navigation;
        await page.waitForTimeout(market.timeouts?.postContinueWait ?? 3000);
      }

      const postAddressSubmitVisible = await addressSubmitButton.isVisible().catch(() => false);
      const postAddressFieldsVisible = await hasVisibleAddressFields(page, market);
      if (debugVies) {
        logViesDebug(
          market,
          { key: 'continue' },
          `post-click submitVisible=${postAddressSubmitVisible} fieldsVisible=${postAddressFieldsVisible} url=${page.url()}`
        );
      }

      return postAddressSubmitVisible || postAddressFieldsVisible;
    }, { timeout: continueTimeout })
    .toBeTruthy();
}

async function continueFromPersonalInformationDirectAddressNavigation(page, market) {
  const continueButton = await findVisibleContinueButton(page, market);
  if (!(await continueButton.isVisible().catch(() => false))) {
    throw new Error(`Continue button not visible on ${market.key}.`);
  }

  const navigation = waitForPotentialNavigation(page, market);
  await page.waitForTimeout(market.timeouts?.preContinueWait ?? 0);
  await continueButton.click({ force: true }).catch(() => {});
  await navigation;
  await page.waitForTimeout(market.timeouts?.postContinueWait ?? 3000);

  const reloadUrl = market.addressStepUrl
    ? new URL(market.addressStepUrl, market.baseUrl).href
    : new URL(market.checkoutPath, market.baseUrl).href;
  await page.goto(reloadUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(market.timeouts?.postContinueWait ?? 3000);
}

async function continueFromPersonalInformationDebugLike(page, market, continueTimeout) {
  if (market.returnAfterContinueClick) {
    const continueButton = await findVisibleContinueButton(page, market);
    if (await continueButton.isVisible().catch(() => false)) {
      const navigation = waitForPotentialNavigation(page, market);
      await continueButton.click({ force: true }).catch(() => {});
      await navigation;
      await page.waitForTimeout(market.timeouts?.postContinueWait ?? 3000);
    }
    return;
  }

  if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
    return;
  }

  const continueButton = await findVisibleContinueButton(page, market);
  if (await continueButton.isVisible().catch(() => false)) {
    const navigation = waitForPotentialNavigation(page, market);
    await continueButton.click({ force: true }).catch(() => {});
    await navigation;
    await page.waitForTimeout(market.timeouts?.postContinueWait ?? 3000);
  }

  const deadline = Date.now() + continueTimeout;
  while (Date.now() < deadline) {
    if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Address step did not open after continue on ${market.key}.`);
}

async function continueFromPersonalInformationPanelPlusStep(page, market, continueTimeout) {
  const addressLabel = page.getByText(market.labels.addressesStep).first();

  await expect
    .poll(async () => {
      if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
        return true;
      }

      const continueButton = await findVisibleContinueButton(page, market);
      if (await continueButton.isVisible().catch(() => false)) {
        const navigation = waitForPotentialNavigation(page, market);
        await page.keyboard.press('Tab').catch(() => {});
        await clickContinueButton(continueButton);
        if (market.repeatPersonalContinueClick) {
          await page.waitForTimeout(300);
          await clickContinueButton(continueButton);
        }
        await navigation;
        await page.waitForTimeout(400);

        if (!((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market)))) {
          const addressStepUrl = getAddressStepUrl(market);
          if (addressStepUrl) {
            await page.goto(addressStepUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            await page.waitForTimeout(400);
          }
        }

        if (
          market.reloadCheckoutAfterContinue &&
          !((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market)))
        ) {
          await page.goto(new URL(market.checkoutPath, market.baseUrl).href, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForTimeout(400);
        }
      }

      const addressTargets = [
        addressLabel,
        addressLabel.locator('xpath=..'),
        addressLabel.locator('xpath=../..'),
        addressLabel.locator('xpath=../../..'),
        page.locator('[role="tab"]').filter({ hasText: market.labels.addressesStep }).first(),
        page.locator('[role="button"]').filter({ hasText: market.labels.addressesStep }).first(),
      ];

      for (const target of addressTargets) {
        if (await target.isVisible().catch(() => false)) {
          await clickStepTarget(target);
          await page.waitForTimeout(400);
          if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
            return true;
          }
        }
      }

      return false;
    }, { timeout: continueTimeout })
    .toBeTruthy();
}

async function continueFromPersonalInformationDomClick(page, market, continueTimeout) {
  const addressLabel = page.getByText(market.labels.addressesStep).first();

  await expect
    .poll(async () => {
      if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
        return true;
      }

      const continueButton = await findVisibleContinueButton(page, market);
      const navigation = waitForPotentialNavigation(page, market);
      const clicked = await clickContinueButtonDomFirst(continueButton);

      if (clicked) {
        await navigation;
        await page.waitForTimeout(500);

        if (!((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market)))) {
          if (market.postPersonalInfoFormFallback) {
            await submitPersonalInfoFormDirectly(page, market).catch(() => {});
          }
          const addressStepUrl = getAddressStepUrl(market);
          if (addressStepUrl) {
            await page.goto(addressStepUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            await page.waitForTimeout(400);
          }
        }
      }

      const addressTargets = [
        addressLabel,
        addressLabel.locator('xpath=..'),
        addressLabel.locator('xpath=../..'),
        addressLabel.locator('xpath=../../..'),
        page.locator('[role="tab"]').filter({ hasText: market.labels.addressesStep }).first(),
        page.locator('[role="button"]').filter({ hasText: market.labels.addressesStep }).first(),
      ];

      for (const target of addressTargets) {
        if (await target.isVisible().catch(() => false)) {
          await clickStepTarget(target);
          await page.waitForTimeout(400);
          if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
            return true;
          }
        }
      }

      return false;
    }, { timeout: continueTimeout })
    .toBeTruthy();
}

async function submitPersonalInfoFormDirectly(page, market) {
  const continueButton = await findVisibleContinueButton(page, market);
  return await continueButton.evaluate(async button => {
    const form = button.closest('form');
    if (!form) {
      return { hasForm: false };
    }

    const response = await fetch(form.action || window.location.href, {
      method: (form.method || 'POST').toUpperCase(),
      body: new FormData(form),
      credentials: 'include',
    });

    const responseText = await response.text();
    return {
      hasForm: true,
      ok: response.ok,
      status: response.status,
      url: response.url,
      hasAddressHeading: /adresse de facturation|adresses|code postal|ville/i.test(responseText),
      hasPersonalHeading: /informations personnelles|remplir les informations de base/i.test(responseText),
    };
  });
}

async function continueFromPersonalInformationByDirectPost(page, market) {
  const submitResult = await submitPersonalInfoFormDirectly(page, market);
  const addressStepUrl = getAddressStepUrl(market);
  await page.goto(addressStepUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(500);

  if (await isAddressFormReady(page, market)) {
    return;
  }

  throw new Error(`Address step did not open on ${market.key} after direct personal-info POST: ${JSON.stringify(submitResult)}`);
}

async function continueFromPersonalInformationForWebkit(page, market, continueTimeout) {
  const addressLabel = page.getByText(market.labels.addressesStep).first();

  await expect
    .poll(async () => {
      if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
        return true;
      }

      const continueButton = await findVisibleContinueButton(page, market);
      if (await continueButton.isVisible().catch(() => false)) {
        const navigation = waitForPotentialNavigation(page, market);
        await page.keyboard.press('Tab').catch(() => {});
        if (market.domFirstContinueClick) {
          await clickContinueButtonDomFirst(continueButton);
        } else {
          await clickContinueButton(continueButton);
        }
        await navigation;
        await page.waitForTimeout(market.timeouts?.postContinueWait ?? 500);
        if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
          return true;
        }
        if (market.reloadCheckoutAfterContinue) {
          const reloadUrl = market.addressStepUrl
            ? new URL(market.addressStepUrl, market.baseUrl).href
            : new URL(market.checkoutPath, market.baseUrl).href;
          await page.goto(reloadUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForTimeout(400);
          if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
            return true;
          }
        }
      }

      const addressTargets = [
        addressLabel,
        addressLabel.locator('xpath=..'),
        addressLabel.locator('xpath=../..'),
        addressLabel.locator('xpath=../../..'),
        page.locator('[role="tab"]').filter({ hasText: market.labels.addressesStep }).first(),
        page.locator('[role="button"]').filter({ hasText: market.labels.addressesStep }).first(),
      ];

      for (const target of addressTargets) {
        if (await target.isVisible().catch(() => false)) {
          await clickStepTarget(target);
          await page.waitForTimeout(400);
          if ((market.labels.addressReady && (await hasVisibleText(page, market.labels.addressReady))) || (await isAddressFormReady(page, market))) {
            return true;
          }
        }
      }

      return false;
    }, { timeout: continueTimeout })
    .toBeTruthy();
}

function getAddressStepUrl(market) {
  const path = market.addressStepUrl ?? `${market.checkoutPath}?id_address=0`;
  return new URL(path, market.baseUrl).href;
}

function waitForPotentialNavigation(page, market) {
  return page
    .waitForNavigation({
      waitUntil: 'domcontentloaded',
      timeout: market.timeouts?.continueNavigation ?? SHORT_TIMEOUT,
    })
    .catch(() => null);
}

async function isAddressFormReady(page, market) {
  if (market.addressReadySelectors?.length) {
    for (const selector of market.addressReadySelectors) {
      const candidate = page.locator(selector).first();
      if (await candidate.isVisible().catch(() => false)) {
        return true;
      }
    }
  }

  if (market.labels.addressReady) {
    if (await hasVisibleText(page, market.labels.addressReady)) {
      return true;
    }
  }

  const markerGroups = [
    page.getByRole('radio', { name: market.labels.individualCustomer }),
    page.getByRole('radio', { name: market.labels.companyCustomer }),
    page.getByLabel(market.labels.individualCustomer),
    page.getByLabel(market.labels.companyCustomer),
    page.locator('label').filter({ hasText: market.labels.individualCustomer }),
    page.locator('label').filter({ hasText: market.labels.companyCustomer }),
    page.locator('input[type="radio"][value="company"]'),
    page.locator('input[type="radio"][value="private"], input[type="radio"][value="individual"]'),
  ];

  for (const markerGroup of markerGroups) {
    if (await anyLocatorVisible(markerGroup)) {
      return true;
    }
  }

  return await hasVisibleAddressFields(page, market);
}

async function hasVisibleAddressFields(page, market) {
  if (await hasVisibleFieldForPattern(page, market.placeholders.address1, market.placeholderHints?.address)) {
    return true;
  }

  if (await hasVisibleFieldForPattern(page, market.placeholders.postcode, market.placeholderHints?.postcode)) {
    return true;
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

async function bodyHasTextPattern(page, pattern) {
  const text = await page.locator('body').innerText().catch(() => '');
  return pattern.test(text);
}

async function anyLocatorVisible(locator) {
  const count = await locator.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) {
      return true;
    }
  }

  return false;
}

async function fillAddress(page, market, scenario) {
  const { business, billingCountry, customerType } = scenario;

  if (!(market.useDirectAddressReadyCheck && (await hasVisibleText(page, market.labels.addressReady)))) {
    await ensureAddressFormOpen(page, market);
  }
  if (market.countrySelectLabel) {
    await selectCountryByLabel(page, market.countrySelectLabel, billingCountry).catch(async () => {
      await ensureAddressFormOpen(page, market);
      await selectCountryByLabel(page, market.countrySelectLabel, billingCountry);
    });
  } else {
    if (!market.skipCountryReadyCheck) {
      await ensureCountrySelectReady(page, market, billingCountry);
    }
    await selectVisibleOption(page, billingCountry).catch(async () => {
      if (!market.skipCountryReadyCheck) {
        await ensureCountrySelectReady(page, market, billingCountry);
      } else {
        await ensureAddressFormOpen(page, market);
      }
      await selectVisibleOption(page, billingCountry);
    });
  }
  await page.waitForTimeout(300);

  if (customerType === 'company') {
    await chooseCompanyCustomerType(page, market);
  } else {
    await chooseIndividualCustomerType(page, market);
  }

  await fillByPlaceholder(page, market.placeholders.firstName, business.firstName);
  await fillByPlaceholder(page, market.placeholders.lastName, business.lastName);

  if (customerType === 'company') {
    await fillByPlaceholder(page, market.placeholders.company, business.company);
    await fillByPlaceholder(page, market.placeholders.taxId, business.taxId);
    await page.keyboard.press('Tab').catch(() => {});
    await page.waitForTimeout(500);
  }

  await fillByPlaceholder(page, market.placeholders.address1, business.address1);

  if (business.address2) {
    await fillByPlaceholder(page, market.placeholders.address2, business.address2);
  }

  await fillOptionalSelects(page, market);
  await fillByPlaceholder(page, market.placeholders.postcode, business.postcode);
  await fillByPlaceholder(page, market.placeholders.city, business.city);
  await fillPhoneNumber(page, market, business.phone);
}

async function ensureAddressFormOpen(page, market) {
  if (await isAddressFormReady(page, market)) {
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const addressTargets = [
      page.getByText(market.labels.addressesStep).first(),
      page.locator('[role="tab"]').filter({ hasText: market.labels.addressesStep }).first(),
      page.locator('[role="button"]').filter({ hasText: market.labels.addressesStep }).first(),
      page.locator('[role="tabpanel"]').nth(1),
    ];

    for (const target of addressTargets) {
      if (await target.isVisible().catch(() => false)) {
        await target.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
        if (await isAddressFormReady(page, market)) {
          return;
        }
      }
    }

    const personalContinueButton = await findVisibleContinueButton(page, market);
    if (await personalContinueButton.isVisible().catch(() => false)) {
      await clickContinueButton(personalContinueButton);
      await page.waitForTimeout(300);
      if (await isAddressFormReady(page, market)) {
        return;
      }
    }
  }

  throw new Error(`Address form did not open on ${market.key}.`);
}

async function findVisibleContinueButton(page, market) {
  const genericPrestashopButton = page.locator('button[name="continue"][data-link-action="register-new-customer"]').first();
  if (await genericPrestashopButton.isVisible().catch(() => false)) {
    return genericPrestashopButton;
  }

  if (market.personalContinueSelector) {
    const exactButton = page.locator(market.personalContinueSelector).first();
    if (await exactButton.isVisible().catch(() => false)) {
      return exactButton;
    }
  }

  const buttons = page.getByRole('button', { name: market.labels.continue });
  const count = await buttons.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible().catch(() => false)) {
      return button;
    }
  }

  return buttons.first();
}

async function clickContinueButtonDomFirst(button) {
  await button.scrollIntoViewIfNeeded().catch(() => {});
  const clicked = await button
    .evaluate(element => {
      const form = element.closest('form');
      element.click?.();
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
      form?.requestSubmit?.();
      form?.submit?.();
      return true;
    })
    .catch(() => false);

  if (!clicked) {
    await clickContinueButton(button);
    return true;
  }

  return true;
}

async function ensureCountrySelectReady(page, market, value) {
  if (await hasVisibleSelectOption(page, value)) {
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ensureAddressFormOpen(page, market).catch(() => {});

    if (await hasVisibleSelectOption(page, value)) {
      return;
    }

    const addressTargets = [
      page.getByText(market.labels.addressesStep).first(),
      page.locator('[role="tab"]').filter({ hasText: market.labels.addressesStep }).first(),
      page.locator('[role="button"]').filter({ hasText: market.labels.addressesStep }).first(),
      page.locator('[role="tabpanel"]').nth(1),
    ];

    for (const target of addressTargets) {
      if (await target.isVisible().catch(() => false)) {
        await target.click({ force: true }).catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(300);
        if (await hasVisibleSelectOption(page, value)) {
          return;
        }
      }
    }
  }

  throw new Error(`Country select with option "${value}" did not become ready on ${market.key}.`);
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
    await button.press('Enter').catch(() => {});
    await button.press('Space').catch(() => {});
  });
}

async function clickStepTarget(target) {
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target.click({ timeout: 1000 }).catch(async () => {
    await target.click({ force: true }).catch(() => {});
    await target.dispatchEvent('click').catch(() => {});
    await target.evaluate(element => {
      element.click?.();
      element.closest('a,button,div,section')?.click?.();
    }).catch(() => {});
    const box = await target.boundingBox().catch(() => null);
    if (box) {
      await target.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    }
  });
}

async function chooseCompanyCustomerType(page, market) {
  const companyTargets = [
    page.getByRole('radio', { name: market.labels.companyCustomer }).first(),
    page.getByLabel(market.labels.companyCustomer).first(),
    page.locator('label').filter({ hasText: market.labels.companyCustomer }).first(),
    page.getByText(market.labels.companyCustomer).first(),
    page.locator('input[type="radio"][value="company"]').first(),
    page.locator('input[type="radio"][value="business"], input[type="radio"][value="business_customer"]').first(),
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const target of companyTargets) {
      if (await target.isVisible().catch(() => false)) {
        const targetType = (await target.getAttribute('type').catch(() => '')) ?? '';
        if (targetType.toLowerCase() === 'radio') {
          await target.check?.({ force: true }).catch(() => {});
        }
        await target.click({ force: true }).catch(() => {});
        await target.dispatchEvent('click').catch(() => {});
        await page.waitForTimeout(250);

        await expect
          .poll(async () => await isCompanyCustomerModeReady(page, market), { timeout: SHORT_TIMEOUT })
          .toBeTruthy()
          .catch(() => {});

        if (await isCompanyCustomerModeReady(page, market)) {
          return;
        }
      }
    }

    await page.keyboard.press('Tab').catch(() => {});
    await page.keyboard.press('Space').catch(() => {});
    await page.waitForTimeout(250);
  }

  throw new Error(`Customer type switch not found for company on ${market.key}.`);
}

async function chooseIndividualCustomerType(page, market) {
  const individualTargets = [
    page.getByRole('radio', { name: market.labels.individualCustomer }).first(),
    page.getByLabel(market.labels.individualCustomer).first(),
    page.locator('label').filter({ hasText: market.labels.individualCustomer }).first(),
    page.getByText(market.labels.individualCustomer).first(),
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

  throw new Error(`Customer type switch not found for individual on ${market.key}.`);
}

async function isCompanyCustomerModeReady(page, market) {
  const companyFieldVisible =
    (await hasVisibleFieldForPattern(page, market.placeholders.company)) ||
    (await hasVisibleFieldForPattern(page, market.placeholders.taxId));

  if (companyFieldVisible) {
    return true;
  }

  const companyRadio = page.getByRole('radio', { name: market.labels.companyCustomer }).first();
  const individualRadio = page.getByRole('radio', { name: market.labels.individualCustomer }).first();

  return (await companyRadio.isChecked().catch(() => false)) && !(await individualRadio.isChecked().catch(() => false));
}

async function hasVisibleFieldForPattern(page, pattern, hint) {
  const placeholderCandidates = page.locator('input[placeholder], textarea[placeholder]');
  const placeholderCount = await placeholderCandidates.count();

  for (let index = placeholderCount - 1; index >= 0; index -= 1) {
    const candidate = placeholderCandidates.nth(index);
    const placeholder = (await candidate.getAttribute('placeholder').catch(() => '')) ?? '';
    const normalizedPlaceholder = placeholder.toLowerCase();
    if (
      pattern.test(placeholder) &&
      (!hint || normalizedPlaceholder.includes(hint.toLowerCase())) &&
      (await candidate.isVisible().catch(() => false))
    ) {
      return true;
    }
  }

  const labelCandidates = [
    page.getByRole('textbox', { name: pattern }).last(),
    page.getByLabel(pattern).last(),
  ];

  for (const candidate of labelCandidates) {
    if (hint) {
      const name = (await candidate.getAttribute('aria-label').catch(() => '')) ?? '';
      const normalizedName = name.toLowerCase();
      if (!normalizedName.includes(hint.toLowerCase())) {
        continue;
      }
    }

    if (await isFillableField(candidate)) {
      return true;
    }
  }

  return false;
}

async function submitBillingAddress(page, market) {
  if (market.addressSubmitSelector) {
    const exactButton = page.locator(market.addressSubmitSelector).first();
    if (await exactButton.isVisible().catch(() => false)) {
      await clickContinueButtonDomFirst(exactButton);
      return;
    }
  }

  const candidates = [];
  candidates.push(page.getByRole('button', { name: market.labels.continue }).last());
  candidates.push(page.getByRole('button', { name: market.labels.continue }).first());

  for (const button of candidates) {
    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }

    await button.scrollIntoViewIfNeeded().catch(() => {});
    await button.click({ timeout: SHORT_TIMEOUT }).catch(async () => {
      await clickContinueButtonDomFirst(button);
    });
    return;
  }

  throw new Error(`Billing address continue button not found on ${market.key}.`);
}

async function waitForViesValidation(page, market) {
  const validationTimeout = market.timeouts?.viesValidation ?? LONG_TIMEOUT;
  const loadingInfo = page.getByText(market.labels.loadingInfo).first();
  const summaryRegion = page.getByRole('region', { name: market.labels.summary }).first();
  const addressContinueButton = page.getByRole('button', { name: market.labels.continue }).last();

  logViesDebug(market, { key: 'validation' }, 'waitForViesValidation:start');
  await loadingInfo.waitFor({ state: 'visible', timeout: SHORT_TIMEOUT }).catch(() => {});
  logViesDebug(market, { key: 'validation' }, 'waitForViesValidation:after-visible-wait');

  if (await loadingInfo.isVisible().catch(() => false)) {
    await loadingInfo.waitFor({ state: 'hidden', timeout: validationTimeout }).catch(() => {});
  }
  logViesDebug(market, { key: 'validation' }, 'waitForViesValidation:after-hidden-wait');

  await page.waitForLoadState('domcontentloaded', { timeout: SHORT_TIMEOUT }).catch(() => {});
  logViesDebug(market, { key: 'validation' }, 'waitForViesValidation:after-loadstate');

  const deadline = Date.now() + validationTimeout;
  let lastState = null;

  while (Date.now() < deadline) {
    await page.waitForLoadState('domcontentloaded', { timeout: SHORT_TIMEOUT }).catch(() => {});

    const bodyText = await page.locator('body').textContent().catch(() => '');
    const summaryVisible = await summaryRegion.isVisible().catch(() => false);
    const summaryHeadingVisible = market.labels.summary.test(bodyText);
    const viesSuccessVisible = market.labels.viesSuccess.test(bodyText);
    const shippingVisible = market.labels.shippingStep.test(bodyText);
    const shippingReadyVisible = market.labels.shippingReady
      ? market.labels.shippingReady.test(bodyText)
      : false;
    const paymentReadyVisible = market.labels.paymentReady
      ? market.labels.paymentReady.test(bodyText)
      : false;
    const summaryLooksReadable = false;
    const summaryReady = summaryVisible || summaryHeadingVisible;
    const directAdvancedStepReady = shippingReadyVisible || paymentReadyVisible;

    if (summaryReady && directAdvancedStepReady) {
      lastState = {
        summaryVisible,
        summaryHeadingVisible,
        summaryLooksReadable,
        viesSuccessVisible,
        shippingVisible,
        shippingReadyVisible,
        paymentReadyVisible,
        addressFormStillReady: false,
        addressContinueVisible: false,
        summaryReady,
        advancedStepReady: true,
      };
      break;
    }

    const addressFormStillReady = await isAddressFormReady(page, market).catch(() => false);
    const addressContinueVisible = await addressContinueButton.isVisible().catch(() => false);
    const advancedStepReady =
      directAdvancedStepReady ||
      (shippingVisible && !addressFormStillReady);

    lastState = {
      summaryVisible,
      summaryHeadingVisible,
      summaryLooksReadable,
      viesSuccessVisible,
      shippingVisible,
      shippingReadyVisible,
      paymentReadyVisible,
      addressFormStillReady,
      addressContinueVisible,
      summaryReady,
      advancedStepReady,
    };

    logViesDebug(market, { key: 'validation' }, JSON.stringify(lastState));

    if (addressFormStillReady && addressContinueVisible) {
      await addressContinueButton.click({ timeout: 1000 }).catch(() => {});
    }

    if (market.stepVisibleValidation && summaryReady && advancedStepReady) {
      break;
    }

    if (
      summaryReady &&
      (
        !addressFormStillReady ||
        viesSuccessVisible ||
        shippingReadyVisible ||
        paymentReadyVisible ||
        (shippingVisible && !addressFormStillReady)
      )
    ) {
      break;
    }

    await page.waitForTimeout(500);
  }

  if (
    !lastState ||
    !(
      (market.stepVisibleValidation && lastState.summaryReady && lastState.advancedStepReady) ||
      (
        lastState.summaryReady &&
        (
          !lastState.addressFormStillReady ||
          lastState.viesSuccessVisible ||
          lastState.shippingReadyVisible ||
          lastState.paymentReadyVisible ||
          (lastState.shippingVisible && !lastState.addressFormStillReady)
        )
      )
    )
  ) {
    throw new Error(`VIES validation did not settle on ${market.key}. Last state: ${JSON.stringify(lastState)}`);
  }

  await expect
    .poll(async () => {
      const summaryVisible = await summaryRegion.isVisible().catch(() => false);
      return summaryVisible;
    }, { timeout: SHORT_TIMEOUT })
    .toBeTruthy();
}

async function assertScenarioOutcome(page, market, scenario, summaryBeforeAddressSave, _summaryAfterAddressSave, browserName) {
  const expectedTotalChange = scenario.expectedTotalChangeByBrowser?.[browserName] ?? scenario.expectedTotalChange;

  if (expectedTotalChange === 'decrease') {
    const positiveTimeout = market.timeouts?.positiveVies ?? VIES_TIMEOUT;

    const finalSummary = await waitForSummaryMatch(
      page,
      market,
      summary => {
        const totalDropped = roundPrice(summary.total) < roundPrice(summaryBeforeAddressSave.total);
        const subtotalDropped =
          summary.subtotal !== null &&
          summaryBeforeAddressSave.subtotal !== null &&
          roundPrice(summary.subtotal) < roundPrice(summaryBeforeAddressSave.subtotal);
        const itemPriceDropped =
          summary.itemPrice !== null &&
          summaryBeforeAddressSave.itemPrice !== null &&
          roundPrice(summary.itemPrice) < roundPrice(summaryBeforeAddressSave.itemPrice);
        return totalDropped || subtotalDropped || itemPriceDropped;
      },
      positiveTimeout
    );

    const positiveSignals = [
      finalSummary.total < summaryBeforeAddressSave.total,
      finalSummary.subtotal !== null &&
        summaryBeforeAddressSave.subtotal !== null &&
        roundPrice(finalSummary.subtotal) < roundPrice(summaryBeforeAddressSave.subtotal),
      finalSummary.itemPrice !== null &&
        summaryBeforeAddressSave.itemPrice !== null &&
        roundPrice(finalSummary.itemPrice) < roundPrice(summaryBeforeAddressSave.itemPrice),
    ];

    expect(positiveSignals.some(Boolean)).toBe(true);
    return;
  }

  const finalSummary = await waitForSummaryMatch(
    page,
    market,
    summary => roundPrice(summary.subtotal ?? 0) === roundPrice(summaryBeforeAddressSave.subtotal ?? 0),
    MEDIUM_TIMEOUT
  );

  expect(roundPrice(finalSummary.subtotal ?? 0)).toBe(roundPrice(summaryBeforeAddressSave.subtotal ?? 0));

  if (summaryBeforeAddressSave.tax !== null && finalSummary.tax !== null) {
    expect(roundPrice(finalSummary.tax)).toBe(roundPrice(summaryBeforeAddressSave.tax));
  }
}

async function waitForSummaryMatch(page, market, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSummary = await readSummary(page, market);

  while (Date.now() < deadline) {
    lastSummary = await readSummary(page, market);
    if (predicate(lastSummary)) {
      return lastSummary;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    `Summary did not reach expected state in ${timeoutMs} ms for ${market.key}. Last read: ${JSON.stringify(lastSummary)}`
  );
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
        await field.fill(value);
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
      await candidate.fill(value);
      return;
    }
  }

  const labelCandidates = [
    page.getByRole('textbox', { name: pattern }).last(),
    page.getByLabel(pattern).last(),
  ];

  for (const candidate of labelCandidates) {
    if (await isFillableField(candidate)) {
      await candidate.fill(value);
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

async function fillPhoneNumber(page, market, value) {
  const candidates = [
    page.getByRole('textbox', { name: market.labels.phone }).last(),
    page.getByLabel(market.labels.phone).last(),
    page.locator('input[type="tel"]').last(),
    page.locator('input[name*="phone" i], input[id*="phone" i], input[name*="telephone" i], input[id*="telephone" i], input[name*="telefon" i], input[id*="telefon" i]').last(),
  ];

  for (const field of candidates) {
    if (await field.isVisible().catch(() => false)) {
      await field.fill(value);
      return;
    }
  }

  throw new Error(`Phone field not found on ${market.key}.`);
}

async function fillOptionalSelects(page, market) {
  if (!market.optionalSelects?.length) {
    return;
  }

  for (const optionalSelect of market.optionalSelects) {
    if (optionalSelect.extraVisible) {
      await fillExtraVisibleSelect(page);
      continue;
    }

    const select = page.getByLabel(optionalSelect.label).first();
    if (!(await select.isVisible().catch(() => false))) {
      continue;
    }

    if (optionalSelect.value) {
      await selectVisibleOption(page, optionalSelect.value);
      continue;
    }

    const selectedFirstRealOption = await select
      .evaluate(element => {
        const firstRealOption = [...element.options].find(option => !option.disabled && option.value);
        if (!firstRealOption) {
          return false;
        }

        element.value = firstRealOption.value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })
      .catch(() => false);

    if (selectedFirstRealOption) {
      await page.waitForTimeout(250);
    }
  }
}

async function fillExtraVisibleSelect(page) {
  const selects = page.locator('select');
  const selectCount = await selects.count();
  const visibleSelects = [];

  for (let index = 0; index < selectCount; index += 1) {
    const select = selects.nth(index);
    if (await select.isVisible().catch(() => false)) {
      visibleSelects.push(select);
    }
  }

  if (visibleSelects.length < 2) {
    return;
  }

  const targetSelect = visibleSelects.at(-1);
  const selectedFirstRealOption = await targetSelect
    .evaluate(element => {
      const firstRealOption = [...element.options].find(option => !option.disabled && option.value);
      if (!firstRealOption) {
        return false;
      }

      element.value = firstRealOption.value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })
    .catch(() => false);

  if (selectedFirstRealOption) {
    await page.waitForTimeout(250);
  }
}

async function selectVisibleOption(page, value) {
  const selects = page.locator('select, [role="combobox"]');
  const selectCount = await selects.count();

  const hasMatchingOption = async select =>
    await select
      .evaluate((element, targetValue) => {
        const normalize = input =>
          String(input ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();

        const target = normalize(targetValue);
        const nativeOptions = Array.from(element.options ?? []);
        const ariaOptions = Array.from(element.querySelectorAll?.('[role="option"]') ?? []);
        const options = nativeOptions.length ? nativeOptions : ariaOptions;

        return options.some(option => {
          const label = normalize(option.label ?? option.textContent);
          const text = normalize(option.textContent);
          const valueAttr = normalize(option.value ?? option.getAttribute?.('value'));
          return label === target || text === target || valueAttr === target;
        });
      }, value)
      .catch(() => false);

  const trySetOption = async select =>
    await select
      .evaluate((element, targetValue) => {
        const normalize = input =>
          String(input ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
          .toLowerCase();

      const target = normalize(targetValue);
      const nativeOptions = Array.from(element.options ?? []);
      const ariaOptions = Array.from(element.querySelectorAll?.('[role="option"]') ?? []);
      const options = nativeOptions.length ? nativeOptions : ariaOptions;
      const matchingOption =
        options.find(option => normalize(option.label ?? option.textContent) === target) ??
        options.find(option => normalize(option.textContent) === target) ??
        options.find(option => normalize(option.value ?? option.getAttribute?.('value')) === target);

      if (!matchingOption) {
        return false;
      }

      if ('value' in element && matchingOption.value) {
        element.value = matchingOption.value;
      }
      if ('selected' in matchingOption) {
        matchingOption.selected = true;
      }
      matchingOption.click?.();
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
      }, value)
      .catch(() => false);

  for (let index = selectCount - 1; index >= 0; index -= 1) {
    const select = selects.nth(index);
    if (!(await select.isVisible().catch(() => false))) {
      continue;
    }

    const selected = await trySetOption(select);
    if (selected) {
      await page.waitForTimeout(300);
      return;
    }
  }

  for (let index = selectCount - 1; index >= 0; index -= 1) {
    const select = selects.nth(index);
    if (!(await select.isVisible().catch(() => false))) {
      continue;
    }

    if (!(await hasMatchingOption(select))) {
      continue;
    }

    await select.selectOption?.({ label: value }).catch(async () => {
      await select.selectOption?.({ value });
    }).catch(() => {});
    await page.waitForTimeout(300);
    return;
  }

  throw new Error(`Visible select option "${value}" not found.`);
}

async function selectCountryByLabel(page, labelPattern, value) {
  const candidates = [
    page.getByRole('combobox', { name: labelPattern }).last(),
    page.getByLabel(labelPattern).last(),
  ];

  for (const select of candidates) {
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
        const nativeOptions = Array.from(element.options ?? []);
        const ariaOptions = Array.from(element.querySelectorAll?.('[role="option"]') ?? []);
        const options = nativeOptions.length ? nativeOptions : ariaOptions;
        const matchingOption =
          options.find(option => normalize(option.label ?? option.textContent) === target) ??
          options.find(option => normalize(option.textContent) === target) ??
          options.find(option => normalize(option.value ?? option.getAttribute?.('value')) === target);

        if (!matchingOption) {
          return false;
        }

        if ('value' in element && matchingOption.value) {
          element.value = matchingOption.value;
        }
        if ('selected' in matchingOption) {
          matchingOption.selected = true;
        }
        matchingOption.click?.();
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, value)
      .catch(() => false);

    if (selected) {
      await page.waitForTimeout(300);
      return;
    }

    await select.selectOption?.({ label: value }).catch(async () => {
      await select.selectOption?.({ value });
    }).catch(() => {});
    await page.waitForTimeout(300);
    return;
  }

  throw new Error(`Country select "${labelPattern}" not found for value "${value}".`);
}

async function hasVisibleSelectOption(page, value) {
  const controls = page.locator('select, [role="combobox"]');
  const controlCount = await controls.count().catch(() => 0);

  for (let index = controlCount - 1; index >= 0; index -= 1) {
    const select = controls.nth(index);
    if (!(await select.isVisible().catch(() => false))) {
      continue;
    }

    if (await selectHasMatchingOption(select, value)) {
      return true;
    }
  }

  return false;
}

async function selectHasMatchingOption(select, value) {
  return await select
    .evaluate((element, targetValue) => {
      const normalize = input =>
        String(input ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLowerCase();

      const target = normalize(targetValue);
      const nativeOptions = Array.from(element.options ?? []);
      const ariaOptions = Array.from(element.querySelectorAll?.('[role="option"]') ?? []);
      const options = nativeOptions.length ? nativeOptions : ariaOptions;

      return options.some(option => {
        const label = normalize(option.label ?? option.textContent);
        const text = normalize(option.textContent);
        const valueAttr = normalize(option.value ?? option.getAttribute?.('value'));
        return label === target || text === target || valueAttr === target;
      });
    }, value)
    .catch(() => false);
}

async function readSummary(page, market) {
  const summaryRegion = page.getByRole('region', { name: market.labels.summary }).first();
  const summaryText = await summaryRegion.textContent().catch(async originalError => {
    if (page.isClosed()) {
      throw new Error(
        `Could not read checkout summary for ${market.key}: page was already closed. ` +
          `The scenario most likely timed out or navigated away before the summary became readable.`,
      );
    }

    const bodyText = await page.locator('body').textContent().catch(() => null);
    if (bodyText) {
      return bodyText;
    }

    throw new Error(
      `Could not read checkout summary for ${market.key}: summary region was unavailable and body text could not be read.`,
      { cause: originalError },
    );
  });

  return {
    itemPrice: extractPrice(summaryText, market.pricePatterns.itemPrice),
    subtotal: extractPrice(summaryText, market.pricePatterns.subtotal),
    shipping: extractPrice(summaryText, market.pricePatterns.shipping),
    tax: extractPrice(summaryText, market.pricePatterns.tax),
    total: extractRequiredPrice(summaryText, market.pricePatterns.total),
  };
}

async function hasReadableSummary(page, market) {
  try {
    const summary = await readSummary(page, market);
    return Number.isFinite(summary.total);
  } catch {
    return false;
  }
}

function extractRequiredPrice(text, pattern) {
  const value = extractPrice(text, pattern);
  if (value === null) {
    throw new Error(`Could not read price for ${pattern}`);
  }

  return value;
}

function extractPrice(text, pattern) {
  if (!pattern) {
    return null;
  }

  const match = text.match(pattern);
  if (!match) {
    return null;
  }

  return parsePrice(match[1]);
}

function parsePrice(value) {
  const normalized = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  return Number.parseFloat(normalized);
}

function roundPrice(value) {
  return Math.round(value * 100) / 100;
}

function logViesDebug(market, scenario, message) {
  if (!debugVies) {
    return;
  }

  const timestamp = new Date().toISOString();
  console.log(`[VIES ${timestamp}] [${market.key}] [${scenario.key}] ${message}`);
}

async function dismissCookieBanner(page, market) {
  const dialog = page.locator('#CybotCookiebotDialog');
  await dialog.waitFor({ state: 'visible', timeout: SHORT_TIMEOUT }).catch(() => {});

  if (!(await dialog.isVisible().catch(() => false))) {
    return;
  }

  for (const selector of market.cookieSelectors.primaryButtons) {
    const button = page.locator(selector);
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {});
      break;
    }
  }

  await dialog.waitFor({ state: 'hidden', timeout: MEDIUM_TIMEOUT }).catch(() => {});
}

async function addProductToCart(page, market, product, expectedCartCount) {
  await gotoWithRetry(page, new URL(product.path, market.baseUrl).href, { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page, market);
  await closeBlockingPopups(page, market);
  const initialCartCount = await readCartCount(page, market);

  await expect(page.getByRole('heading', { name: product.name, exact: true })).toBeVisible({
    timeout: MEDIUM_TIMEOUT,
  });

  const addToCartButton = page
    .locator('form#add-to-cart-or-refresh button.add-to-cart, form[action*="cart"] button.add-to-cart, button.add-to-cart')
    .filter({ hasText: market.labels.addToCart })
    .first();

  await expect(addToCartButton).toBeVisible({ timeout: MEDIUM_TIMEOUT });
  await addToCartButton.scrollIntoViewIfNeeded();
  await clickAddToCartButton(page, market, addToCartButton, expectedCartCount ?? initialCartCount + 1);

  await expect(page.getByRole('link', { name: market.labels.cart }).first()).toBeVisible({ timeout: MEDIUM_TIMEOUT });
  await closeBlockingPopups(page, market);
}

async function clickAddToCartButton(page, market, button, expectedCartCount) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await dismissCookieBanner(page, market);
    await closeBlockingPopups(page, market);

    if (!(await button.isVisible().catch(() => false))) {
      await page.waitForTimeout(250);
      continue;
    }

    await button.scrollIntoViewIfNeeded().catch(() => {});
    await button.click({ timeout: SHORT_TIMEOUT }).catch(() => {});
    const cartUpdated = await waitForCartCount(page, market, expectedCartCount, SHORT_TIMEOUT);
    if (cartUpdated) {
      return;
    }

    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
  }

  throw new Error(`Add to cart button could not be clicked on ${market.key}.`);
}

async function readCartCount(page, market) {
  const cartLink = page.getByRole('link', { name: market.labels.cart }).first();
  const cartText = (await cartLink.innerText().catch(() => '')) || '';
  const match = cartText.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

async function waitForCartCount(page, market, expectedCartCount, timeoutMs) {
  try {
    await expect
      .poll(async () => await readCartCount(page, market), { timeout: timeoutMs })
      .toBe(expectedCartCount);
    return true;
  } catch {
    return false;
  }
}

async function gotoWithRetry(page, url, options, maxAttempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await page.goto(url, options);
    } catch (error) {
      lastError = error;

      if (page.isClosed() || !isRetriableNavigationError(error) || attempt === maxAttempts) {
        throw error;
      }

      await page.waitForTimeout(NAVIGATION_RETRY_DELAY * attempt).catch(() => {});
    }
  }

  throw lastError;
}

function isRetriableNavigationError(error) {
  const message = String(error?.message ?? error);
  return /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_ABORTED|frame was detached/i.test(message);
}

async function closeBlockingPopups(page, market) {
  const survicateCloseTargets = [
    page.locator('#survicate-box button[aria-label*="close" i], #survicate-box button[title*="close" i]').first(),
    page.locator('#survicate-box [role="button"][aria-label*="close" i], #survicate-box [role="button"][title*="close" i]').first(),
    page.getByRole('button', { name: /close|zamknij|cerrar|fermer|bezárás|zatvori|stang|sulje|chiudi|sluit/i }).first(),
    page.getByRole('button', { name: /no thanks|skip|later|nie teraz|más tarde|plus tard|később|kasnije/i }).first(),
  ];

  for (const target of survicateCloseTargets) {
    if (await target.isVisible().catch(() => false)) {
      await target.click({ timeout: 1000 }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  const survicateOverlay = page.locator('#survicate-box .sv__overlay, #survicate-box [class*="overlay" i]').first();
  if (await survicateOverlay.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
  }

  for (const popupSelector of market.popupSelectors.popupContainers) {
    const popup = page.locator(popupSelector).first();
    if (!(await popup.isVisible().catch(() => false))) {
      continue;
    }

    if (await popup.locator('#CybotCookiebotDialog').isVisible().catch(() => false)) {
      continue;
    }

    for (const closeSelector of market.popupSelectors.closeButtons) {
      const closeButton = popup.locator(closeSelector).first();
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click({ timeout: 1000 }).catch(() => {});
        break;
      }
    }

    const newsletterText = popup.getByText(market.popupSelectors.newsletterText).first();
    if (await newsletterText.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  for (const locatorFactory of market.popupSelectors.genericCloseTargets) {
    const target = locatorFactory(page);
    if (await target.isVisible().catch(() => false)) {
      await target.click({ timeout: 1000 }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
}
