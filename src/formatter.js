const SENTIMENT = {
  Bullish: { border: '#16a34a', bg: '#dcfce7', text: '#15803d', label: 'BULLISH' },
  Neutral:  { border: '#d97706', bg: '#fef3c7', text: '#d97706', label: 'NEUTRAL' },
  Bearish:  { border: '#dc2626', bg: '#fee2e2', text: '#dc2626', label: 'BEARISH' },
};

const yahoo = (ticker) => `https://finance.yahoo.com/quote/${ticker}`;
const changeColor = (pct) => (pct || '').startsWith('-') ? '#dc2626' : '#16a34a';

function summaryRow(r) {
  if (r.error) {
    return `<tr>
      <td style="padding:6px 10px;font-weight:700">
        <a href="${yahoo(r.ticker)}" style="color:#1a202c;text-decoration:none">${r.ticker}</a>
      </td>
      <td colspan="4" style="padding:6px 10px;color:#94a3b8;font-style:italic">Data unavailable</td>
    </tr>`;
  }
  const s = SENTIMENT[r.sentiment] || SENTIMENT.Neutral;
  return `<tr style="border-bottom:1px solid #e2e8f0">
    <td style="padding:6px 10px;font-weight:700">
      <a href="${yahoo(r.ticker)}" style="color:#1a202c;text-decoration:none">${r.ticker}</a>
    </td>
    <td style="padding:6px 10px;color:#374151">${r.price}</td>
    <td style="padding:6px 10px;color:${changeColor(r.change_pct)};font-weight:600">${r.change_pct}</td>
    <td style="padding:6px 10px">
      <span style="background:${s.bg};color:${s.text};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">${s.label}</span>
    </td>
    <td style="padding:6px 10px;color:#374151;font-style:italic;font-size:12px">${r.one_liner || ''}</td>
  </tr>`;
}

function detailCard(r) {
  if (r.error) {
    return `<div style="border:1px solid #e2e8f0;border-top:3px solid #94a3b8;border-radius:10px;margin-bottom:20px;overflow:hidden;background:#fff">
      <div style="padding:16px">
        <span style="font-size:22px;font-weight:800">
          <a href="${yahoo(r.ticker)}" style="color:#1a202c;text-decoration:none">${r.ticker}</a>
        </span>
        <p style="color:#94a3b8;margin:8px 0 0;font-style:italic">Data unavailable — API error</p>
      </div>
    </div>`;
  }

  const s = SENTIMENT[r.sentiment] || SENTIMENT.Neutral;

  const analystHTML = (r.analyst_targets || [])
    .map(a => `<li><a href="${a.url}" style="color:#3b82f6">${a.firm}</a>: ${a.target} — ${a.action}</li>`)
    .join('') || '<li style="color:#94a3b8">No data</li>';

  const newsHTML = (r.news || [])
    .map(n => `<li><a href="${n.url}" style="color:#3b82f6">${n.headline}</a></li>`)
    .join('') || '<li style="color:#94a3b8">No data</li>';

  const risksHTML = (r.risks || [])
    .map(risk => `<li>${risk}</li>`)
    .join('') || '<li style="color:#94a3b8">No data</li>';

  const competitorsHTML = (r.competitors || [])
    .map(c => `<a href="${yahoo(c)}" style="display:inline-block;background:#f1f5f9;color:#475569;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;text-decoration:none;margin:2px">${c}</a>`)
    .join(' ');

  return `<div style="border:1px solid #e2e8f0;border-top:3px solid ${s.border};border-radius:10px;margin-bottom:20px;overflow:hidden;background:#fff">
    <div style="padding:16px;background:linear-gradient(135deg,${s.bg}55,#fff);border-bottom:1px solid #e2e8f0">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:22px;font-weight:800">
            <a href="${yahoo(r.ticker)}" style="color:#1a202c;text-decoration:none">${r.ticker}</a>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:700">${r.price}</div>
          <div style="color:${changeColor(r.change_pct)};font-weight:600">${r.change_pct}</div>
          <div style="display:inline-block;background:${s.bg};color:${s.text};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-top:4px">${s.label}</div>
        </div>
      </div>
      <p style="margin:12px 0 0;color:#374151;font-style:italic;font-size:13px">"${r.one_liner || ''}"</p>
    </div>
    <div style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
      <div>
        <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#94a3b8;margin-bottom:6px">Analyst Targets</div>
        <ul style="margin:0;padding-left:16px;color:#374151">${analystHTML}</ul>
      </div>
      <div>
        <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#94a3b8;margin-bottom:6px">Key Risks</div>
        <ul style="margin:0;padding-left:16px;color:#374151">${risksHTML}</ul>
      </div>
    </div>
    <div style="padding:0 16px 14px;font-size:13px">
      <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#94a3b8;margin-bottom:6px">News (48h)</div>
      <ul style="margin:0;padding-left:16px;color:#374151">${newsHTML}</ul>
    </div>
    ${competitorsHTML ? `<div style="padding:0 16px 14px">
      <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#94a3b8;margin-bottom:6px">Competitors</div>
      ${competitorsHTML}
    </div>` : ''}
  </div>`;
}

