const fs = require('fs');
const path = require('path');

const marketUrls = {
  'BE FR': 'https://vasco-electronics.be/fr/', BG: 'https://vasco-electronics.bg/', CZ: 'https://vasco-electronics.cz/',
  CA: 'https://vasco-translator.ca/fr/',
  DE: 'https://vasco-electronics.de/', DK: 'https://vasco-electronics.dk/', ES: 'https://vasco-electronics.es/',
  FI: 'https://vasco-electronics.fi/', FR: 'https://vasco-electronics.fr/', HR: 'https://vasco-electronics.hr/',
  HU: 'https://vasco-electronics.hu/', IT: 'https://vasco-electronics.it/', NL: 'https://vasco-electronics.nl/',
  PL: 'https://vasco-electronics.pl/', PT: 'https://vasco-electronics.pt/', RO: 'https://vasco-electronics.ro/',
  SK: 'https://vasco-electronics.sk/', UK: 'https://vasco-electronics.co.uk/', US: 'https://vasco-electronics.com/',
};

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

function marketFromTitle(title) {
  const match = title.match(/^([A-Z]{2}(?:\sFR)?):/);
  return match?.[1] ?? 'Inny';
}

function cleanError(error) {
  return (error?.message || 'Test failed without an error message.')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDuration(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

class FreeShippingAuditReporter {
  constructor() { this.countries = new Map(); this.issues = []; this.startedAt = 0; }

  onBegin() { this.startedAt = Date.now(); }

  onTestEnd(test, result) {
    if (!test.location.file.includes(`${path.sep}free-shipping${path.sep}`)) return;
    const country = marketFromTitle(test.title);
    const summary = this.countries.get(country) || { country, passed: 0, failed: 0, skipped: 0, duration: 0 };
    if (result.status === 'passed') summary.passed += 1;
    else if (result.status === 'skipped') summary.skipped += 1;
    else summary.failed += 1;
    summary.duration += result.duration;
    this.countries.set(country, summary);
    if (result.status === 'passed' || result.status === 'skipped') return;

    const attachment = result.attachments.find(item => item.name === 'Current page URL');
    this.issues.push({
      country,
      browser: test.parent.project()?.name || '—',
      test: test.title,
      url: attachment?.body?.toString().trim() || marketUrls[country] || '',
      error: cleanError(result.errors[0]),
      duration: result.duration,
    });
  }

  onEnd() {
    // Do not replace a previous free-shipping report with a misleading empty report
    // when the current run belongs to another suite (for example VIES).
    if (!this.countries.size) return;

    const allMarkets = [...new Set([...Object.keys(marketUrls), ...this.countries.keys()])];
    const countries = allMarkets
      .map(country => ({
        ...(this.countries.get(country) || { country, passed: 0, failed: 0, skipped: 0, duration: 0 }),
        issues: this.issues.filter(issue => issue.country === country).length,
      }))
      .sort((left, right) => right.issues - left.issues || left.country.localeCompare(right.country));
    const totals = countries.reduce((sum, country) => ({
      passed: sum.passed + country.passed, failed: sum.failed + country.failed, skipped: sum.skipped + country.skipped,
    }), { passed: 0, failed: 0, skipped: 0 });
    const rows = countries.map(country => '<tr><td>' + escapeHtml(country.country) + '</td><td>' + country.passed + '</td><td>' + country.failed + '</td><td>' + country.skipped + '</td><td>' + country.issues + '</td><td>' + formatDuration(country.duration) + '</td></tr>').join('');
    const issueRows = this.issues.length
      ? this.issues.map(issue => '<tr><td>' + escapeHtml(issue.country) + '</td><td>' + escapeHtml(issue.browser) + '</td><td>' + escapeHtml(issue.test) + '</td><td>' + formatDuration(issue.duration) + '</td><td><a href="' + escapeHtml(issue.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(issue.url) + '</a></td><td>' + escapeHtml(issue.error) + '</td></tr>').join('')
      : '<tr><td colspan="6" class="empty">Nie wykryto problemów.</td></tr>';
    const html = '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Free Shipping Audit Report</title><style>'
      + 'body{max-width:1280px;margin:36px auto;padding:0 24px;color:#202124;font:16px/1.5 Arial,sans-serif}h1{margin-bottom:4px}.meta{color:#5f6368;margin-top:0}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.card{min-width:130px;padding:14px 18px;border-radius:8px;background:#f1f3f4}.card strong{display:block;font-size:26px}.failed{background:#fce8e6;color:#b3261e}table{width:100%;border-collapse:collapse;margin:12px 0 36px}th{background:#202124;color:#fff;text-align:left}th,td{padding:10px;border:1px solid #dadce0;vertical-align:top}tr:nth-child(even){background:#f8f9fa}a{color:#0b57d0;word-break:break-all}.empty{text-align:center}'
      + '</style></head><body><h1>Free Shipping Audit Report</h1><p class="meta">Wygenerowano: ' + escapeHtml(new Date().toLocaleString('pl-PL')) + '</p>'
      + '<div class="cards"><div class="card"><strong>' + totals.passed + '</strong>zaliczone</div><div class="card failed"><strong>' + totals.failed + '</strong>niezaliczone</div><div class="card"><strong>' + totals.skipped + '</strong>pominięte</div><div class="card"><strong>' + countries.length + '</strong>rynki</div><div class="card"><strong>' + formatDuration(Date.now() - this.startedAt) + '</strong>czas runu</div></div>'
      + '<h2>Co sprawdzają te testy?</h2><p>Każdy test otwiera sklep danego rynku, dodaje produkt o wartości poniżej albo powyżej progu darmowej dostawy, przechodzi do checkoutu, uzupełnia wymagane dane adresowe i sprawdza dostępne metody dostawy. Weryfikuje, czy poniżej progu nie ma darmowej dostawy, a powyżej progu jest dostępna. Test zatrzymuje się przed płatnością i nie składa zamówienia.</p>'
      + '<h2>Podsumowanie per kraj</h2><table><thead><tr><th>Kraj</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Problemy</th><th>Suma czasu testów</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="empty">Nie uruchomiono testów free shipping.</td></tr>') + '</tbody></table>'
      + '<h2>Wykryte problemy</h2><table><thead><tr><th>Kraj</th><th>Przeglądarka</th><th>Test</th><th>Czas testu</th><th>Adres URL</th><th>Błąd</th></tr></thead><tbody>' + issueRows + '</tbody></table></body></html>';
    fs.writeFileSync(path.join(process.cwd(), 'free-shipping-audit-report.html'), html, 'utf8');
  }
}

module.exports = FreeShippingAuditReporter;
