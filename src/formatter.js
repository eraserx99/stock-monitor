import { sparklinePNG, chartPNG } from './charts.js';

const SENTIMENT = {
  Bullish: { border: '#22c55e', bg: '#052e16', text: '#4ade80', label: 'BULLISH' },
  Neutral:  { border: '#f59e0b', bg: '#1c1400', text: '#fbbf24', label: 'NEUTRAL' },
  Bearish:  { border: '#ef4444', bg: '#1c0000', text: '#f87171', label: 'BEARISH' },
};

const SECTOR_COLORS = {
  'Technology':             { border: '#3b82f6', bg: '#0c1a2e', text: '#60a5fa' },
  'Utilities':              { border: '#22c55e', bg: '#052e16', text: '#4ade80' },
  'Industrials':            { border: '#f59e0b', bg: '#1c1400', text: '#fbbf24' },
  'Healthcare':             { border: '#a855f7', bg: '#1a0a2e', text: '#c084fc' },
  'Communication Services': { border: '#ef4444', bg: '#1c0000', text: '#f87171' },
};
const SECTOR_ORDER = ['Technology', 'Utilities', 'Industrials', 'Healthcare', 'Communication Services'];

function groupBySector(results) {
  const groups = {};
  for (const r of results) {
    const s = r.sector || 'Other';
    (groups[s] ??= []).push(r);
  }
  return Object.entries(groups).sort(([a], [b]) => {
    const ai = SECTOR_ORDER.indexOf(a), bi = SECTOR_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

function sectorHeaderRow(sector, count) {
  const s = SECTOR_COLORS[sector] || { border: '#64748b', bg: '#1e293b', text: '#94a3b8' };
  return `<tr style="background:${s.bg};border-top:2px solid ${s.border}">
    <td colspan="6" style="padding:5px 12px;font-size:10px;font-weight:700;color:${s.text};text-transform:uppercase;letter-spacing:.08em">${esc(sector)} <span style="font-weight:400;opacity:.7">(${count})</span></td>
  </tr>`;
}

function sparklineHTML(prices) {
  const buf = sparklinePNG(prices);
  if (!buf) return '<span style="color:#334155;font-size:10px">—</span>';
  return `<img src="data:image/png;base64,${buf.toString('base64')}" width="80" height="24" style="display:block;vertical-align:middle"/>`;
}

function earningsSectionHTML(earnings) {
  if (!earnings) return '';
  const rows = (earnings.history || []).slice(0, 4).map(q => {
    if (q.epsActual == null) return '';
    const color = q.beat == null ? '#94a3b8' : q.beat ? '#4ade80' : '#f87171';
    const icon = q.beat == null ? '' : q.beat ? '▲' : '▼';
    const est = q.epsEstimate != null ? ` vs est <span style="color:#64748b">$${q.epsEstimate.toFixed(2)}</span>` : '';
    const surp = q.surprisePct ? `<span style="color:${color}"> ${esc(q.surprisePct)}</span>` : '';
    return `<div style="margin-bottom:3px"><span style="color:${color};font-weight:700;margin-right:4px">${icon} ${esc(q.quarter || '')}</span>EPS <strong style="color:#f1f5f9">$${q.epsActual.toFixed(2)}</strong>${est}${surp}</div>`;
  }).filter(Boolean).join('');

  const next = [];
  const nextDateDisplay = earnings.nextDate
    ? `<strong style="color:#f1f5f9">${esc(earnings.nextDate)}</strong>`
    : `<span style="color:#475569">TBD</span>`;
  next.push(`Next: ${nextDateDisplay}`);
  if (earnings.nextEpsEstimate != null) next.push(`Est EPS: <strong style="color:#f1f5f9">$${earnings.nextEpsEstimate.toFixed(2)}</strong>${earnings.currentQuarterLabel ? ` <span style="color:#475569">(${esc(earnings.currentQuarterLabel)})</span>` : ''}`);
  const nextHTML = `<div style="margin-top:6px;color:#64748b;font-size:11px">${next.join(' · ')}</div>`;

  if (!rows && !nextHTML) return '';
  return `<div style="padding:0 16px 14px;font-size:12px">
    <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:6px">Earnings</div>
    <div style="color:#cbd5e1">${rows}${nextHTML}</div>
  </div>`;
}

function detailChartHTML(dailyChart) {
  if (!dailyChart?.closes?.length) return '';
  const { closes, vwap30 } = dailyChart;
  const n = closes.length;
  if (n < 2) return '';

  const buf = chartPNG(dailyChart);
  if (!buf) return '';

  const priceColor = closes[n - 1] >= closes[0] ? '#4ade80' : '#f87171';
  const lastVwap = [...vwap30].reverse().find(v => v != null) ?? null;
  const lastClose = closes[n - 1];
  const vwapDiff = lastVwap != null ? ((lastClose - lastVwap) / lastVwap * 100) : null;
  const vwapLegend = lastVwap != null
    ? `$${lastVwap.toFixed(2)} <span style="color:${vwapDiff >= 0 ? '#4ade80' : '#f87171'}">(${vwapDiff >= 0 ? '+' : ''}${vwapDiff.toFixed(1)}%)</span>`
    : '';

  return `<div style="padding:0 16px 14px">
    <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:6px">1-Year Chart</div>
    <img src="data:image/png;base64,${buf.toString('base64')}" width="100%" style="display:block;border-radius:6px;max-width:600px"/>
    <div style="display:flex;gap:14px;margin-top:5px;font-size:10px;color:#64748b;flex-wrap:wrap;align-items:center">
      <span><span style="color:${priceColor}">──</span> Price</span>
      <span><span style="color:#60a5fa">──</span> MA50</span>
      <span><span style="color:#fb923c">──</span> MA200</span>
      <span><span style="color:#c084fc">- -</span> VWAP(30d)${vwapLegend ? ` <strong style="color:#f1f5f9">${vwapLegend}</strong>` : ''}</span>
    </div>
  </div>`;
}

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC_MAP[c]);
const safeUrl = url => /^https?:\/\//i.test(url) ? url : '#';

const yahoo = (ticker) => `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
const changeColor = (pct) => (pct || '').startsWith('-') ? '#f87171' : '#4ade80';

const SOURCE_ICONS = { 'Yahoo Finance': '📊', 'Finnhub': '📡', 'Web Search': '🔍' };
function sourceBadge(source) {
  if (!source) return '';
  const icon = SOURCE_ICONS[source] || '📌';
  return `<span style="font-size:10px;background:#334155;color:#94a3b8;padding:2px 8px;border-radius:8px;font-weight:500;vertical-align:middle;margin-left:8px">${icon} ${esc(source)}</span>`;
}

const ANALYST_SOURCE_STYLE = {
  Yahoo:   { bg: '#1e1b4b', text: '#a5b4fc', icon: '📊' },
  Finnhub: { bg: '#0c2a3a', text: '#7dd3fc', icon: '📡' },
};
function analystSourcePill(source) {
  if (!source) return '';
  const s = ANALYST_SOURCE_STYLE[source] || { bg: '#1e293b', text: '#94a3b8', icon: '📌' };
  return `<span style="background:${s.bg};color:${s.text};font-size:9px;padding:1px 5px;border-radius:4px;font-weight:600;margin-right:5px;white-space:nowrap">${s.icon} ${esc(source)}</span>`;
}

function summaryRow(r) {
  if (r.error) {
    return `<tr>
      <td style="padding:6px 10px;font-weight:700">
        <a href="${yahoo(r.ticker)}" style="color:#f1f5f9;text-decoration:none">${esc(r.ticker)}</a>
      </td>
      <td colspan="5" style="padding:6px 10px;color:#64748b;font-style:italic">Data unavailable</td>
    </tr>`;
  }
  const s = SENTIMENT[r.sentiment] || SENTIMENT.Neutral;
  const nextEarnings = r.earnings?.nextDate;
  const earningsLabel = r.earnings
    ? (nextEarnings ? (() => {
        const [, m, d] = nextEarnings.match(/^\d{4}-(\d{2})-(\d{2})$/) || [];
        if (!m) return 'TBD';
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
      })() : 'TBD')
    : null;
  return `<tr style="border-bottom:1px solid #334155">
    <td style="padding:6px 10px;font-weight:700">
      <a href="${yahoo(r.ticker)}" style="color:#f1f5f9;text-decoration:none">${esc(r.ticker)}</a>
      ${earningsLabel ? `<div style="font-size:9px;color:#475569;font-weight:400;margin-top:2px">📅 ${earningsLabel}</div>` : ''}
    </td>
    <td style="padding:6px 10px;color:#cbd5e1;white-space:nowrap">${esc(r.price)}</td>
    <td style="padding:6px 10px;color:${changeColor(r.change_pct)};font-weight:600;white-space:nowrap">${esc(r.change_pct)}</td>
    <td style="padding:6px 10px">
      <span style="background:${s.bg};color:${s.text};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">${s.label}</span>
    </td>
    <td style="padding:4px 10px">${sparklineHTML(r.sparkline)}</td>
    <td style="padding:6px 10px;color:#94a3b8;font-style:italic;font-size:12px">${esc(r.one_liner)}</td>
  </tr>`;
}

function detailCard(r, benchmark = null) {
  if (r.error) {
    return `<div style="border:1px solid #334155;border-top:3px solid #475569;border-radius:10px;margin-bottom:20px;overflow:hidden;background:#1e293b">
      <div style="padding:16px">
        <span style="font-size:22px;font-weight:800">
          <a href="${yahoo(r.ticker)}" style="color:#f1f5f9;text-decoration:none">${esc(r.ticker)}</a>
        </span>
        <p style="color:#64748b;margin:8px 0 0;font-style:italic">Data unavailable — API error</p>
      </div>
    </div>`;
  }

  const s = SENTIMENT[r.sentiment] || SENTIMENT.Neutral;

  const analystHTML = (r.analyst_targets || [])
    .map(a => `<li style="margin-bottom:4px">${analystSourcePill(a.source)}<a href="${esc(safeUrl(a.url))}" style="color:#60a5fa">${esc(a.firm)}</a>: ${esc(a.target)} — ${esc(a.action)}</li>`)
    .join('') || '<li style="color:#64748b">No data</li>';

  const newsHTML = (r.news || [])
    .map(n => `<li style="margin-bottom:4px"><a href="${esc(safeUrl(n.url))}" style="color:#60a5fa">${esc(n.headline)}</a>${n.source ? `<span style="color:#64748b;font-size:10px;margin-left:6px">via ${esc(n.source)}</span>` : ''}</li>`)
    .join('') || '<li style="color:#64748b">No data</li>';

  const risksHTML = (r.risks || [])
    .map(risk => `<li>${esc(risk)}</li>`)
    .join('') || '<li style="color:#64748b">No data</li>';

  const competitorsHTML = (r.competitors || [])
    .map(c => `<a href="${yahoo(c)}" style="display:inline-block;background:#334155;color:#94a3b8;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;text-decoration:none;margin:2px">${esc(c)}</a>`)
    .join(' ');

  return `<div style="border:1px solid #334155;border-top:3px solid ${s.border};border-radius:10px;margin-bottom:20px;overflow:hidden;background:#1e293b">
    <div style="padding:16px;background:linear-gradient(135deg,${s.bg}cc,#1e293b);border-bottom:1px solid #334155">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:22px;font-weight:800">
            <a href="${yahoo(r.ticker)}" style="color:#f1f5f9;text-decoration:none">${esc(r.ticker)}</a>
            ${sourceBadge(r.source)}
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:700;color:#f1f5f9">${esc(r.price)}</div>
          <div style="color:${changeColor(r.change_pct)};font-weight:600">${esc(r.change_pct)}</div>
          <div style="display:inline-block;background:${s.bg};color:${s.text};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-top:4px">${s.label}</div>
        </div>
      </div>
      <p style="margin:12px 0 0;color:#94a3b8;font-style:italic;font-size:13px">"${esc(r.one_liner)}"</p>
    </div>
    <div style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
      <div>
        <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:6px">Analyst Targets</div>
        <ul style="margin:0;padding-left:16px;color:#cbd5e1">${analystHTML}</ul>
      </div>
      <div>
        <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:6px">Key Risks</div>
        <ul style="margin:0;padding-left:16px;color:#cbd5e1">${risksHTML}</ul>
      </div>
    </div>
    ${performanceOverviewHTML(r.performance, benchmark)}
    ${detailChartHTML(r.dailyChart)}
    ${earningsSectionHTML(r.earnings)}
    ${newsSummaryHTML(r.news_summary)}
    <div style="padding:0 16px 14px;font-size:13px">
      <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:6px">News (48h)</div>
      <ul style="margin:0;padding-left:16px;color:#cbd5e1">${newsHTML}</ul>
    </div>
    ${competitorsHTML ? `<div style="padding:0 16px 14px">
      <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:6px">Competitors</div>
      ${competitorsHTML}
    </div>` : ''}
  </div>`;
}

function newsSummaryHTML(summary) {
  if (!summary) return '';
  // Escape HTML first, then convert **bold** markers to <strong>
  const safe = esc(summary).replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#f1f5f9">$1</strong>');
  return `<div style="margin:0 16px 14px;padding:12px 14px;background:#0f172a;border:1px solid #1e3a5f;border-left:3px solid #3b82f6;border-radius:6px">
    <div style="font-size:10px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">⚡ News Summary</div>
    <div style="font-size:13px;color:#94a3b8;line-height:1.6">${safe}</div>
    <div style="font-size:10px;color:#334155;margin-top:8px">Powered by Claude</div>
  </div>`;
}

function performanceOverviewHTML(perf, benchmark) {
  if (!perf) return '';
  const periods = [
    { label: 'YTD Return',    stock: perf.ytd,       sp: benchmark?.ytd },
    { label: '1-Year Return', stock: perf.oneYear,   sp: benchmark?.oneYear },
    { label: '3-Year Return', stock: perf.threeYear, sp: benchmark?.threeYear },
    { label: '5-Year Return', stock: perf.fiveYear,  sp: benchmark?.fiveYear },
  ].filter(p => p.stock != null);

  if (!periods.length) return '';

  function fmt(val) {
    if (val == null) return '—';
    return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
  }

  const cards = periods.map(p => {
    const stockColor = p.stock >= 0 ? '#4ade80' : '#f87171';
    const spColor = p.sp == null ? '#64748b' : p.sp >= 0 ? '#4ade80' : '#f87171';
    return `<div style="flex:1;min-width:120px;background:#0f172a;border-radius:8px;padding:10px 12px">
      <div style="font-size:10px;font-weight:600;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">${p.label}</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div>
          <div style="font-size:9px;color:#475569;margin-bottom:2px">This stock</div>
          <div style="font-size:15px;font-weight:700;color:${stockColor}">${fmt(p.stock)}</div>
        </div>
        ${p.sp != null ? `<div style="text-align:right">
          <div style="font-size:9px;color:#475569;margin-bottom:2px">S&amp;P 500</div>
          <div style="font-size:13px;font-weight:600;color:${spColor}">${fmt(p.sp)}</div>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div style="padding:0 16px 14px">
    <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:8px">Performance Overview <span style="font-weight:400;text-transform:none;color:#334155">(total return, incl. dividends)</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${cards}</div>
  </div>`;
}

function ipoSectionHTML(ipos) {
  if (!ipos || ipos.length === 0) return '';

  function fmtDate(d) {
    if (!d) return '—';
    const [, m, day] = d.match(/^\d{4}-(\d{2})-(\d{2})$/) || [];
    if (!m) return d;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[parseInt(m, 10) - 1]} ${parseInt(day, 10)}`;
  }

  function fmtSize(val) {
    if (!val) return '—';
    if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
    if (val >= 1e6) return `$${Math.round(val / 1e6)}M`;
    return `$${val.toLocaleString()}`;
  }

  const rows = ipos.map(ipo => {
    const statusColor = ipo.status === 'priced' ? '#4ade80' : '#fbbf24';
    const symbol = ipo.symbol ? `<span style="color:#64748b;font-size:10px;margin-left:4px">${esc(ipo.symbol)}</span>` : '';
    return `<tr style="border-bottom:1px solid #1e293b">
      <td style="padding:6px 10px;font-weight:600;color:#f1f5f9">${esc(ipo.name || '—')}${symbol}</td>
      <td style="padding:6px 10px;color:#94a3b8;white-space:nowrap">${fmtDate(ipo.date)}</td>
      <td style="padding:6px 10px;color:#94a3b8">${esc(ipo.exchange || '—')}</td>
      <td style="padding:6px 10px;color:#94a3b8;white-space:nowrap">${esc(ipo.price || '—')}</td>
      <td style="padding:6px 10px;color:#94a3b8;white-space:nowrap">${fmtSize(ipo.totalSharesValue)}</td>
      <td style="padding:6px 10px"><span style="color:${statusColor};font-size:10px;font-weight:600;text-transform:uppercase">${esc(ipo.status)}</span></td>
    </tr>`;
  }).join('');

  return `<div style="background:#1e293b;border:1px solid #334155;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <div style="background:#0f172a;padding:10px 16px;font-weight:700;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">🚀 Upcoming IPOs (30 days)</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#0f172a;border-bottom:2px solid #334155">
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Company</th>
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Date</th>
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Exchange</th>
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Price Range</th>
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Size</th>
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Status</th>
      </tr>
      ${rows}
    </table>
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
    <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:6px 16px;display:inline-flex;gap:10px;align-items:center;font-size:11px;color:#64748b">
      <span>📊 <strong style="color:#94a3b8">${usage.input_tokens.toLocaleString()}</strong> input</span>
      <span style="color:#334155">·</span>
      <span><strong style="color:#94a3b8">${usage.output_tokens.toLocaleString()}</strong> output tokens</span>
      <span style="color:#334155">·</span>
      <span>est. <strong style="color:#94a3b8">$${cost.toFixed(3)}</strong></span>
    </div>
  </div>`;
}

export function formatHTML(results, date, model, usage = null, ipos = [], benchmark = null) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;padding:20px;background:#0f172a;color:#f1f5f9">
  <div style="background:#1e293b;border:1px solid #334155;padding:16px 20px;border-radius:10px;margin-bottom:24px">
    <h1 style="margin:0;font-size:20px;color:#f1f5f9">📈 Daily Stock Digest — ${date}</h1>
  </div>
  <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <div style="background:#0f172a;padding:10px 16px;font-weight:700;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Quick Summary</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#0f172a;border-bottom:2px solid #334155">
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Ticker</th>
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Price</th>
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Change</th>
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Sentiment</th>
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">6M Trend</th>
        <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Analysis</th>
      </tr>
      ${groupBySector(results).flatMap(([sector, tickers]) => [sectorHeaderRow(sector, tickers.length), ...tickers.map(summaryRow)]).join('')}
    </table>
  </div>
  ${ipoSectionHTML(ipos)}
  ${results.map(r => detailCard(r, benchmark)).join('')}
  <div style="text-align:center;color:#64748b;font-size:11px;margin-top:24px;padding-top:16px;border-top:1px solid #334155">
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
    lines.push(`${r.ticker} — ${r.price} (${r.change_pct}) — ${r.sentiment.toUpperCase()}${r.source ? ` [${r.source}]` : ''}`, `"${r.one_liner || ''}"`, '');
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
