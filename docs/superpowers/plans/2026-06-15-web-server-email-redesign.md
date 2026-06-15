# Web Server + Email Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public web page at `https://stocks.sapientiaworks.com` (Express on port 9999 behind cloudflared) serving the latest digest, and replace the full-HTML email with a compact Claude-generated market summary that links to the web page.

**Architecture:** The 7AM digest run gains two new outputs: (1) writes the full digest HTML to `public/index.html` for the Express server to serve, and (2) calls a new `claudeSummarize()` that takes all ticker results + fresh market context (index moves + Finnhub headlines) and generates a punchy email subject + 4–5 highlights. The email sends only the compact summary. The Express server rate-limits by `CF-Connecting-IP` and rejects requests missing that header.

**Tech Stack:** `express`, `express-rate-limit` (new deps), existing `yahoo-finance2`, `@anthropic-ai/sdk`, `nodemailer`, `node-cron`, `pm2`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/agent.js` | Modify | Add `fetchMarketContext()` and `claudeSummarize()` |
| `src/formatter.js` | Modify | Add `formatEmailHTML()` |
| `src/mailer.js` | Modify | Accept `subject` param; remove attachments from email path |
| `src/index.js` | Modify | Wire market context, write `public/index.html`, call summarize |
| `src/server.js` | Create | Express on port 9999 — rate limit, CF header guard, serve index.html |
| `ecosystem.config.cjs` | Create | pm2 two-app config (stock-monitor + stock-web) |
| `package.json` | Modify | Add express deps + pm2 ecosystem scripts |
| `.gitignore` | Modify | Add `public/index.html` |
| `.env.example` | Modify | Add `SERVER_URL` |
| `public/.gitkeep` | Create | Track `public/` dir in git |
| `test/smoke.js` | Modify | Add `formatEmailHTML` checks |

---

## Task 1: Add fetchMarketContext and claudeSummarize to agent.js

**Files:**
- Modify: `src/agent.js`

- [ ] **Step 1: Add fetchMarketContext after fetchBenchmarkReturns (around line 451)**

Read `src/agent.js` first. Insert this function after `fetchBenchmarkReturns`:

```js
export async function fetchMarketContext() {
  const INDICES = [
    { symbol: '^GSPC', name: 'S&P 500' },
    { symbol: '^IXIC', name: 'Nasdaq' },
    { symbol: '^DJI',  name: 'Dow Jones' },
    { symbol: '^VIX',  name: 'VIX' },
  ];
  try {
    const [quotes, newsRaw] = await Promise.all([
      Promise.all(INDICES.map(i => yahooFinance.quote(i.symbol).catch(() => null))),
      process.env.FINNHUB_API_KEY
        ? finnhubGet('/news?category=general').catch(() => [])
        : Promise.resolve([]),
    ]);

    const indices = quotes
      .map((q, i) => {
        if (!q?.regularMarketPrice) return null;
        const pct = q.regularMarketChangePercent ?? 0;
        return {
          symbol: INDICES[i].symbol,
          name: INDICES[i].name,
          price: q.regularMarketPrice.toFixed(2),
          change_pct: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
        };
      })
      .filter(Boolean);

    const headlines = (Array.isArray(newsRaw) ? newsRaw : [])
      .slice(0, 5)
      .map(n => ({ headline: n.headline || n.title, url: n.url }))
      .filter(n => n.headline);

    return { indices, headlines };
  } catch {
    return { indices: [], headlines: [] };
  }
}
```

- [ ] **Step 2: Add claudeSummarize after fetchMarketContext**

```js
export async function claudeSummarize(results, marketContext, date) {
  const indicesText = (marketContext.indices || [])
    .map(i => `${i.name}: ${i.price} (${i.change_pct})`)
    .join(' · ') || 'unavailable';

  const headlinesText = (marketContext.headlines || [])
    .map(h => `• ${h.headline}`)
    .join('\n') || '(none)';

  const tickersText = results
    .filter(r => !r.error)
    .map(r => `${r.ticker}: ${r.price} ${r.change_pct} — ${r.sentiment} — ${r.one_liner || ''}`)
    .join('\n');

  const response = await client.messages.create({
    model,
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `You are writing a daily stock digest email subject and bullet highlights.

Market indices today: ${indicesText}

Top market headlines:
${headlinesText}

Portfolio tickers:
${tickersText}

Return ONLY a JSON object:
{"subject":string,"highlights":[string]}

subject: One punchy line max 80 chars naming 1-2 biggest movers and market direction. Example: "NVDA +8% leads Tech; S&P fell 1.2% on Fed fears — Jun 15"
highlights: 4-5 bullet strings. Bold key numbers with **double asterisks**. Cover biggest movers, earnings beats/misses, macro theme, sector standouts. Do not repeat the subject verbatim.`,
    }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  try {
    const parsed = extractJSON(text);
    return {
      subject: parsed.subject || `📈 Daily Stock Digest — ${date}`,
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      usage: response.usage,
    };
  } catch {
    return {
      subject: `📈 Daily Stock Digest — ${date}`,
      highlights: [],
      usage: response.usage,
    };
  }
}
```

- [ ] **Step 3: Verify file parses cleanly**

```bash
node --input-type=module <<'EOF'
import '/Users/steve/workspace.js/stock-monitor/src/agent.js';
console.log('agent.js parses ok');
EOF
```

Expected: `agent.js parses ok`

- [ ] **Step 4: Commit**

```bash
cd /Users/steve/workspace.js/stock-monitor && git add src/agent.js && git commit -m "feat: add fetchMarketContext and claudeSummarize to agent"
```

---

## Task 2: Add formatEmailHTML to formatter.js + smoke test

**Files:**
- Modify: `src/formatter.js`
- Modify: `test/smoke.js`

- [ ] **Step 1: Add formatEmailHTML smoke test checks (failing first)**

In `test/smoke.js`, add after the existing imports and FIXTURE/USAGE constants:

```js
import { formatHTML, formatText, formatEmailHTML } from '../src/formatter.js';
```

(Replace the existing import line that only imports `formatHTML, formatText`.)

Then add before the `checks` array:

```js
const SUMMARY = {
  subject: 'CEG +2.4% leads Utilities; market quiet — Jun 5',
  highlights: [
    'CEG **+2.4%** on Microsoft PPA deal renewal — nuclear demand stays strong',
    'COHR **-1.8%** amid supply chain concerns and margin pressure',
  ],
};
const SERVER_URL = 'https://stocks.sapientiaworks.com';
const { html: emailHtml, text: emailText } = formatEmailHTML(FIXTURE, SUMMARY, SERVER_URL);
```

Then append these entries to the `checks` array:

```js
  ['email has subject line',           emailHtml.includes('CEG +2.4% leads Utilities')],
  ['email has bold highlight',         emailHtml.includes('<strong') && emailHtml.includes('Microsoft PPA deal')],
  ['email has CTA link',               emailHtml.includes('https://stocks.sapientiaworks.com')],
  ['email has View Full Digest text',  emailHtml.includes('View Full Digest')],
  ['email has compact ticker table',   emailHtml.includes('$245.30')],
  ['email has no chart img tags',      !emailHtml.match(/<img[^>]+cid:/i)],
  ['email plain text has subject',     emailText.includes('CEG +2.4% leads Utilities')],
  ['email plain text has server url',  emailText.includes('https://stocks.sapientiaworks.com')],
```

- [ ] **Step 2: Run smoke test to confirm new checks fail**

```bash
node test/smoke.js
```

Expected: 27 existing checks pass, 8 new checks fail with `❌`.

- [ ] **Step 3: Add formatEmailHTML to formatter.js**

Read `src/formatter.js`. Add this function at the end of the file, before the final export closing (after `formatText`):

```js
export function formatEmailHTML(results, summary, serverUrl) {
  const { subject = '', highlights = [] } = summary || {};

  const highlightsHTML = highlights.length
    ? `<div style="margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Today's Highlights</div>
        <ul style="margin:0;padding-left:0;list-style:none">
          ${highlights.map(h => {
            const safe = esc(h).replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#f1f5f9">$1</strong>');
            return `<li style="padding:5px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px;line-height:1.5">→ ${safe}</li>`;
          }).join('')}
        </ul>
      </div>`
    : '';

  const tableRows = results
    .filter(r => !r.error)
    .map(r => {
      const s = SENTIMENT[r.sentiment] || SENTIMENT.Neutral;
      return `<tr style="border-bottom:1px solid #1e293b">
        <td style="padding:6px 10px;font-weight:700">
          <a href="${yahoo(r.ticker)}" style="color:#f1f5f9;text-decoration:none">${esc(r.ticker)}</a>
        </td>
        <td style="padding:6px 10px;color:#cbd5e1;white-space:nowrap">${esc(r.price)}</td>
        <td style="padding:6px 10px;color:${changeColor(r.change_pct)};font-weight:600;white-space:nowrap">${esc(r.change_pct)}</td>
        <td style="padding:6px 10px">
          <span style="background:${s.bg};color:${s.text};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">${s.label}</span>
        </td>
        <td style="padding:6px 10px;color:#94a3b8;font-size:12px;font-style:italic">${esc(r.one_liner || '')}</td>
      </tr>`;
    }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#0f172a;color:#f1f5f9">
  <div style="background:#1e293b;border:1px solid #334155;padding:16px 20px;border-radius:10px;margin-bottom:20px">
    <h1 style="margin:0;font-size:18px;color:#f1f5f9">📈 ${esc(subject)}</h1>
  </div>
  ${highlightsHTML}
  <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <div style="background:#0f172a;padding:8px 16px;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Portfolio Summary</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#0f172a;border-bottom:2px solid #334155">
        <th style="padding:5px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase">Ticker</th>
        <th style="padding:5px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase">Price</th>
        <th style="padding:5px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase">Change</th>
        <th style="padding:5px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase">Signal</th>
        <th style="padding:5px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase">Analysis</th>
      </tr>
      ${tableRows}
    </table>
  </div>
  <div style="text-align:center;margin-bottom:24px">
    <a href="${esc(serverUrl)}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none">View Full Digest →</a>
  </div>
  <div style="text-align:center;color:#475569;font-size:11px;border-top:1px solid #1e293b;padding-top:12px">
    Full charts, earnings history &amp; company intelligence at <a href="${esc(serverUrl)}" style="color:#60a5fa">${esc(serverUrl)}</a>
  </div>
</body>
</html>`;

  const textLines = [
    subject, '='.repeat(60), '',
    ...highlights.map(h => `→ ${h.replace(/\*\*([^*]+)\*\*/g, '$1')}`),
    '',
    ...results.filter(r => !r.error).map(r =>
      `${r.ticker}  ${r.price}  ${r.change_pct}  ${(r.sentiment || '').toUpperCase()}  ${r.one_liner || ''}`
    ),
    '',
    `View full digest: ${serverUrl}`,
  ];

  return { html, text: textLines.join('\n') };
}
```

- [ ] **Step 4: Run smoke test — all 35 checks must pass**

```bash
node test/smoke.js
```

Expected: `35/35 checks passed` (27 existing + 8 new)

- [ ] **Step 5: Commit**

```bash
cd /Users/steve/workspace.js/stock-monitor && git add src/formatter.js test/smoke.js && git commit -m "feat: add formatEmailHTML compact email formatter"
```

---

## Task 3: Update mailer.js to accept subject

**Files:**
- Modify: `src/mailer.js`

- [ ] **Step 1: Add subject parameter and remove attachments from email send**

Read `src/mailer.js`. The current `sendDigest` signature is:
```js
export async function sendDigest({ html, attachments = [], text, date, dryRun = false })
```

Replace the entire function with:

```js
export async function sendDigest({ html, attachments = [], text, subject, date, dryRun = false }) {
  if (dryRun) {
    const path = '.dry-run-output.html';
    await writeFile(path, html, 'utf8');
    console.log(`💾 Dry-run: saved to ${path}`);
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    execFile(opener, [path], err => { if (err) console.warn(`⚠️  Could not open browser: ${err.message}`); });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const emailSubject = subject || `📈 Daily Stock Digest — ${date}`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: emailSubject,
      text,
      html,
      attachments: attachments.map(a => ({
        filename: `${a.cid}.png`,
        content: a.content,
        cid: a.cid,
      })),
    });
    console.log(`✅ Digest sent to ${process.env.EMAIL_TO}`);
  } catch (err) {
    console.error(`❌ Email delivery failed: ${err.message}`);
    console.error(`SMTP: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} user=${process.env.SMTP_USER}`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Verify file parses cleanly**

```bash
node --input-type=module <<'EOF'
import '/Users/steve/workspace.js/stock-monitor/src/mailer.js';
console.log('mailer.js parses ok');
EOF
```

Expected: `mailer.js parses ok`

- [ ] **Step 3: Commit**

```bash
cd /Users/steve/workspace.js/stock-monitor && git add src/mailer.js && git commit -m "feat: mailer accepts dynamic subject line"
```

---

## Task 4: Update index.js to wire everything together

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Update imports at the top of index.js**

Current imports:
```js
import { researchTicker, fetchIPOCalendar, fetchBenchmarkReturns, rankSectorGroup, delay, model } from './agent.js';
import { formatHTML, formatText } from './formatter.js';
```

Replace with:
```js
import { researchTicker, fetchIPOCalendar, fetchBenchmarkReturns, fetchMarketContext, rankSectorGroup, claudeSummarize, delay, model } from './agent.js';
import { formatHTML, formatText, formatEmailHTML } from './formatter.js';
import { writeFile, rename, mkdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
```

- [ ] **Step 2: Add marketContextPromise to background fetches in runDigest**

Find:
```js
  // Kick off background fetches in parallel with the ticker loop
  const ipoPromise = fetchIPOCalendar();
  const benchmarkPromise = fetchBenchmarkReturns();
```

Replace with:
```js
  // Kick off background fetches in parallel with the ticker loop
  const ipoPromise = fetchIPOCalendar();
  const benchmarkPromise = fetchBenchmarkReturns();
  const marketContextPromise = fetchMarketContext();
```

- [ ] **Step 3: Await marketContext alongside ipos and benchmark**

Find:
```js
  const [ipos, benchmark] = await Promise.all([ipoPromise, benchmarkPromise]);
```

Replace with:
```js
  const [ipos, benchmark, marketContext] = await Promise.all([ipoPromise, benchmarkPromise, marketContextPromise]);
```

- [ ] **Step 4: Write public/index.html and send compact email**

Find this block near the end of `runDigest`:
```js
  const { html, attachments } = formatHTML(rankedResults, date, model, usage, ipos, benchmark, { inline: dryRun });
  const text = formatText(rankedResults, date, model, usage);

  console.log('📧 Sending digest...');
  await sendDigest({ html, attachments, text, date, dryRun });
```

Replace with:
```js
  const { html: webHtml } = formatHTML(rankedResults, date, model, usage, ipos, benchmark, { inline: true });
  const serverUrl = process.env.SERVER_URL || 'https://stocks.sapientiaworks.com';

  // Write full digest to public/index.html for the web server
  const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), '../public');
  await mkdir(publicDir, { recursive: true });
  const tmpPath = join(publicDir, 'index.html.tmp');
  await writeFile(tmpPath, webHtml, 'utf8');
  await rename(tmpPath, join(publicDir, 'index.html'));
  console.log('🌐 Web digest written to public/index.html');

  // Generate compact email
  const { subject, highlights, usage: sumUsage } = await claudeSummarize(rankedResults, marketContext, date);
  if (sumUsage) {
    usage.input_tokens += sumUsage.input_tokens ?? 0;
    usage.output_tokens += sumUsage.output_tokens ?? 0;
  }

  const { html: emailHtml, text: emailText } = formatEmailHTML(rankedResults, { subject, highlights }, serverUrl);

  console.log('📧 Sending digest...');
  await sendDigest({ html: emailHtml, text: emailText, subject, date, dryRun });
```

- [ ] **Step 5: Verify file parses cleanly**

```bash
node --input-type=module <<'EOF'
import '/Users/steve/workspace.js/stock-monitor/src/index.js';
EOF
```

Expected: Process starts (you'll see scheduler output). Press Ctrl+C to stop. No import errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/steve/workspace.js/stock-monitor && git add src/index.js && git commit -m "feat: write public/index.html and send compact summary email"
```

---

## Task 5: Create src/server.js

**Files:**
- Create: `src/server.js`

- [ ] **Step 1: Install express and express-rate-limit**

```bash
cd /Users/steve/workspace.js/stock-monitor && npm install express express-rate-limit
```

Expected: both packages appear in `package.json` dependencies.

- [ ] **Step 2: Create src/server.js**

```js
import 'dotenv/config';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const PORT = parseInt(process.env.WEB_PORT ?? '9999', 10);
const INDEX_FILE = join(fileURLToPath(new URL('.', import.meta.url)), '../public/index.html');

const NOT_READY_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Digest Pending</title></head>
<body style="font-family:-apple-system,sans-serif;text-align:center;padding:60px;background:#0f172a;color:#94a3b8">
  <h1 style="color:#f1f5f9">Digest Not Ready Yet</h1>
  <p>The daily digest will be available after 7AM EST.</p>
</body>
</html>`;

const limiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyGenerator: req => req.headers['cf-connecting-ip'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests — try again in a minute.',
});

