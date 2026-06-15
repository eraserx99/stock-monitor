# Company Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Company Intelligence" section to each stock detail card showing sub-sector specifics, key IPs/technologies, and current/upcoming business engagements — extracted from scraped news article text by a dedicated Haiku Claude call.

**Architecture:** Playwright (headless Chromium) scrapes the full text of already-fetched news URLs concurrently with the existing `claudeAnalyze` call. After both complete, a new `claudeEnrich` (Haiku) call extracts structured company intelligence from the scraped text and returns three new fields merged onto the ticker result. The formatter renders a new "Company Intelligence" block inside each detail card.

**Tech Stack:** `playwright` (npm), `claude-haiku-4-5-20251001` for extraction, existing `yahoo-finance2` + Anthropic SDK.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/scraper.js` | **Create** | Launch Chromium, scrape URLs, return clean text |
| `src/agent.js` | **Modify** | Add `claudeEnrich()`, wire scrape+enrich into `fetchFromYahoo` and `fetchFromFinnhub` |
| `src/formatter.js` | **Modify** | Add `companyIntelHTML()`, inject into `detailCard`, update `formatText` |
| `test/smoke.js` | **Modify** | Extend fixture + add checks for new fields |
| `test/scraper-smoke.js` | **Create** | Validate scraper works against example.com |
| `package.json` | **Modify** | Add `playwright` dependency |
| `.gitignore` | **Modify** | Add `.playwright-mcp/` |

---

## Task 1: Install Playwright and update gitignore

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install playwright**

```bash
cd /Users/steve/workspace.js/stock-monitor
npm install playwright
```

Expected: `playwright` appears in `package.json` `dependencies`. The package downloads ~2MB of JS; the browser binary is NOT downloaded yet.

- [ ] **Step 2: Install Chromium browser binary**

```bash
npx playwright install chromium
```

Expected: Downloads Chromium to `~/Library/Caches/ms-playwright/`. Output ends with `✓ chromium ... downloaded`. This is a one-time setup — the binary is NOT in the project directory and will NOT be in git.

- [ ] **Step 3: Update .gitignore**

Current `.gitignore`:
```
node_modules/
.env
.dry-run-output.html
.superpowers/
```

New `.gitignore`:
```
node_modules/
.env
.dry-run-output.html
.superpowers/
.playwright-mcp/
```

- [ ] **Step 4: Verify playwright import works**

```bash
node -e "import('playwright').then(m => console.log('playwright ok:', typeof m.chromium))"
```

Expected output: `playwright ok: object`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "feat: add playwright dependency for news article scraping"
```

---

## Task 2: Create src/scraper.js

**Files:**
- Create: `src/scraper.js`
- Create: `test/scraper-smoke.js`

- [ ] **Step 1: Write the scraper smoke test first**

Create `test/scraper-smoke.js`:

```js
import { scrapeArticles } from '../src/scraper.js';

// example.com is stable, lightweight, and always serves plain HTML
const results = await scrapeArticles(['https://example.com'], { maxChars: 500, timeout: 10000 });

const checks = [
  ['returns array',           Array.isArray(results)],
  ['scraped one article',     results.length === 1],
  ['has url field',           results[0]?.url === 'https://example.com'],
  ['has text field',          typeof results[0]?.text === 'string'],
  ['text is non-empty',       results[0]?.text?.length > 10],
  ['text has no html tags',   !/<[^>]+>/.test(results[0]?.text || '')],
  ['text respects maxChars',  (results[0]?.text?.length ?? 0) <= 500],
];

let passed = 0;
for (const [name, result] of checks) {
  console.log(result ? `✅ ${name}` : `❌ ${name}`);
  if (result) passed++;
}
console.log(`\n${passed}/${checks.length} checks passed`);
if (passed < checks.length) process.exit(1);
```

