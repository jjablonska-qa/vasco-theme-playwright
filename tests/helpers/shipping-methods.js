/**
 * Reads prices only from selectable delivery methods.  It deliberately avoids
 * the order summary, where a generic "Free" label could otherwise produce a
 * false positive.
 */
export async function readShippingMethodPrices(page, { currency, freePattern }) {
  const methods = await page.locator('input[type="radio"]').evaluateAll((radios, config) => {
    const visible = element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width >= 0 && rect.height >= 0;
    };
    const result = [];
    for (const radio of radios) {
      if (!visible(radio)) continue;
      const container = radio.closest('li, .delivery-option, .carrier, [class*="delivery"], [class*="shipping"]') || radio.parentElement;
      const text = (container?.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const free = new RegExp(config.freePattern, 'i').test(text);
      const match = text.match(new RegExp(`(?:${config.currency})\\s*([\\d.,]+)|([\\d.,]+)\\s*(?:${config.currency})`, 'i'));
      if (!free && !match) continue;
      result.push({ text, price: free ? 0 : Number((match[1] || match[2]).replace(',', '.')) });
    }
    return result.filter((method, index, all) => all.findIndex(other => other.text === method.text) === index);
  }, { currency: currency.source, freePattern: freePattern.source });

  return methods;
}

export function expectShippingPrice(methods, { free, paid }) {
  if (!methods.length) throw new Error('No selectable shipping methods with a visible price were found.');
  const prices = methods.map(method => method.price);
  if (free && !prices.includes(0)) throw new Error(`Expected a free shipping method; received: ${JSON.stringify(methods)}`);
  if (!free && prices.includes(0)) throw new Error(`Did not expect free shipping; received: ${JSON.stringify(methods)}`);
  if (!free && !prices.includes(paid)) throw new Error(`Expected paid shipping price ${paid}; received: ${JSON.stringify(methods)}`);
}

/** Reads the checkout summary row identified by its localized shipping label. */
export async function readShippingSummary(page, shippingLabel) {
  return page.evaluate(labelSource => {
    const label = new RegExp(labelSource, 'i');
    const leaf = [...document.querySelectorAll('*')].find(element =>
      element.children.length === 0 && label.test(element.textContent?.trim() || '')
    );
    return leaf?.parentElement?.innerText?.replace(/\s+/g, ' ').trim() || null;
  }, shippingLabel.source);
}

export function shippingPriceFromText(text, { currency, freePattern }) {
  if (freePattern.test(text)) return 0;
  const match = text.match(new RegExp(`([\\d.,]+)\\s*(?:${currency.source})`, 'i'));
  return match ? Number(match[1].replace(',', '.')) : null;
}
