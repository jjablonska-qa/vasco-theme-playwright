const fs = require('fs');
const path = require('path');

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

function marketFromTitle(title) {
  return title.match(/^([A-Z]{2}(?:\s(?:FR|NL))?) COD/)?.[1] ?? 'INNY';
}

function scenarioFromTitle(title) {
  const match = title.match(/COD dla (?:zamówienia )?(.+?) jest (widoczne|ukryte)(?:\s*-\s*(.+))?$/i);
  if (match) {
    return {
      name: [match[1], match[3]].filter(Boolean).join(' — '),
      expected: match[2].toLowerCase(),
    };
  }

  return { name: title, expected: 'sprawdź opis testu' };
}

function statusLabel(status) {
  return { passed: 'zaliczony', failed: 'błąd', timedOut: 'timeout', skipped: 'pominięty' }[status] ?? status;
}

class CodAuditReporter {
  constructor() {
    this.markets = new Map();
    this.results = [];
    this.issues = [];
    this.startedAt = 0;
    this.codTestCount = 0;
  }

  onBegin() {
    this.startedAt = Date.now();
  }

  onTestEnd(test, result) {
    if (!test.location.file.includes(`${path.sep}cod${path.sep}`)) return;

    this.codTestCount += 1;
    const market = marketFromTitle(test.title);
    const scenario = scenarioFromTitle(test.title);
    const summary = this.markets.get(market) || {
      market, passed: 0, failed: 0, skipped: 0, duration: 0,
    };

    if (result.status === 'passed') summary.passed += 1;
    else if (result.status === 'skipped') summary.skipped += 1;
    else summary.failed += 1;
    summary.duration += result.duration;
    this.markets.set(market, summary);

    this.results.push({
      market,
      browser: test.parent.project()?.name || '—',
      test: test.title,
      scenario: scenario.name,
      expected: scenario.expected,
      status: result.status,
      duration: result.duration,
    });

    if (result.status !== 'passed' && result.status !== 'skipped') {
      this.issues.push({
        market,
        browser: test.parent.project()?.name || '—',
        test: test.title,
        duration: result.duration,
        error: cleanError(result.errors[0]),
      });
    }
  }