- [ ] **Step 2: Run the test to confirm it fails (scraper doesn't exist yet)**

```bash
node test/scraper-smoke.js
```

Expected: `Error: Cannot find module '../src/scraper.js'`

- [ ] **Step 3: Create src/scraper.js**

```js
import { chromium } from 'playwright';

const REMOVE_SELECTORS = [
  'script', 'style', 'nav', 'header', 'footer', 'aside',
  '[class*="ad-"]', '[class*="-ad"]', '[class*="advertisement"]',
  '[id*="ad-"]', '[id*="-ad"]', '.cookie-banner', '.paywall',
];

async function scrapeOne(browser, url, maxChars, timeout) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
    const text = await page.evaluate((selectors) => {
      for (const sel of selectors) {
        try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
      }
      return (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    }, REMOVE_SELECTORS);
    return { url, text: text.slice(0, maxChars) };
  } catch (err) {
    return { url, text: null, error: err.message };
  } finally {
    await ctx.close();
  }
}

export async function scrapeArticles(urls, { maxChars = 2000, timeout = 10000, concurrency = 3 } = {}) {
  if (!urls?.length) return [];
  const targets = urls.slice(0, 5);
  const browser = await chromium.launch({ headless: true });
  try {
    const results = [];
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(url => scrapeOne(browser, url, maxChars, timeout))
      );
      results.push(...batchResults);
    }
    return results.filter(r => r.text && r.text.length > 100);
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Run the smoke test to confirm it passes**

```bash
node test/scraper-smoke.js
```

Expected: `7/7 checks passed`

- [ ] **Step 5: Commit**

```bash
git add src/scraper.js test/scraper-smoke.js
git commit -m "feat: add playwright article scraper"
```

---

## Task 3: Add claudeEnrich to src/agent.js

**Files:**
- Modify: `src/agent.js` (add `claudeEnrich` function, after the existing `claudeAnalyze` function around line 130)

- [ ] **Step 1: Add the import for scrapeArticles at the top of agent.js**

Current top of `src/agent.js`:
```js
import Anthropic from '@anthropic-ai/sdk';
import YahooFinance from 'yahoo-finance2';
```

Change to:
```js
import Anthropic from '@anthropic-ai/sdk';
import YahooFinance from 'yahoo-finance2';
import { scrapeArticles } from './scraper.js';
```

- [ ] **Step 2: Add claudeEnrich function after the claudeAnalyze function (after line ~130 in agent.js)**

Insert after the closing brace of `claudeAnalyze`:

```js
async function claudeEnrich(ticker, articles) {
  if (!articles.length) return { sector_detail: null, key_technologies: null, upcoming_engagements: null, usage: null };

  const articlesText = articles
    .map((a, i) => `--- Article ${i + 1} (${a.url}) ---\n${a.text}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Extract company intelligence for ${ticker} from these news articles. Only include facts explicitly stated in the articles — do not use prior knowledge or fabricate details.

${articlesText}

Return ONLY a JSON object:
{"sector_detail":string|null,"key_technologies":string[]|null,"upcoming_engagements":string[]|null}

sector_detail: 10-20 words on the specific sub-sector and business model (e.g. "Cloud GPU infrastructure and AI accelerator chips for hyperscale data centers"). null if not determinable.
key_technologies: 2-4 specific proprietary technologies, platforms, or IP assets mentioned. null if none found.
upcoming_engagements: 2-4 specific contracts, partnerships, deals, or revenue events mentioned, each with counterparty and timeline when available. null if none found.`,
    }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  try {
    const parsed = extractJSON(text);
    return {
      sector_detail: parsed.sector_detail || null,
      key_technologies: Array.isArray(parsed.key_technologies) && parsed.key_technologies.length ? parsed.key_technologies : null,
      upcoming_engagements: Array.isArray(parsed.upcoming_engagements) && parsed.upcoming_engagements.length ? parsed.upcoming_engagements : null,
      usage: response.usage,
    };
  } catch {
    return { sector_detail: null, key_technologies: null, upcoming_engagements: null, usage: response.usage };
  }
}
```

- [ ] **Step 3: Verify the file parses cleanly**

```bash
node --input-type=module <<'EOF'
import '/Users/steve/workspace.js/stock-monitor/src/agent.js';
console.log('agent.js parses ok');
EOF
```

Expected: `agent.js parses ok`

- [ ] **Step 4: Commit**

```bash
git add src/agent.js
git commit -m "feat: add claudeEnrich Haiku call for company intelligence extraction"
```

---

## Task 4: Wire scrape + enrich into fetchFromYahoo and fetchFromFinnhub

**Files:**
- Modify: `src/agent.js` — `fetchFromYahoo` (around line 283) and `fetchFromFinnhub` (around line 366)

- [ ] **Step 1: Replace the claudeAnalyze call in fetchFromYahoo**

In `fetchFromYahoo`, find this block (around line 283):

```js
  const { analysis, usage } = await claudeAnalyze(ticker, {
    ticker, price, change_pct,
    sector: profile.sector,
    industry: profile.industry,
    analystMeanTarget: targetMean,
    recentRatings: history.map(h => `${h.firm}: ${GRADE_ACTION[h.action] || h.toGrade}`),
    recentNews: news.slice(0, 4).map(n => `[${n.source || 'Yahoo'}${n.sentiment ? ` · ${n.sentiment}` : ''}] ${n.headline}`),
    recentEarnings: earningsQuarters.slice(0, 2).map(q =>
      q.epsActual != null ? `${q.quarter}: EPS $${q.epsActual.toFixed(2)} vs est $${q.epsEstimate?.toFixed(2)} (${q.beat ? 'Beat' : 'Miss'} ${q.surprisePct})` : null
    ).filter(Boolean),
    performance: performance ? {
      ytd: performance.ytd != null ? `${performance.ytd >= 0 ? '+' : ''}${performance.ytd.toFixed(1)}%` : null,
      oneYear: performance.oneYear != null ? `${performance.oneYear >= 0 ? '+' : ''}${performance.oneYear.toFixed(1)}%` : null,
      threeYear: performance.threeYear != null ? `${performance.threeYear >= 0 ? '+' : ''}${performance.threeYear.toFixed(1)}%` : null,
      fiveYear: performance.fiveYear != null ? `${performance.fiveYear >= 0 ? '+' : ''}${performance.fiveYear.toFixed(1)}%` : null,
    } : null,
  });
```

Replace with:

```js
  const [{ analysis, usage: analyzeUsage }, scrapedArticles] = await Promise.all([
    claudeAnalyze(ticker, {
      ticker, price, change_pct,
      sector: profile.sector,
      industry: profile.industry,
      analystMeanTarget: targetMean,
      recentRatings: history.map(h => `${h.firm}: ${GRADE_ACTION[h.action] || h.toGrade}`),
      recentNews: news.slice(0, 4).map(n => `[${n.source || 'Yahoo'}${n.sentiment ? ` · ${n.sentiment}` : ''}] ${n.headline}`),
      recentEarnings: earningsQuarters.slice(0, 2).map(q =>
        q.epsActual != null ? `${q.quarter}: EPS $${q.epsActual.toFixed(2)} vs est $${q.epsEstimate?.toFixed(2)} (${q.beat ? 'Beat' : 'Miss'} ${q.surprisePct})` : null
      ).filter(Boolean),
      performance: performance ? {
        ytd: performance.ytd != null ? `${performance.ytd >= 0 ? '+' : ''}${performance.ytd.toFixed(1)}%` : null,
        oneYear: performance.oneYear != null ? `${performance.oneYear >= 0 ? '+' : ''}${performance.oneYear.toFixed(1)}%` : null,
        threeYear: performance.threeYear != null ? `${performance.threeYear >= 0 ? '+' : ''}${performance.threeYear.toFixed(1)}%` : null,
        fiveYear: performance.fiveYear != null ? `${performance.fiveYear >= 0 ? '+' : ''}${performance.fiveYear.toFixed(1)}%` : null,
      } : null,
    }),
    scrapeArticles(news.map(n => n.url)).catch(() => []),
  ]);

  const { sector_detail, key_technologies, upcoming_engagements, usage: enrichUsage } =
    await claudeEnrich(ticker, scrapedArticles);

  const usage = {
    input_tokens: (analyzeUsage?.input_tokens ?? 0) + (enrichUsage?.input_tokens ?? 0),
    output_tokens: (analyzeUsage?.output_tokens ?? 0) + (enrichUsage?.output_tokens ?? 0),
  };
```

- [ ] **Step 2: Add the three new fields to fetchFromYahoo's return object**

Find the return statement in `fetchFromYahoo` (currently starts with `return { ticker, price, change_pct,`).

Add `sector_detail`, `key_technologies`, `upcoming_engagements` to it:

```js
  return {
    ticker, price, change_pct,
    sector: profile.sector || null,
    industry: profile.industry || null,
    description: description || null,
    sector_detail,
    key_technologies,
    upcoming_engagements,
    earnings,
    sparkline,
    dailyChart,
    performance,
    sentiment: analysis.sentiment,
    one_liner: analysis.one_liner,
    news_summary: analysis.news_summary || null,
    risks: analysis.risks || [],
    competitors: analysis.competitors || [],
    analyst_targets,
    news,
    source: 'Yahoo Finance',
    _usage: usage,
  };
```

- [ ] **Step 3: Wire scrape + enrich into fetchFromFinnhub**

In `fetchFromFinnhub`, find this block (around line 366):

```js
  const { analysis, usage } = await claudeAnalyze(ticker, {
    ticker, price, change_pct,
    analystRecommendation: recs[0]
      ? `Buy:${recs[0].buy} Hold:${recs[0].hold} Sell:${recs[0].sell} (${recs[0].period})`
      : null,
    recentHeadlines: news.slice(0, 3).map(n => n.headline),
    peers: competitors,
  });
```

Replace with:

```js
  const [{ analysis, usage: analyzeUsage }, scrapedArticles] = await Promise.all([
    claudeAnalyze(ticker, {
      ticker, price, change_pct,
      analystRecommendation: recs[0]
        ? `Buy:${recs[0].buy} Hold:${recs[0].hold} Sell:${recs[0].sell} (${recs[0].period})`
        : null,
      recentHeadlines: news.slice(0, 3).map(n => n.headline),
      peers: competitors,
    }),
    scrapeArticles(news.map(n => n.url)).catch(() => []),
  ]);

  const { sector_detail, key_technologies, upcoming_engagements, usage: enrichUsage } =
    await claudeEnrich(ticker, scrapedArticles);

  const usage = {
    input_tokens: (analyzeUsage?.input_tokens ?? 0) + (enrichUsage?.input_tokens ?? 0),
    output_tokens: (analyzeUsage?.output_tokens ?? 0) + (enrichUsage?.output_tokens ?? 0),
  };
```

- [ ] **Step 4: Add new fields to fetchFromFinnhub's return object**

Find `fetchFromFinnhub`'s return statement. Replace it with:

```js
  return {
    ticker, price, change_pct,
    sector: fhProfile?.finnhubIndustry || null,
    industry: fhProfile?.finnhubIndustry || null,
    description: null,
    sector_detail,
    key_technologies,
    upcoming_engagements,
    earnings,
    sparkline,
    dailyChart,
    performance: null,
    sentiment: analysis.sentiment,
    one_liner: analysis.one_liner,
    news_summary: analysis.news_summary || null,
    risks: analysis.risks || [],
    competitors: competitors.length ? competitors : (analysis.competitors || []),
    analyst_targets,
    news,
    source: 'Finnhub',
    _usage: usage,
  };
```

- [ ] **Step 5: Add null fields to fetchFromWebSearch's return (Plan C — no scraping)**

In `fetchFromWebSearch`, find:
```js
  return { sector: null, industry: null, description: null, earnings: null, sparkline: null, dailyChart: null, performance: null, ...data, source: 'Web Search', _usage: response.usage };
```

Replace with:
```js
  return { sector: null, industry: null, description: null, sector_detail: null, key_technologies: null, upcoming_engagements: null, earnings: null, sparkline: null, dailyChart: null, performance: null, ...data, source: 'Web Search', _usage: response.usage };
```

- [ ] **Step 6: Verify the file parses cleanly**

```bash
node --input-type=module <<'EOF'
import '/Users/steve/workspace.js/stock-monitor/src/agent.js';
console.log('agent.js parses ok');
EOF
```

Expected: `agent.js parses ok`

- [ ] **Step 7: Commit**

```bash
git add src/agent.js
git commit -m "feat: wire article scraping and Haiku enrichment into ticker fetch pipeline"
```

---

## Task 5: Add companyIntelHTML to formatter.js and update smoke test

**Files:**
- Modify: `src/formatter.js`
- Modify: `test/smoke.js`

- [ ] **Step 1: Fix pre-existing smoke test breakage (formatHTML return value)**

`formatHTML` now returns `{ html, attachments }` (since the CID chart fix) but `test/smoke.js` assigns the whole object to `html` and calls `.includes` on it — causing `TypeError: html.includes is not a function`.

In `test/smoke.js`, find:
```js
const html = formatHTML(FIXTURE, 'June 5, 2026', 'claude-sonnet-4-6', USAGE);
```

Replace with:
```js
const { html } = formatHTML(FIXTURE, 'June 5, 2026', 'claude-sonnet-4-6', USAGE);
```

Run the test to confirm existing checks pass:
```bash
node test/smoke.js
```

Expected: `20/20 checks passed`

- [ ] **Step 3: Add company intelligence fields to the smoke test fixture**

In `test/smoke.js`, extend the first fixture object (CEG) with the three new fields:

```js
  {
    ticker: 'CEG',
    price: '$245.30',
    change_pct: '+2.4%',
    sentiment: 'Bullish',
    one_liner: 'Nuclear energy demand from AI datacenters drives premium valuations.',
    sector_detail: 'Nuclear power generation and long-term clean energy supply agreements for hyperscale data centers',
    key_technologies: ['Advanced nuclear reactor operations', 'Power Purchase Agreement (PPA) structuring', 'Grid-scale baseload power delivery'],
    upcoming_engagements: ['Microsoft 20-year nuclear PPA renewal signed Q2 2026', 'DOE grid stability contract under negotiation for 2027'],
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
```

The second fixture (COHR) and third (ERR) stay unchanged — they test the null/missing fields path.

- [ ] **Step 2: Add checks to the smoke test**

Append these entries to the `checks` array in `test/smoke.js`:

```js
  ['company intel section shown',     html.includes('Company Intelligence')],
  ['sector detail rendered',          html.includes('Nuclear power generation')],
  ['key tech bullet rendered',        html.includes('Power Purchase Agreement (PPA) structuring')],
  ['upcoming engagement rendered',    html.includes('Microsoft 20-year nuclear PPA renewal')],
  ['company intel in plain text',     text.includes('Nuclear power generation')],
  ['plain text key tech',             text.includes('Power Purchase Agreement')],
  ['plain text engagement',           text.includes('Microsoft 20-year nuclear PPA')],
```

- [ ] **Step 4: Run smoke test to confirm it fails (companyIntelHTML not yet implemented)**

```bash
node test/smoke.js
```

Expected: Several new checks fail with `❌`. Existing checks should still pass.

- [ ] **Step 4: Add companyIntelHTML function to formatter.js**

Insert this function in `src/formatter.js` after the `newsSummaryHTML` function (after line ~259):

```js
function companyIntelHTML(r) {
  const { sector_detail, key_technologies, upcoming_engagements } = r;
  if (!sector_detail && !key_technologies?.length && !upcoming_engagements?.length) return '';

  const sectorHTML = sector_detail
    ? `<div style="margin-bottom:10px;color:#94a3b8;font-size:13px;font-style:italic">${esc(sector_detail)}</div>`
    : '';

  const techHTML = key_technologies?.length
    ? `<div style="margin-bottom:10px">
        <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:4px">Key Technologies / IP</div>
        <ul style="margin:0;padding-left:16px;color:#cbd5e1">${key_technologies.map(t => `<li style="margin-bottom:2px">${esc(t)}</li>`).join('')}</ul>
      </div>`
    : '';

  const engHTML = upcoming_engagements?.length
    ? `<div>
        <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:4px">Current &amp; Upcoming Engagements</div>
        <ul style="margin:0;padding-left:16px;color:#cbd5e1">${upcoming_engagements.map(e => `<li style="margin-bottom:2px">${esc(e)}</li>`).join('')}</ul>
      </div>`
    : '';

  return `<div style="padding:0 16px 14px">
    <div style="font-size:10px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:8px">Company Intelligence</div>
    ${sectorHTML}${techHTML}${engHTML}
  </div>`;
}
```

- [ ] **Step 5: Inject companyIntelHTML into detailCard**

In `src/formatter.js`, find inside the `detailCard` function:

```js
    ${performanceOverviewHTML(r.performance, benchmark)}
    ${detailChartHTML(r.dailyChart)}
```

Replace with:

```js
    ${companyIntelHTML(r)}
    ${performanceOverviewHTML(r.performance, benchmark)}
    ${detailChartHTML(r.dailyChart)}
```

- [ ] **Step 6: Update formatText to render the three new fields**

In `src/formatter.js`, find the `formatText` function. After the block that renders `r.one_liner`, add rendering for the new fields. Find:

```js
    lines.push(`${r.ticker} — ${r.price} (${r.change_pct}) — ${r.sentiment.toUpperCase()}${r.source ? ` [${r.source}]` : ''}`, `"${r.one_liner || ''}"`, '');
    if (r.analyst_targets?.length) {
```

Replace with:

```js
    lines.push(`${r.ticker} — ${r.price} (${r.change_pct}) — ${r.sentiment.toUpperCase()}${r.source ? ` [${r.source}]` : ''}`, `"${r.one_liner || ''}"`, '');
    if (r.sector_detail) lines.push(`Sector: ${r.sector_detail}`, '');
    if (r.key_technologies?.length) {
      lines.push('Key Technologies:', ...r.key_technologies.map(t => `  • ${t}`), '');
    }
    if (r.upcoming_engagements?.length) {
      lines.push('Upcoming Engagements:', ...r.upcoming_engagements.map(e => `  • ${e}`), '');
    }
    if (r.analyst_targets?.length) {
```

- [ ] **Step 8: Run smoke test to confirm all checks pass**

```bash
node test/smoke.js
```

Expected output ends with: `27/27 checks passed` (20 existing + 7 new)

- [ ] **Step 9: Commit**

```bash
git add src/formatter.js test/smoke.js
git commit -m "feat: add company intelligence section to detail cards

Also fix smoke test: formatHTML returns {html, attachments}, not a string."
```

---

## Task 6: End-to-end dry run verification

**Files:** None changed — this task is validation only.

- [ ] **Step 1: Run dry run**

```bash
npm run dry-run
```

Expected: Digest runs to completion. For each ticker you should see console output like:
```
📊 NVDA — trying Yahoo Finance...
✅ NVDA complete (Yahoo Finance)
```

And no crash or unhandled rejection from the scraper or claudeEnrich.

- [ ] **Step 2: Open the dry run output and verify company intelligence appears**

```bash
open .dry-run-output.html
```

Expected: Each detail card has a "COMPANY INTELLIGENCE" section with:
- An italicised sub-sector line
- "KEY TECHNOLOGIES / IP" bullet list (when articles were scraped successfully)
- "CURRENT & UPCOMING ENGAGEMENTS" bullet list (when relevant articles found)

Tickers where all articles were paywalled will show no section — that is correct behaviour.

- [ ] **Step 3: If any field is consistently null across all tickers, check scraper output**

Add a temporary `console.log` in `fetchFromYahoo` after the `Promise.all` to inspect:

```js
console.log(`[${ticker}] scraped ${scrapedArticles.length} articles, enriched:`, { sector_detail, key_technologies, upcoming_engagements });
```

Remove it after confirming output looks correct.

- [ ] **Step 4: Final commit**

```bash
git add -p   # stage only intentional changes
git commit -m "feat: company intelligence — scrape news, extract sector/IP/engagements via Haiku"
```