const app = express();
app.set('trust proxy', 1);
app.use(limiter);

app.use((req, res, next) => {
  if (!req.headers['cf-connecting-ip']) {
    return res.status(403).type('text').send('Access only via stocks.sapientiaworks.com');
  }
  next();
});

app.get('/health', (_req, res) => res.type('text').send('ok'));

app.get('/', async (_req, res) => {
  try {
    const html = await readFile(INDEX_FILE, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch {
    res.status(503).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(NOT_READY_HTML);
  }
});

app.use((_req, res) => res.status(404).type('text').send('Not found'));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🌐 Stock web server listening on http://127.0.0.1:${PORT}`);
});
```

- [ ] **Step 3: Smoke test the server locally (no Cloudflare)**

In one terminal:
```bash
cd /Users/steve/workspace.js/stock-monitor && CF_CONNECTING_IP=1.2.3.4 node src/server.js
```

(The env var is just to get past the header check for local testing.)

Wait — `server.js` reads `req.headers['cf-connecting-ip']`, not an env var. For a quick local test, use curl with the header:

```bash
# In a second terminal — should get 403 (no CF header)
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9999/

# Should get 503 (CF header present but no public/index.html yet)
curl -s -o /dev/null -w "%{http_code}" -H "CF-Connecting-IP: 1.2.3.4" http://127.0.0.1:9999/

