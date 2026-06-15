# Web Server + Email Redesign — Design Spec
**Date:** 2026-06-15  
**Status:** Approved

## Problem

The daily digest only reaches users via a heavy HTML email with embedded charts. There's no persistent URL to check the latest digest, and the email subject line is static. We want:
1. A fixed URL (`https://stocks.sapientiaworks.com`) that always serves the latest digest
2. A lighter, smarter email that summarises the day with market context and links to the full page

## Architecture

```
stocks.sapientiaworks.com
        │  (Cloudflare edge)
        │  • Browser Integrity Check (free, dashboard toggle)
        │  • WAF rate limit: 20 req/min per CF-Connecting-IP (free tier)
        ▼
  cloudflared named tunnel  ← managed by brew services (not pm2)
        │
        ▼
  localhost:9999  (src/server.js — Express)
        │  • Rate-limit fallback: express-rate-limit keyed on CF-Connecting-IP
        │  • Rejects requests missing CF-Connecting-IP (direct port access → 403)
        │  • Serves public/index.html
        ▼
  public/index.html  ← written by 7AM digest run
```

pm2 manages two processes: `stock-monitor` (existing cron) and `stock-web` (new server).  
`cloudflared` is managed by brew services — pm2 does not touch it.

## Data Flow (7AM run)

```
7AM cron fires
  ├─ fetchBenchmarkReturns()  ─┐
  ├─ fetchIPOCalendar()        ├─ parallel (unchanged)
  ├─ fetchMarketContext()  ◄───┘  NEW: indices + Finnhub headlines
  │
  ├─ per-ticker loop (unchanged)
  │    └─ researchTicker() → scrapeArticles + claudeAnalyze + claudeEnrich
  │
  ├─ rankSectorGroup() (unchanged)
  │
  ├─ formatHTML(results, ...) → write to public/index.html  ◄── NEW
  │
  ├─ claudeSummarize(results, marketContext, date)  ◄── NEW
  │    └─ { subject: string, highlights: string[] }
  │
  └─ formatEmailHTML(results, summary, serverUrl)  ◄── NEW
       └─ sendDigest(subject, compactHtml)
```

## Module Changes

### `src/agent.js` — fetchMarketContext()

New function, runs in the existing `Promise.all` alongside `fetchBenchmarkReturns` and `fetchIPOCalendar`.

Fetches in parallel:
- `yahooFinance.quote(['^GSPC', '^IXIC', '^DJI', '^VIX'])` — day's price + change% for S&P 500, Nasdaq, Dow, VIX
- `finnhubGet('/news?category=general')` — top 5 general market headlines (only if `FINNHUB_API_KEY` set; returns `[]` otherwise)

Returns:
```js
{
  indices: [
    { symbol: '^GSPC', name: 'S&P 500', price: 5420.1, change_pct: '-1.2%' },
    ...
  ],
  headlines: [
    { headline: 'Fed signals rate pause', url: '...' },
    ...
  ]
}
```

Errors are caught and return `{ indices: [], headlines: [] }` — never crashes the run.

### `src/agent.js` — claudeSummarize(results, marketContext, date)

- Model: `claude-sonnet-4-6` (needs cross-ticker synthesis judgment)
- `max_tokens`: 300
- Input: all ticker results (sentiment, one_liner, change_pct, earnings beat/miss) + market context (index moves, headlines)
- Output schema: `{ subject: string, highlights: string[] }` (4–5 bullets)
- Subject: punchy market headline, e.g. `"NVDA +8.2% on H100 demand; S&P fell 1.2% — Jun 15"`
- Highlights: top movers, earnings callouts, sector themes, macro context — synthesised across all data
- Runs after all tickers complete, before email send

### `src/formatter.js` — formatEmailHTML(results, summary, serverUrl)

New function (does NOT replace `formatHTML` — that stays for the web page).

