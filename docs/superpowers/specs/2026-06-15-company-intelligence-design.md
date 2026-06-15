# Company Intelligence Feature — Design Spec
**Date:** 2026-06-15  
**Status:** Approved

## Problem

The daily digest shows price, sentiment, analyst targets, and earnings, but nothing about *what* each company actually does at a meaningful level of specificity. The user needs:
- Sub-sector / industry specifics (not just "Technology")
- Key IPs, proprietary technologies, and competitive moats
- Current and upcoming business engagements (contracts, partnerships, deals) grounded in recent news

## Approach: Playwright Scrape → Haiku Extraction (Approach B)

Scrape the full text of already-fetched news URLs using Playwright (headless Chromium), then pass clean article text to a dedicated Haiku Claude call for structured extraction. This keeps the existing `claudeAnalyze` pipeline unchanged and adds enrichment as a parallel, independently-tunable step.

## Data Flow

```
fetchFromYahoo(ticker)
  ├─ Yahoo API calls (unchanged)
  ├─ scrapeArticles(news URLs)        ─┐ both start after Yahoo returns;
  └─ claudeAnalyze(market context)     ┘ run concurrently
                                          ↓
                          claudeEnrich(ticker, scraped texts)
                          [Haiku — skipped if no articles scraped]
                                          ↓
              merge → { ...existing, sector_detail,
                         key_technologies[], upcoming_engagements[] }
```

Wall-clock impact: `max(scrape_time, yahoo_time)` + `enrich_time` ≈ +3–5s per ticker.

## Module Changes

### New: `src/scraper.js`

- `scrapeArticles(urls, opts)` — public API
- Launches one Chromium instance per call (open → scrape → close, no shared state)
- Visits up to 5 URLs at concurrency=3
- Extraction: removes `script`, `style`, `nav`, `header`, `footer`, `aside`, ad elements via class/id patterns; reads `document.body.innerText`
- Per-page timeout: 10s, `waitUntil: 'domcontentloaded'`
- Truncates each article to 2000 chars
- Returns `{ url, text }[]`; silently drops failures (timeouts, 403s, paywalls)

### Modified: `src/agent.js`

- New `claudeEnrich(ticker, articles)`:
  - Model: `claude-haiku-4-5-20251001`
  - `max_tokens`: 400
  - Output schema: `{ sector_detail: string, key_technologies: string[], upcoming_engagements: string[] }`
  - Prompt instructs Claude to extract only what is explicitly stated in the articles — no fabrication
  - Returns `null` fields when articles array is empty
- In `fetchFromYahoo`: after Yahoo API calls complete, run `scrapeArticles` and `claudeAnalyze` concurrently via `Promise.all`, then pass scraped texts to `claudeEnrich`
- `_usage` accumulates token counts from both `claudeAnalyze` + `claudeEnrich`
- Same enrichment pattern applied in `fetchFromFinnhub` (also has news URLs)
- `fetchFromWebSearch` (Plan C): skip scraping — Claude already web-searched; `sector_detail`, `key_technologies`, `upcoming_engagements` default to null
- `formatText` plain-text path in `formatter.js` also renders the three new fields when present

### Modified: `src/formatter.js`

- New `companyIntelHTML(r)` function:
  - Renders "Company Intelligence" section with three sub-blocks: sub-sector label, key technologies bullet list, current/upcoming engagements bullet list
  - Section is omitted entirely if all three fields are null
- Injected into `detailCard` between the header/price block and the Performance Overview section

## Display

```
COMPANY INTELLIGENCE

Sub-sector: Cloud infrastructure & AI accelerators

Key Technologies / IP
• CUDA parallel computing platform
• Hopper/Blackwell GPU architectures
• NVLink high-speed interconnects

Current & Upcoming Engagements
• $40B US data center supply deal with AWS (Q3 2026)
• Partnership with Saudi Aramco for AI deployment
• TSMC 3nm allocation secured through 2027
```

## Installation

- `playwright` added to `dependencies` (runtime, not devDep)
- Browser binary: `~/Library/Caches/ms-playwright/` — not in repo
- One-time setup command: `npx playwright install chromium`

## Cost

~2,500 input tokens to Haiku per ticker → ~$0.001/ticker/day.  
For 10 tickers: ~$0.01 extra per daily digest run.

## Failure Modes

| Failure | Behavior |
|---|---|
| All articles fail to scrape | `claudeEnrich` skipped, section hidden |
| Partial scrape (some 403s) | Pass what we have; Haiku extracts from partial set |
| Haiku call fails | Log warning, fields default to null, section hidden |
| Playwright not installed | Error logged with install instructions; rest of digest proceeds |