  onEnd() {
    if (!this.codTestCount) return;

    const markets = [...this.markets.values()]
      .sort((left, right) => right.failed - left.failed || left.market.localeCompare(right.market));
    const totals = markets.reduce((sum, market) => ({
      passed: sum.passed + market.passed,
      failed: sum.failed + market.failed,
      skipped: sum.skipped + market.skipped,
    }), { passed: 0, failed: 0, skipped: 0 });

    const summaryRows = markets.map(market => {
      const scenarios = new Map();
      this.results.filter(result => result.market === market.market).forEach(result => {
        const item = scenarios.get(result.scenario) || { expected: result.expected, results: [] };
        item.results.push(result);
        scenarios.set(result.scenario, item);
      });
      const scenarioSummary = [...scenarios.entries()].map(([name, item]) => {
        const browserStatuses = item.results
          .sort((left, right) => left.browser.localeCompare(right.browser))
          .map(result => `<span class="status ${escapeHtml(result.status)}">${escapeHtml(result.browser)}: ${escapeHtml(statusLabel(result.status))}</span>`)
          .join('');
        return `<div class="scenario"><strong>${escapeHtml(name)}</strong><span class="expected">COD: ${escapeHtml(item.expected)}</span><div class="browsers">${browserStatuses}</div></div>`;
      }).join('');
      return '<tr><td>' + escapeHtml(market.market) + '</td><td>' + scenarioSummary + '</td><td>'
        + market.passed + ' OK · ' + market.failed + ' błędów · ' + market.skipped + ' pominiętych</td><td>'
        + formatDuration(market.duration) + '</td></tr>';
    }).join('');

    const detailRows = markets.map(market => {
      const scenarios = this.results
        .filter(result => result.market === market.market)
        .sort((left, right) => left.scenario.localeCompare(right.scenario));
      const rows = scenarios.map(result => '<tr><td>' + escapeHtml(result.browser) + '</td><td>' + escapeHtml(result.scenario)
        + '</td><td>' + escapeHtml(result.expected) + '</td><td>' + escapeHtml(statusLabel(result.status))
        + '</td><td>' + formatDuration(result.duration) + '</td></tr>').join('');
      return '<tr class="market-heading"><td colspan="5">Rynek: ' + escapeHtml(market.market) + '</td></tr>' + rows;
    }).join('');

    const issueRows = this.issues.length
      ? this.issues.map(issue => '<tr><td>' + escapeHtml(issue.market) + '</td><td>' + escapeHtml(issue.browser)
        + '</td><td>' + escapeHtml(issue.test) + '</td><td>' + formatDuration(issue.duration)
        + '</td><td>' + escapeHtml(issue.error) + '</td></tr>').join('')
      : '<tr><td colspan="5" class="empty">Nie wykryto problemów.</td></tr>';

    const html = '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>COD Audit Report</title><style>body{max-width:1280px;margin:36px auto;padding:0 24px;color:#202124;font:16px/1.5 Arial,sans-serif}h1{margin-bottom:4px}.meta{color:#5f6368;margin-top:0}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.card{min-width:130px;padding:14px 18px;border-radius:8px;background:#f1f3f4}.card strong{display:block;font-size:26px}.failed{background:#fce8e6;color:#b3261e}table{width:100%;border-collapse:collapse;margin:12px 0 36px}th{background:#202124;color:#fff;text-align:left;white-space:nowrap}th,td{padding:10px;border:1px solid #dadce0;vertical-align:top}tr:nth-child(even){background:#f8f9fa}.market-heading td{background:#e8f0fe;font-weight:700;border-top:2px solid #8ab4f8}.scenario{padding:7px 0;border-bottom:1px solid #e2e4e8}.scenario:last-child{border-bottom:0}.expected{margin-left:8px;color:#5f6368;font-size:14px}.browsers{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}.status{padding:2px 6px;border-radius:4px;background:#f1f3f4;font-size:13px}.status.passed{background:#e6f4ea;color:#137333}.status.failed,.status.timedOut{background:#fce8e6;color:#b3261e}.status.skipped{background:#fef7e0;color:#8d6708}.empty{text-align:center}</style></head><body>'
      + '<h1>COD Audit Report</h1><p class="meta">Wygenerowano: ' + escapeHtml(new Date().toLocaleString('pl-PL')) + '</p>'
      + '<div class="cards"><div class="card"><strong>' + totals.passed + '</strong>zaliczone</div><div class="card failed"><strong>' + totals.failed + '</strong>niezaliczone</div><div class="card"><strong>' + totals.skipped + '</strong>pominięte</div><div class="card"><strong>' + markets.length + '</strong>rynki</div><div class="card"><strong>' + formatDuration(Date.now() - this.startedAt) + '</strong>czas runu</div></div>'
      + '<h2>Co sprawdzają te testy?</h2><p>Każdy scenariusz buduje wskazany koszyk, przechodzi przez checkout i sprawdza, czy płatność za pobraniem jest widoczna albo ukryta zgodnie z limitem COD danego rynku. Test zatrzymuje się przed płatnością i nie składa zamówienia.</p>'
      + '<h2>Podsumowanie per rynek</h2><table><thead><tr><th>Rynek</th><th>Scenariusze</th><th>Status testów</th><th>Czas testów</th></tr></thead><tbody>' + summaryRows + '</tbody></table>'
      + '<h2>Wyniki wszystkich scenariuszy</h2><p>Wyniki są pogrupowane według rynku. „Oczekiwana widoczność” informuje, czy test spodziewa się widocznej albo ukrytej płatności za pobraniem.</p><table><thead><tr><th>Przeglądarka</th><th>Koszyk</th><th>Oczekiwana widoczność</th><th>Status testu</th><th>Czas testu</th></tr></thead><tbody>' + detailRows + '</tbody></table>'
      + '<h2>Wykryte problemy</h2><table><thead><tr><th>Rynek</th><th>Przeglądarka</th><th>Scenariusz</th><th>Czas testu</th><th>Błąd</th></tr></thead><tbody>' + issueRows + '</tbody></table></body></html>';

    fs.writeFileSync(path.join(process.cwd(), 'cod-audit-report.html'), html, 'utf8');
  }
}

module.exports = CodAuditReporter;
