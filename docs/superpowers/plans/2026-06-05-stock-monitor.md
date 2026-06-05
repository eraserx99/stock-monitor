# Stock Monitor Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js agent that researches a configurable stock watchlist daily via Claude + web search and emails an HTML digest with a summary table, full per-ticker cards, Yahoo Finance links, and live news links.

**Architecture:** Five focused modules — `agent.js` (Claude API per ticker), `formatter.js` (HTML + text rendering), `mailer.js` (SMTP + dry-run), `scheduler.js` (cron), `index.js` (orchestrator). Data flows: index → agent (sequential with delay) → formatter → mailer.

**Tech Stack:** Node.js (ESM), `@anthropic-ai/sdk`, `nodemailer`, `node-cron`, `dotenv`

---

## File Map

| File | Responsibility |
|------|----------------|
| `package.json` | Dependencies, scripts |
| `.env.example` | Config template with comments |
| `.gitignore` | Exclude `.env`, `node_modules`, dry-run output |
| `README.md` | Setup + usage docs |
| `src/index.js` | Startup, env validation, CLI routing, `runDigest()` |
| `src/agent.js` | Claude API call per ticker, JSON extraction, error handling |
| `src/formatter.js` | HTML digest + plain text from ticker results array |
| `src/mailer.js` | nodemailer send + dry-run file write |
| `src/scheduler.js` | node-cron wrapper |
| `test/smoke.js` | Formatter smoke test with fixture, no test framework |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `README.md`
- Create: `src/` and `test/` directories

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p src test
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "stock-monitor",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "run-now": "node src/index.js --run-now",
    "dry-run": "node src/index.js --dry-run",
    "dev": "node --watch src/index.js --run-now",
    "test": "node test/smoke.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "nodemailer": "latest",
    "node-cron": "latest",
    "dotenv": "latest"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, `package-lock.json` written.

- [ ] **Step 4: Create `.env.example`**

```bash
# Stock Monitor — configuration template
# Copy to .env and fill in your values: cp .env.example .env

# ── Claude API ────────────────────────────────────────────────
ANTHROPIC_API_KEY=           # Your key from console.anthropic.com

# Model to use (optional — defaults to claude-sonnet-4-6)
CLAUDE_MODEL=claude-sonnet-4-6

# ── Email delivery ────────────────────────────────────────────
EMAIL_TO=you@example.com     # Who receives the digest
EMAIL_FROM=digest@example.com

# ── Gmail SMTP (recommended) ──────────────────────────────────
# Gmail app password setup:
#   Google Account → Security → 2-Step Verification → App Passwords
#   Create an app password for "Mail", paste the 16-char code below.
#   Use your regular Gmail address for SMTP_USER.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=                   # 16-character app password (not your account password)

# ── Schedule ──────────────────────────────────────────────────
# Default: weekdays at 7:00 AM local time
CRON_SCHEDULE=0 7 * * 1-5

# ── Watchlist ─────────────────────────────────────────────────
TICKERS=CEG,ETN,COHR,VST,TLN,GEV,VRT

# ── Rate limiting ─────────────────────────────────────────────
# Delay (ms) between ticker API calls. Lower for small watchlists,
# raise if you hit rate limits (e.g. 5000 for 40+ tickers).
TICKER_DELAY_MS=2000
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
.env
.dry-run-output.html
.superpowers/
```

- [ ] **Step 6: Create `README.md`**

```markdown
# Stock Monitor Agent

Daily stock digest delivered to your email. Researches each ticker
with Claude + web search; sends an HTML email with price, sentiment,
news links, analyst targets, risks, and competitors.

## Setup

1. Clone and install:
   ```bash
   git clone <repo>
   cd stock-monitor
   npm install
   ```

2. Copy config template and fill in values:
   ```bash
   cp .env.example .env
   ```

3. Gmail app password (required for Gmail SMTP):
   - Google Account → Security → 2-Step Verification → App Passwords
   - Create an app password for "Mail"
   - Paste the 16-character code as `SMTP_PASS` in `.env`

## Running

```bash
# Preview digest in browser (no email sent — good for first-run testing)
npm run dry-run

# Send digest now
npm run run-now

# Start on schedule (weekdays 7am by default)
npm start
```

## Deploy as background process (pm2)

```bash
npm install -g pm2
pm2 start "node src/index.js" --name stock-monitor
pm2 save
pm2 startup   # follow the printed instructions to enable auto-start
```

## Watchlist configuration

Edit `TICKERS` in `.env` — comma-separated symbols, no spaces:
```
TICKERS=CEG,ETN,COHR,VST,TLN,GEV,VRT,AAPL,MSFT
```

## Rate limit tuning

`TICKER_DELAY_MS` controls the pause between Claude API calls.
- Small watchlist (< 10 tickers): `1000` is fine
- Large watchlist (20–40 tickers): start at `2000`, raise to `5000` if you see errors
```

- [ ] **Step 7: Commit scaffold**

