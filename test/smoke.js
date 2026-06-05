import { formatHTML, formatText } from '../src/formatter.js';

const FIXTURE = [
  {
    ticker: 'CEG',
    price: '$245.30',
    change_pct: '+2.4%',
    sentiment: 'Bullish',
    one_liner: 'Nuclear energy demand from AI datacenters drives premium valuations.',
    competitors: ['NEE', 'VST', 'TLN'],
    analyst_targets: [
      { firm: 'BofA', target: '$270', action: 'Upgrade', url: 'https://example.com/bofa' },
    ],
    news: [
      { headline: 'Microsoft renews PPA deal', url: 'https://example.com/news1' },
    ],
    risks: ['Regulatory headwinds', 'Rate sensitivity'],
  },
  { ticker: 'ERR', error: true },
];

const html = formatHTML(FIXTURE, 'June 5, 2026', 'claude-sonnet-4-6');
const text = formatText(FIXTURE, 'June 5, 2026', 'claude-sonnet-4-6');

const checks = [
  ['ticker Yahoo link in table',   html.includes('finance.yahoo.com/quote/CEG')],
  ['price shown',                  html.includes('$245.30')],
  ['positive change green',        html.includes('+2.4%') && html.includes('#16a34a')],
  ['sentiment badge BULLISH',      html.includes('BULLISH')],
  ['news headline linked',         html.includes('https://example.com/news1')],
  ['analyst target linked',        html.includes('https://example.com/bofa')],
  ['competitor badge NEE',         html.includes('finance.yahoo.com/quote/NEE')],
  ['error card rendered',          html.includes('Data unavailable')],
  ['plain text ticker',            text.includes('CEG')],
  ['plain text news url',          text.includes('https://example.com/news1')],
  ['footer has model',             html.includes('claude-sonnet-4-6')],
];

let passed = 0;
for (const [name, result] of checks) {
  console.log(result ? `✅ ${name}` : `❌ ${name}`);
  if (result) passed++;
}
console.log(`\n${passed}/${checks.length} checks passed`);
if (passed < checks.length) process.exit(1);
