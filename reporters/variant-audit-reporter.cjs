const fs = require('fs');
const path = require('path');

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const cleanError = error => (error?.message || 'Test failed without an error message.')
  .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s+/g, ' ').trim();

const formatDuration = milliseconds => {
  const seconds = Math.round(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
};

const statusLabel = status => ({ passed: 'zaliczony', failed: 'błąd', skipped: 'pominięty', timedOut: 'timeout' }[status] || status);

function marketFromTitle(title) {
  return title.match(/^Warianty (.+?):/)?.[1] || 'Nieznany';
}

function scenarioFromResult(result) {
  const attachment = result.attachments.find(item => item.name === 'Variant scenario');
  if (!attachment?.body) return { selected: [], skipped: [] };
  try { return JSON.parse(attachment.body.toString()); } catch { return { selected: [], skipped: [] }; }
}

class VariantAuditReporter {
  constructor() { this.results = []; this.startedAt = 0; }

  onBegin() { this.startedAt = Date.now(); }

  onTestEnd(test, result) {
    if (!test.title.startsWith('Warianty ')) return;
    this.results.push({
      market: marketFromTitle(test.title),
      status: result.status,
      duration: result.duration,
      browser: test.parent.project()?.name || '—',
      scenario: scenarioFromResult(result),
      error: result.status === 'passed' || result.status === 'skipped' ? '' : cleanError(result.errors[0]),
    });
  }

  onEnd() {
    if (!this.results.length) return;
    const totals = this.results.reduce((sum, item) => ({ ...sum, [item.status]: (sum[item.status] || 0) + 1 }), {});
    const rows = this.results.sort((a, b) => a.market.localeCompare(b.market)).map(item => {
      const selected = item.scenario.selected.length
        ? item.scenario.selected.map(product => `<li><strong>${escapeHtml(product.category)}</strong>: ${escapeHtml(product.productName)} — ${escapeHtml(product.colour)}${product.size ? `, ${escapeHtml(product.size)}` : ''}</li>`).join('')
        : '<span class="muted">Brak danych (test przerwany przed końcem scenariusza).</span>';
      const skipped = item.scenario.skipped.length ? escapeHtml(item.scenario.skipped.join(', ')) : '—';
      return `<tr><td>${escapeHtml(item.market)}</td><td><span class="status ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td><td><ul>${selected}</ul></td><td>${skipped}</td><td>${formatDuration(item.duration)}</td><td>${escapeHtml(item.error || '—')}</td></tr>`;
    }).join('');

    const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Variant Audit Report</title><style>
body{max-width:1400px;margin:36px auto;padding:0 24px;color:#202124;font:16px/1.5 Arial,sans-serif}h1{margin-bottom:4px}.meta,.muted{color:#5f6368}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.card{min-width:120px;padding:14px 18px;border-radius:8px;background:#f1f3f4}.card strong{display:block;font-size:26px}.card.fail{background:#fce8e6;color:#b3261e}table{width:100%;border-collapse:collapse;margin:12px 0 36px}th{background:#202124;color:#fff;text-align:left}th,td{padding:10px;border:1px solid #dadce0;vertical-align:top}tr:nth-child(even){background:#f8f9fa}ul{margin:0;padding-left:18px}.status{display:inline-block;padding:3px 7px;border-radius:4px;background:#f1f3f4;font-size:13px}.status.passed{background:#e6f4ea;color:#137333}.status.failed,.status.timedOut{background:#fce8e6;color:#b3261e}.status.skipped{background:#fef7e0;color:#8d6708}
</style></head><body><h1>Variant Audit Report</h1><p class="meta">Wygenerowano: ${escapeHtml(new Date().toLocaleString('pl-PL'))}</p><div class="cards"><div class="card"><strong>${totals.passed || 0}</strong>zaliczone</div><div class="card fail"><strong>${(totals.failed || 0) + (totals.timedOut || 0)}</strong>błędy / timeouty</div><div class="card"><strong>${totals.skipped || 0}</strong>pominięte</div><div class="card"><strong>${this.results.length}</strong>rynki</div><div class="card"><strong>${formatDuration(Date.now() - this.startedAt)}</strong>czas runu</div></div><h2>Co sprawdzają testy?</h2><p>Test wybiera kolejny dostępny wariant produktu, dodaje go do koszyka i potwierdza nazwę produktu oraz kolor. Dla skarpetek potwierdza także rozmiar. Kategorie bez alternatywnego dostępnego wariantu są raportowane jako pominięte, bez zmiany wyniku testu na błąd.</p><h2>Wyniki per rynek</h2><table><thead><tr><th>Rynek</th><th>Status</th><th>Wybrane warianty</th><th>Pominięte kategorie</th><th>Czas</th><th>Błąd</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    fs.writeFileSync(path.join(process.cwd(), 'variant-audit-report.html'), html, 'utf8');
  }
}

module.exports = VariantAuditReporter;