function estimateCost(usage) {
  return (usage.input_tokens / 1e6) * 3 + (usage.output_tokens / 1e6) * 15;
}

function usageFooterHTML(usage) {
  if (!usage) return '';
  const cost = estimateCost(usage);
  return `
  <div style="display:flex;justify-content:center;margin-top:10px">
    <div style="background:#f1f5f9;border-radius:8px;padding:6px 16px;display:inline-flex;gap:10px;align-items:center;font-size:11px;color:#64748b">
      <span>📊 <strong style="color:#475569">${usage.input_tokens.toLocaleString()}</strong> input</span>
      <span style="color:#cbd5e1">·</span>
      <span><strong style="color:#475569">${usage.output_tokens.toLocaleString()}</strong> output tokens</span>
      <span style="color:#cbd5e1">·</span>
      <span>est. <strong style="color:#475569">$${cost.toFixed(3)}</strong></span>
    </div>
  </div>`;
}

export function formatHTML(results, date, model, usage = null) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;padding:20px;background:#f8fafc;color:#1a202c">
  <div style="background:#1e293b;color:#f8fafc;padding:16px 20px;border-radius:10px;margin-bottom:24px">
    <h1 style="margin:0;font-size:20px">📈 Daily Stock Digest — ${date}</h1>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <div style="background:#f1f5f9;padding:10px 16px;font-weight:700;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.05em">Quick Summary</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${results.map(summaryRow).join('')}
    </table>
  </div>
  ${results.map(detailCard).join('')}
  <div style="text-align:center;color:#94a3b8;font-size:11px;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0">
    Generated by Claude ${model} with web search
    ${usageFooterHTML(usage)}
  </div>
</body>
</html>`;
}

export function formatText(results, date, model, usage = null) {
  const lines = [`📈 Daily Stock Digest — ${date}`, '='.repeat(50), ''];
  for (const r of results) {
    if (r.error) { lines.push(`[${r.ticker}] Data unavailable`, ''); continue; }
    lines.push(`${r.ticker} — ${r.price} (${r.change_pct}) — ${r.sentiment.toUpperCase()}`, `"${r.one_liner || ''}"`, '');
    if (r.analyst_targets?.length) {
      lines.push('Analyst Targets:');
      r.analyst_targets.forEach(a => lines.push(`  - ${a.firm}: ${a.target} (${a.action}) ${a.url}`));
      lines.push('');
    }
    if (r.news?.length) {
      lines.push('News:');
      r.news.forEach(n => lines.push(`  - ${n.headline} ${n.url}`));
      lines.push('');
    }
    if (r.risks?.length) {
      lines.push('Risks:', ...r.risks.map(risk => `  - ${risk}`), '');
    }
    if (r.competitors?.length) {
      lines.push(`Competitors: ${r.competitors.join(', ')}`, '');
    }
    lines.push('-'.repeat(50), '');
  }
  lines.push(`Generated by Claude ${model} with web search`);
  if (usage) {
    const cost = estimateCost(usage);
    lines.push(`📊 ${usage.input_tokens.toLocaleString()} input · ${usage.output_tokens.toLocaleString()} output tokens · est. $${cost.toFixed(3)}`);
  }
  return lines.join('\n');
}