Email body contains:
1. Header with date and generated subject
2. Claude highlights as 4–5 bullet points (bold key numbers)
3. Compact summary table: ticker · price · change · sentiment badge · one-liner
4. Single CTA button: `"View Full Digest →"` linking to `serverUrl`
5. Footer with model + token cost

No charts, no earnings cards, no company intel — those live at the URL.

Returns `{ html, text }` (plain text version for email clients that need it).

### `src/mailer.js`

Two changes:
- Accept `subject` as a parameter instead of a hardcoded string
- Accept `{ html, text }` (no `attachments`) from `formatEmailHTML` — send as a multipart email (html + plain text alternative). The existing attachment path (from `formatHTML`) is only used by the web-page write path, not the email path.

### `src/server.js` — new file

```
Express on port 9999
  GET /          → serve public/index.html (200) or "Digest not yet generated" (503)
  GET /health    → 200 OK (for tunnel health checks)
  *              → 404
```

- `express-rate-limit`: window 60s, max 20 requests, key = `req.headers['cf-connecting-ip'] || req.ip`
- Missing `CF-Connecting-IP` header → 403 (blocks direct port access from non-tunnel clients)
- If `public/index.html` does not exist yet (before first run): serve a friendly "Digest will be available after 7AM EST" page (not a crash)

### `src/index.js` — two changes

1. Add `fetchMarketContext()` to the existing `Promise.all` for background fetches
2. After `formatHTML` generates the web HTML: write it to `public/index.html` atomically (write to `public/index.html.tmp`, then rename — avoids serving a partial file mid-write)
3. Call `claudeSummarize(results, marketContext, date)` to get `{ subject, highlights }`
4. Call `formatEmailHTML(results, summary, SERVER_URL)` for the email body
5. Pass `subject` to `sendDigest()`

`SERVER_URL` comes from `process.env.SERVER_URL` (add to `.env.example`).

### `ecosystem.config.cjs` — new file

```js
module.exports = {
  apps: [
    {
      name: 'stock-monitor',
      script: 'src/index.js',
      env_file: '.env',
    },
    {
      name: 'stock-web',
      script: 'src/server.js',
      env_file: '.env',
    },
  ],
};
```

Replaces the current single-app pm2 start command. Add `pm2:start-all` and `pm2:stop-all` scripts to `package.json`.

### `public/.gitkeep`

Empty placeholder so the `public/` directory is tracked in git. `public/index.html` is gitignored (generated content). Add `public/index.html` to `.gitignore`.

### `test/smoke.js`

Extend fixture with `summary` object and `serverUrl`. Add checks:
- `formatEmailHTML` renders the CTA button with the server URL
- Subject line appears in email HTML
- Highlights bullets appear
- No chart images in email HTML
- `formatHTML` (web version) still renders full detail cards (regression check)

## Cloudflare Dashboard Setup (one-time, manual)

1. Named tunnel config: set ingress rule `stocks.sapientiaworks.com → http://localhost:9999`
2. Security → Settings → Browser Integrity Check: **On**
3. Security → WAF → Rate limiting rule: `CF-Connecting-IP` ≥ 20 req/60s → Block

## Environment Variables

Add to `.env` and `.env.example`:
```
SERVER_URL=https://stocks.sapientiaworks.com
```

## Cost

`claudeSummarize`: ~1,000 input tokens (Sonnet) → ~$0.003/day.  
`fetchMarketContext`: 0 Claude tokens (pure API calls).

## Failure Modes

| Failure | Behaviour |
|---|---|
| `fetchMarketContext` fails | `{ indices: [], headlines: [] }` passed to summarize — highlights are ticker-only |
| `claudeSummarize` fails | Subject falls back to `"Daily Stock Digest — {date}"`, no highlights bullet section in email |
| `public/index.html` missing | Server returns friendly 503 page, not a crash |
| Direct port 9999 access (no CF-Connecting-IP) | 403 Forbidden |
| Rate limit exceeded | 429 Too Many Requests |