# Should get 200 ok
curl -s -H "CF-Connecting-IP: 1.2.3.4" http://127.0.0.1:9999/health
```

Expected output of the three curls: `403`, `503`, `ok`

Stop the server with Ctrl+C after verifying.

- [ ] **Step 4: Commit**

```bash
cd /Users/steve/workspace.js/stock-monitor && git add src/server.js package.json package-lock.json && git commit -m "feat: add Express web server on port 9999 with CF header guard and rate limit"
```

---

## Task 6: Config files — pm2 ecosystem, scripts, gitignore, env

**Files:**
- Create: `ecosystem.config.cjs`
- Create: `public/.gitkeep`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `.env.example`

- [ ] **Step 1: Create ecosystem.config.cjs**

```js
module.exports = {
  apps: [
    {
      name: 'stock-monitor',
      script: 'src/index.js',
      interpreter: 'node',
    },
    {
      name: 'stock-web',
      script: 'src/server.js',
      interpreter: 'node',
    },
  ],
};
```

- [ ] **Step 2: Create public/.gitkeep**

Create an empty file at `public/.gitkeep`:
```bash
mkdir -p /Users/steve/workspace.js/stock-monitor/public && touch /Users/steve/workspace.js/stock-monitor/public/.gitkeep
```

- [ ] **Step 3: Update .gitignore**

Current `.gitignore`:
```
node_modules/
.env
.dry-run-output.html
.superpowers/
.playwright-mcp/
```

New `.gitignore`:
```
node_modules/
.env
.dry-run-output.html
.superpowers/
.playwright-mcp/
public/index.html
public/index.html.tmp
```

- [ ] **Step 4: Add SERVER_URL to .env.example**

At the end of `.env.example`, add:

```
# ── Web server ────────────────────────────────────────────────
# Public URL served by cloudflared tunnel (used as link in digest emails)
SERVER_URL=https://stocks.sapientiaworks.com

