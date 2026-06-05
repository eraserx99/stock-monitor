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
      { firm: 'BofA', target: '$270', action: 'Upgrade', source: 'Yahoo', url: 'https://example.com/bofa' },
    ],
    news: [
      { headline: 'Microsoft renews PPA deal', url: 'https://example.com/news1', source: 'MarketWatch' },
    ],
    risks: ['Regulatory headwinds', 'Rate sensitivity'],
    source: 'Yahoo Finance',
  },
  {
    ticker: 'COHR',
    price: '$78.40',
    change_pct: '-1.8%',
    sentiment: 'Bearish',
    one_liner: 'Supply chain concerns persist amid margin pressure.',
    competitors: ['II-VI', 'LITE', 'IIVI'],
    analyst_targets: [],
    news: [],
    risks: ['Supply chain risk'],
    source: 'Finnhub',
  },
  { ticker: 'ERR', error: true },
];

const USAGE = { input_tokens: 12450, output_tokens: 3210 };

const html = formatHTML(FIXTURE, 'June 5, 2026', 'claude-sonnet-4-6', USAGE);
const text = formatText(FIXTURE, 'June 5, 2026', 'claude-sonnet-4-6', USAGE);

const checks = [
  ['ticker Yahoo link in table',   html.includes('finance.yahoo.com/quote/CEG')],
  ['price shown',                  html.includes('$245.30')],
  ['positive change green',        html.includes('+2.4%') && html.includes('#4ade80')],
  ['sentiment badge BULLISH',      html.includes('BULLISH')],
  ['news headline linked',         html.includes('https://example.com/news1')],
  ['analyst target linked',        html.includes('https://example.com/bofa')],
  ['competitor badge NEE',         html.includes('finance.yahoo.com/quote/NEE')],
  ['error card rendered',          html.includes('Data unavailable')],
  ['plain text ticker',            text.includes('CEG')],
  ['plain text news url',          text.includes('https://example.com/news1')],
  ['footer has model',             html.includes('claude-sonnet-4-6')],
  ['negative change red color',    html.includes('-1.8%') && html.includes('#f87171')],
  ['bearish badge rendered',       html.includes('BEARISH')],
  ['usage tokens in footer',       html.includes('12,450') && html.includes('3,210')],
  ['estimated cost in footer',     html.includes('$0.0') && html.includes('est.')],
  ['usage in plain text',          text.includes('12,450') && text.includes('est.')],
  ['source badge Yahoo Finance',   html.includes('📊 Yahoo Finance')],
  ['source badge Finnhub',         html.includes('📡 Finnhub')],
  ['analyst source pill Yahoo',    html.includes('📊 Yahoo')],
  ['news source publisher tag',    html.includes('via MarketWatch')],
];

let passed = 0;
for (const [name, result] of checks) {
  console.log(result ? `✅ ${name}` : `❌ ${name}`);
  if (result) passed++;
}
console.log(`\n${passed}/${checks.length} checks passed`);
if (passed < checks.length) process.exit(1);
