const fs = require('fs');
const path = require('path');

const marketUrls = {
  'BE-FR': 'https://vasco-electronics.be/fr/', BG: 'https://vasco-electronics.bg/', CZ: 'https://vasco-electronics.cz/',
  DE: 'https://vasco-electronics.de/', DK: 'https://vasco-electronics.dk/', ES: 'https://vasco-electronics.es/',
  FI: 'https://vasco-electronics.fi/', FR: 'https://vasco-electronics.fr/', HR: 'https://vasco-electronics.hr/',
  HU: 'https://vasco-electronics.hu/', IT: 'https://vasco-electronics.it/', LT: 'https://vasco-electronics.lt/',
  NL: 'https://vasco-electronics.nl/', PL: 'https://vasco-electronics.pl/', PT: 'https://vasco-electronics.pt/',
  RO: 'https://vasco-electronics.ro/', SE: 'https://vasco-electronics.se/', SK: 'https://vasco-electronics.sk/',
};

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

function cleanError(error) {
  return (error?.message || 'Test failed without an error message.')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDuration(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

function marketFromTest(test) {
  const suiteMatch = test.parent?.title?.match(/^([A-Z]{2}(?:-FR)?) VIES checkout$/);
  if (suiteMatch) return suiteMatch[1];

  const fileMatch = path.basename(test.location.file || '').match(/^vies-checkout-(.+)\.js$/);
  if (fileMatch) return fileMatch[1].toUpperCase();

  const scenarioMatch = test.title.match(/(?:individual|company)-([A-Z]{2})-to|VIES ([A-Z]{2})-to/);
  return scenarioMatch?.[1] || scenarioMatch?.[2] || 'INNY';
}

function scenarioType(title) {
  if (/individual-/i.test(title)) return 'individual';
  if (/no-vies/i.test(title)) return 'withoutVies';
  return 'withVies';
}

function readPriceVerification(result) {
  const attachment = result.attachments.find(item => item.name === 'VIES price verification');
  if (!attachment?.body) return null;
  try {
    return JSON.parse(Buffer.from(attachment.body).toString('utf8'));
  } catch {
    return null;
  }
}

function priceOutcome(verification) {
  if (!verification?.before || !verification?.after) return { status: 'Brak wyniku', detail: 'Test nie dotarł do porównania cen.' };
  const comparisons = [
    ['suma', verification.before.total, verification.after.total],
    ['suma częściowa', verification.before.subtotal, verification.after.subtotal],
    ['cena produktu', verification.before.itemPrice, verification.after.itemPrice],
  ].filter(([, before, after]) => Number.isFinite(before) && Number.isFinite(after));
  const reduced = comparisons.find(([, before, after]) => after < before);
  if (reduced) return { status: 'Obniżona', detail: `${reduced[0]}: −${(reduced[1] - reduced[2]).toFixed(2)}` };
  return { status: 'Bez zmiany', detail: verification.expectedTotalChange === 'decrease' ? 'Brak obniżki (test powinien nie przejść).' : 'Zgodnie z oczekiwaniem.' };
}

function describeMarketViesResult(results) {
  const viesResults = results.filter(item => item.type === 'withVies');
  if (!viesResults.length) return { result: 'Nie uruchomiono', change: '—' };
  const counts = viesResults.reduce((sum, item) => {
    sum[item.outcome.status] = (sum[item.outcome.status] || 0) + 1;
    return sum;
  }, {});
  const result = Object.entries(counts).map(([status, count]) => count === 1 ? status : `${status}: ${count}×`).join(', ');
  const changes = [...new Set(viesResults.filter(item => item.outcome.status === 'Obniżona').map(item => item.outcome.detail))];
  return { result, change: changes.join(', ') || '—' };
}

function describeOtherScenarios(results) {
  const other = results.filter(item => item.type !== 'withVies');
  const passed = other.filter(item => item.result === 'passed').length;
  const failed = other.filter(item => !['passed', 'skipped'].includes(item.result)).length;
  const skipped = other.filter(item => item.result === 'skipped').length;
  const notes = [`${passed}/${other.length} OK`];
  if (failed) notes.push(`${failed} błąd` + (failed === 1 ? '' : 'y'));
  if (skipped) notes.push(`${skipped} pominięty` + (skipped === 1 ? '' : 'e'));
  return notes.join(' · ');
}

class ViesAuditReporter {
  constructor() {
    this.markets = new Map();
    this.issues = [];
    this.results = [];
    this.startedAt = 0;
    this.viesTestCount = 0;
  }

  onBegin() { this.startedAt = Date.now(); }

  onTestEnd(test, result) {
    if (!test.location.file.includes(`${path.sep}vies${path.sep}`)) return;
    this.viesTestCount += 1;
    const market = marketFromTest(test);
    const summary = this.markets.get(market) || {
      market, passed: 0, failed: 0, skipped: 0, individual: 0, withoutVies: 0, withVies: 0, duration: 0,
    };
    const type = scenarioType(test.title);
    summary[type] += 1;
    if (result.status === 'passed') summary.passed += 1;
    else if (result.status === 'skipped') summary.skipped += 1;
    else summary.failed += 1;
    summary.duration += result.duration;
    this.markets.set(market, summary);

    const verification = readPriceVerification(result);
    const outcome = priceOutcome(verification);
    this.results.push({ market, browser: test.parent.project()?.name || '—', test: test.title, type, result: result.status, duration: result.duration, verification, outcome });

    if (result.status !== 'passed' && result.status !== 'skipped') {
      this.issues.push({
        market,
        browser: test.parent.project()?.name || '—',
        test: test.title,
        error: cleanError(result.errors[0]),
        duration: result.duration,
      });
    }
  }

  onEnd() {
    if (!this.viesTestCount) return;
    const markets = [...this.markets.values()].sort((a, b) => b.failed - a.failed || a.market.localeCompare(b.market));
    const totals = markets.reduce((sum, market) => ({
      passed: sum.passed + market.passed, failed: sum.failed + market.failed, skipped: sum.skipped + market.skipped,
    }), { passed: 0, failed: 0, skipped: 0 });
    const rows = markets.map(market => {
      const marketResults = this.results.filter(item => item.market === market.market);
      const vies = describeMarketViesResult(marketResults);
      return '<tr><td>' + escapeHtml(market.market) + '</td><td>' + escapeHtml(vies.result) + '</td><td>'
        + escapeHtml(vies.change) + '</td><td>' + escapeHtml(describeOtherScenarios(marketResults)) + '</td><td>'
        + market.passed + ' OK · ' + market.failed + ' błędów · ' + market.skipped + ' pominiętych</td><td>'
        + formatDuration(market.duration) + '</td></tr>';
    }).join('');
    const scenarioOrder = { individual: 0, withoutVies: 1, withVies: 2 };
    const resultRows = markets.map(market => {
      const marketResults = this.results
        .filter(item => item.market === market.market)
        .sort((left, right) => scenarioOrder[left.type] - scenarioOrder[right.type] || left.browser.localeCompare(right.browser));
      const rows = marketResults.map(item => '<tr><td>' + escapeHtml(item.browser)
        + '</td><td>' + escapeHtml(item.test) + '</td><td>' + escapeHtml(item.result) + '</td><td>' + escapeHtml(item.outcome.status)
        + '</td><td>' + escapeHtml(item.outcome.detail) + '</td><td>' + formatDuration(item.duration) + '</td></tr>').join('');
      return '<tr class="market-heading"><td colspan="6">Rynek: ' + escapeHtml(market.market) + '</td></tr>' + rows;
    }).join('');
    const issueRows = this.issues.length
      ? this.issues.map(issue => '<tr><td>' + escapeHtml(issue.market) + '</td><td>' + escapeHtml(issue.browser) + '</td><td>'
        + escapeHtml(issue.test) + '</td><td>' + formatDuration(issue.duration) + '</td><td>' + escapeHtml(issue.error) + '</td></tr>').join('')
      : '<tr><td colspan="5" class="empty">Nie wykryto problemów.</td></tr>';
    const html = '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>VIES Audit Report</title><style>body{max-width:1280px;margin:36px auto;padding:0 24px;color:#202124;font:16px/1.5 Arial,sans-serif}h1{margin-bottom:4px}.meta{color:#5f6368;margin-top:0}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.card{min-width:130px;padding:14px 18px;border-radius:8px;background:#f1f3f4}.card strong{display:block;font-size:26px}.failed{background:#fce8e6;color:#b3261e}table{width:100%;border-collapse:collapse;margin:12px 0 36px}th{background:#202124;color:#fff;text-align:left;white-space:nowrap}th,td{padding:10px;border:1px solid #dadce0;vertical-align:top}tr:nth-child(even){background:#f8f9fa}.market-heading td{background:#e8f0fe;font-weight:700;border-top:2px solid #8ab4f8}.empty{text-align:center}</style></head><body>'
      + '<h1>VIES Audit Report</h1><p class="meta">Wygenerowano: ' + escapeHtml(new Date().toLocaleString('pl-PL')) + '</p>'
      + '<div class="cards"><div class="card"><strong>' + totals.passed + '</strong>zaliczone</div><div class="card failed"><strong>' + totals.failed + '</strong>niezaliczone</div><div class="card"><strong>' + totals.skipped + '</strong>pominięte</div><div class="card"><strong>' + markets.length + '</strong>rynki</div><div class="card"><strong>' + formatDuration(Date.now() - this.startedAt) + '</strong>czas runu</div></div>'
      + '<h2>Podsumowanie per rynek</h2><p>„Wynik firmy z VIES” dotyczy wyłącznie scenariusza z ważnym numerem VIES. Pozostałe scenariusze sprawdzają klienta indywidualnego i firmę bez wpisu w VIES.</p><table><thead><tr><th>Rynek</th><th>Wynik firmy z VIES</th><th>Zmiana ceny</th><th>Pozostałe scenariusze</th><th>Status testów</th><th>Czas testów</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<h2>Wyniki cen wszystkich scenariuszy</h2><p>Wyniki są pogrupowane według rynku. „Obniżona” oznacza spadek sumy, sumy częściowej albo ceny produktu; raport podaje różnicę w walucie danego rynku.</p><table><thead><tr><th>Przeglądarka</th><th>Scenariusz</th><th>Status testu</th><th>Wynik ceny</th><th>Różnica / uwaga</th><th>Czas testu</th></tr></thead><tbody>' + resultRows + '</tbody></table>'
      + '<h2>Wykryte problemy</h2><table><thead><tr><th>Rynek</th><th>Przeglądarka</th><th>Scenariusz</th><th>Czas testu</th><th>Błąd</th></tr></thead><tbody>' + issueRows + '</tbody></table></body></html>';
    fs.writeFileSync(path.join(process.cwd(), 'vies-audit-report.html'), html, 'utf8');
  }
}

module.exports = ViesAuditReporter;