```bash
git init
git add package.json package-lock.json .env.example .gitignore README.md
git commit -m "chore: project scaffold"
```

---

## Task 2: Formatter + Smoke Test (TDD)

**Files:**
- Create: `test/smoke.js`
- Create: `src/formatter.js`

- [ ] **Step 1: Write `test/smoke.js` (test first)**

```js
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
```

- [ ] **Step 2: Run smoke test — expect it to fail**

```bash
node test/smoke.js
```

Expected: error `Cannot find module '../src/formatter.js'`

- [ ] **Step 3: Create `src/formatter.js`**

```js
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
      <p style="margin:12px 0 0;color:#374151;font-style:italic;font-size:13px">"${r.one_liner}"</p>
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

export function formatHTML(results, date, model) {
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
  </div>
</body>
</html>`;
}

export function formatText(results, date, model) {
  const lines = [`📈 Daily Stock Digest — ${date}`, '='.repeat(50), ''];
  for (const r of results) {
    if (r.error) { lines.push(`[${r.ticker}] Data unavailable`, ''); continue; }
    lines.push(`${r.ticker} — ${r.price} (${r.change_pct}) — ${r.sentiment.toUpperCase()}`, `"${r.one_liner}"`, '');
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
  return lines.join('\n');
}
```

- [ ] **Step 4: Run smoke test — expect it to pass**

```bash
node test/smoke.js
```

Expected output:
```
✅ ticker Yahoo link in table
✅ price shown
✅ positive change green
✅ sentiment badge BULLISH
✅ news headline linked
✅ analyst target linked
✅ competitor badge NEE
✅ error card rendered
✅ plain text ticker
✅ plain text news url
✅ footer has model

11/11 checks passed
```

- [ ] **Step 5: Commit**

```bash
git add src/formatter.js test/smoke.js
git commit -m "feat: formatter with HTML digest and plain text, smoke test"
```

---

## Task 3: Claude Agent

**Files:**
- Create: `src/agent.js`

- [ ] **Step 1: Create `src/agent.js`**

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
export const delay = parseInt(process.env.TICKER_DELAY_MS ?? '2000', 10);

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1].trim() : text.trim());
}

export async function researchTicker(ticker, date) {
  console.log(`🔍 Researching ${ticker}...`);
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Research stock ticker ${ticker} for today ${date}. Use web search to find:
1. Current stock price and today's price movement (% change)
2. Latest analyst ratings and price target changes (last 7 days) — include source URLs
3. Recent news or catalysts (last 48 hours) — include source URLs
4. Key risk factors or headwinds mentioned in recent coverage
5. Top 3 competitor tickers in the same sector (by market cap)
6. Overall sentiment: Bullish / Neutral / Bearish with a 1-2 sentence rationale

Return ONLY a JSON object (no markdown, no code fences) with these exact keys:
{"ticker":string,"price":string,"change_pct":string,"sentiment":"Bullish"|"Neutral"|"Bearish","one_liner":string,"competitors":[string,string,string],"analyst_targets":[{"firm":string,"target":string,"action":string,"url":string}],"news":[{"headline":string,"url":string}],"risks":[string]}`,
      }],
    });

    const textBlocks = response.content.filter(b => b.type === 'text');
    if (!textBlocks.length) throw new Error('No text block in response');

    const data = extractJSON(textBlocks[textBlocks.length - 1].text);
    console.log(`✅ ${ticker} complete`);
    return data;
  } catch (err) {
    console.error(`❌ Error researching ${ticker}: ${err.message}`);
    return { ticker, error: true };
  }
}
```

- [ ] **Step 2: Verify the module loads without error**

```bash
node --input-type=module <<'EOF'
import './src/agent.js';
console.log('agent.js loaded ok');
EOF
```

Expected: `agent.js loaded ok` (no import errors).

- [ ] **Step 3: Commit**

```bash
git add src/agent.js
git commit -m "feat: Claude agent with web search and JSON extraction"
```

---

## Task 4: Mailer

**Files:**
- Create: `src/mailer.js`

- [ ] **Step 1: Create `src/mailer.js`**

```js
import nodemailer from 'nodemailer';
import { writeFile } from 'fs/promises';
import { exec } from 'child_process';

