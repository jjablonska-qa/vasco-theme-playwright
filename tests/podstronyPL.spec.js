import { test, expect, request } from '@playwright/test';
test.setTimeout(180000);
test('Mapa strony - status + SEO + redirect audit', async () => {
  const baseUrl = 'https://vasco-electronics.pl';
  const sitemapPage = `${baseUrl}/mapa-strony`;
  const apiContext = await request.newContext({
    userAgent: 'Mozilla/5.0',
    ignoreHTTPSErrors: true,
  });
  const sitemapResponse = await apiContext.get(sitemapPage);
  expect(sitemapResponse.ok()).toBeTruthy();
  const sitemapHtml = await sitemapResponse.text();
  const linkMatches = [
    ...sitemapHtml.matchAll(/href="(https:\/\/vasco-electronics\.pl[^"]+)"/g),
  ];
  const links = linkMatches.map(match => match[1]);
  const filteredLinks = links.filter(url =>
    !url.endsWith('.pdf') &&
    !url.includes('/themes/') &&
    !url.includes('/assets/')
  );
  const uniqueLinks = [...new Set(filteredLinks)];
  console.log(`Znaleziono ${uniqueLinks.length} linków do sprawdzenia`);
  const concurrencyLimit = 5;
  let errors = [];
  // Zliczanie statusów
  const statusCounter = {};
  // Zliczanie redirectów
  let totalRedirects = 0;
  for (let i = 0; i < uniqueLinks.length; i += concurrencyLimit) {
    const chunk = uniqueLinks.slice(i, i + concurrencyLimit);
    const results = await Promise.allSettled(
      chunk.map(async (url) => {
        let currentUrl = url;
        let redirectCountForUrl = 0;
        let response;
        // RĘCZNE ŚLEDZENIE REDIRECTÓW
        for (let r = 0; r < 5; r++) {
          response = await apiContext.get(currentUrl, {
            maxRedirects: 0, // wyłączamy automatyczne redirecty
            timeout: 20000,
          });
          const status = response.status();
          // Zliczamy status
          statusCounter[status] = (statusCounter[status] || 0) + 1;
          if (status >= 300 && status < 400) {
            const location = response.headers()['location'];
            if (!location) break;
            currentUrl = location.startsWith('http')
              ? location
              : new URL(location, currentUrl).href;
            redirectCountForUrl++;
            totalRedirects++;
          } else {
            break;
          }
        }
        console.log(`${response.status()} → ${url} (redirects: ${redirectCountForUrl})`);
        if (redirectCountForUrl > 2) {
          errors.push(`Za dużo redirectów (${redirectCountForUrl}) - ${url}`);
        }
        if (response.status() >= 400) {
          return `${response.status()} - ${url}`;
        }
        const html = await response.text();
        if (!html.includes('<title>')) {
          return `Brak title - ${url}`;
        }
        if (!html.includes('name="description"')) {
          return `Brak meta description - ${url}`;
        }
        const robotsMatch = html.match(
          /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*["']/i
        );
        if (robotsMatch && robotsMatch[0].toLowerCase().includes('noindex')) {
          return `NOINDEX wykryty - ${url}`;
        }
        return null;
      })
    );
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        errors.push(result.value);
      }
      if (result.status === 'rejected') {
        errors.push('REQUEST ERROR');
      }
    });
  }
  // RAPORT STATUSÓW
  console.log('--- PODSUMOWANIE STATUSÓW ---');
  Object.entries(statusCounter).forEach(([status, count]) => {
    console.log(`${status} → ${count}`);
  });
  console.log(`Łączna liczba redirectów: ${totalRedirects}`);
  if (errors.length > 0) {
    console.log('--- BŁĘDY ---');
    errors.forEach(e => console.log(e));
    throw new Error(`Znaleziono ${errors.length} błędów`);
  }
});