# Port for the local Express web server (default: 9999)
WEB_PORT=9999
```

- [ ] **Step 5: Add pm2 ecosystem scripts to package.json**

In `package.json`, find the `"scripts"` section and add after the existing pm2 scripts:

```json
    "pm2:start-all": "pm2 start ecosystem.config.cjs",
    "pm2:stop-all": "pm2 stop ecosystem.config.cjs",
    "pm2:restart-all": "pm2 restart ecosystem.config.cjs --update-env",
    "pm2:web-start": "pm2 start ecosystem.config.cjs --only stock-web",
    "pm2:web-stop": "pm2 stop stock-web",
    "pm2:web-logs": "pm2 logs stock-web"
```

- [ ] **Step 6: Run smoke test to confirm nothing broke**

```bash
node test/smoke.js
```

Expected: `35/35 checks passed`

- [ ] **Step 7: Commit everything**

```bash
cd /Users/steve/workspace.js/stock-monitor && git add ecosystem.config.cjs public/.gitkeep .gitignore .env.example package.json && git commit -m "feat: pm2 ecosystem config, web server env vars, gitignore public/index.html"
```

---

## Cloudflare Dashboard Setup (manual, after deploy)

After all tasks complete:

1. **Tunnel ingress** — in `~/.cloudflared/config.yml`, set:
   ```yaml
   ingress:
     - hostname: stocks.sapientiaworks.com
       service: http://127.0.0.1:9999
     - service: http_status:404
   ```
   Then: `brew services restart cloudflared`

2. **Browser Integrity Check** — Cloudflare dashboard → `sapientiaworks.com` → Security → Settings → Browser Integrity Check: **On**

3. **WAF Rate Limit rule** — Security → WAF → Rate limiting rules → Create:
   - Expression: `(http.host eq "stocks.sapientiaworks.com")`
   - Rate: 20 requests per 60 seconds per `CF-Connecting-IP`
   - Action: Block