export async function sendDigest({ html, text, date, dryRun = false }) {
  if (dryRun) {
    const path = '.dry-run-output.html';
    await writeFile(path, html, 'utf8');
    console.log(`💾 Dry-run: saved to ${path}`);
    exec(`open "${path}"`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: `📈 Daily Stock Digest — ${date}`,
      text,
      html,
    });
    console.log(`✅ Digest sent to ${process.env.EMAIL_TO}`);
  } catch (err) {
    console.error(`❌ Email delivery failed: ${err.message}`);
    console.error(`SMTP: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} user=${process.env.SMTP_USER}`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Verify the module loads**

```bash
node --input-type=module <<'EOF'
import './src/mailer.js';
console.log('mailer.js loaded ok');
EOF
```

Expected: `mailer.js loaded ok`

- [ ] **Step 3: Commit**

```bash
git add src/mailer.js
git commit -m "feat: mailer with SMTP delivery and dry-run mode"
```

---

## Task 5: Scheduler

**Files:**
- Create: `src/scheduler.js`

- [ ] **Step 1: Create `src/scheduler.js`**

```js
import cron from 'node-cron';

export function startScheduler(callback) {
  const schedule = process.env.CRON_SCHEDULE || '0 7 * * 1-5';
  if (!cron.validate(schedule)) {
    console.error(`❌ Invalid CRON_SCHEDULE: "${schedule}"`);
    process.exit(1);
  }
  console.log(`⏰ Scheduler started. Schedule: "${schedule}" (weekdays 7am by default)`);
  cron.schedule(schedule, () => {
    console.log(`⏰ Scheduled run triggered`);
    callback();
  });
}
```

- [ ] **Step 2: Verify the module loads**

```bash
node --input-type=module <<'EOF'
import './src/scheduler.js';
console.log('scheduler.js loaded ok');
EOF
```

Expected: `scheduler.js loaded ok`

- [ ] **Step 3: Commit**

```bash
git add src/scheduler.js
git commit -m "feat: cron scheduler with env-configurable schedule"
```

---

## Task 6: Entry Point — Wire Everything Together

**Files:**
- Create: `src/index.js`

- [ ] **Step 1: Create `src/index.js`**

```js
import 'dotenv/config';
import { researchTicker, delay, model } from './agent.js';
import { formatHTML, formatText } from './formatter.js';
import { sendDigest } from './mailer.js';
import { startScheduler } from './scheduler.js';

const REQUIRED = ['ANTHROPIC_API_KEY', 'EMAIL_TO', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'TICKERS'];

function validateEnv() {
  const missing = REQUIRED.filter(v => !process.env[v]);
  if (missing.length) {
    console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

async function runDigest(dryRun = false) {
  const tickers = process.env.TICKERS.split(',').map(t => t.trim()).filter(Boolean);
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  console.log(`📋 Running digest for ${tickers.length} tickers: ${tickers.join(', ')}`);

  const results = [];
  for (let i = 0; i < tickers.length; i++) {
    results.push(await researchTicker(tickers[i], date));
    if (i < tickers.length - 1) await new Promise(r => setTimeout(r, delay));
  }

  const html = formatHTML(results, date, model);
  const text = formatText(results, date, model);

  console.log('📧 Sending digest...');
  await sendDigest({ html, text, date, dryRun });
}

validateEnv();

const args = process.argv.slice(2);

if (args.includes('--dry-run')) {
  runDigest(true).catch(err => { console.error(`❌ Fatal: ${err.message}`); process.exit(1); });
} else if (args.includes('--run-now')) {
  runDigest(false).catch(err => { console.error(`❌ Fatal: ${err.message}`); process.exit(1); });
} else {
  startScheduler(() => runDigest().catch(err => console.error(`❌ ${err.message}`)));
  process.on('SIGINT',  () => { console.log('\n👋 Shutting down'); process.exit(0); });
  process.on('SIGTERM', () => { console.log('\n👋 Shutting down'); process.exit(0); });
}
```

- [ ] **Step 2: Verify env validation works without a `.env`**

```bash
node src/index.js --run-now
```

Expected output (exits with code 1):
```
❌ Missing required env vars: ANTHROPIC_API_KEY, EMAIL_TO, EMAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, TICKERS
Copy .env.example to .env and fill in the values.
```

- [ ] **Step 3: Run smoke test to confirm nothing broke**

```bash
npm test
```

Expected: `11/11 checks passed`

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: entry point with env validation, CLI flags, graceful shutdown"
```

---

## Task 7: End-to-End Dry Run

_Requires a valid `.env` with `ANTHROPIC_API_KEY` and `TICKERS` set. SMTP vars not needed for dry-run._

- [ ] **Step 1: Create `.env` with minimum required values for dry-run**

Copy `.env.example` to `.env` and set at minimum:
```
ANTHROPIC_API_KEY=<your key>
TICKERS=CEG,ETN          # start with 2 tickers to keep it fast
EMAIL_TO=test@example.com
EMAIL_FROM=test@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=test
SMTP_PASS=test
```

- [ ] **Step 2: Run dry-run**

```bash
npm run dry-run
```

Expected console output:
```
📋 Running digest for 2 tickers: CEG, ETN
🔍 Researching CEG...
✅ CEG complete
🔍 Researching ETN...
✅ ETN complete
📧 Sending digest...
💾 Dry-run: saved to .dry-run-output.html
```

Expected: browser opens with the digest. Verify:
- Summary table shows both tickers with Yahoo Finance links
- Each ticker has a detail card with sentiment-colored top border
- News items are clickable links
- Competitor badges are clickable Yahoo Finance links

- [ ] **Step 3: Fix any issues found in the browser preview**

If the layout looks wrong, adjust `src/formatter.js` and re-run `npm run dry-run`. Re-run `npm test` after any formatter change.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete stock monitor agent"
```
