import Anthropic from '@anthropic-ai/sdk';
import YahooFinance from 'yahoo-finance2';
import { scrapeArticles } from './scraper.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const client = new Anthropic();

export const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
export const delay = parseInt(process.env.TICKER_DELAY_MS ?? '2000', 10);

const GRADE_ACTION = { up: 'Upgrade', down: 'Downgrade', init: 'Initiate', main: 'Maintain', reit: 'Reiterate' };

function computePerformanceReturns(quotes) {
  // quotes: [{date: Date|string, adjclose: number|null, close: number}]
  if (!quotes || quotes.length < 2) return null;
  const closes = quotes.map(q => q.adjclose ?? q.close).filter(v => v != null && v > 0);
  const dates = quotes.filter(q => (q.adjclose ?? q.close) != null).map(q => new Date(q.date));
  if (closes.length < 2) return null;

  const current = closes[closes.length - 1];
  const currentDate = dates[dates.length - 1];

  function pctReturn(pastIdx) {
    if (pastIdx < 0 || closes[pastIdx] == null) return null;
    return (current - closes[pastIdx]) / closes[pastIdx] * 100;
  }

  function findIdx(targetDate) {
    let best = -1, bestDiff = Infinity;
    for (let i = 0; i < dates.length; i++) {
      const diff = Math.abs(dates[i] - targetDate);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  }

  const currentYear = currentDate.getFullYear();
  const ytdIdx = dates.findIndex(d => d.getFullYear() === currentYear);
  const ytdStart = ytdIdx > 0 ? ytdIdx - 1 : 0;

  const oneYearAgo = new Date(currentDate); oneYearAgo.setFullYear(currentYear - 1);
  const threeYearsAgo = new Date(currentDate); threeYearsAgo.setFullYear(currentYear - 3);
  const fiveYearsAgo = new Date(currentDate); fiveYearsAgo.setFullYear(currentYear - 5);

  return {
    ytd:       pctReturn(ytdStart),
    oneYear:   pctReturn(findIdx(oneYearAgo)),
    threeYear: pctReturn(findIdx(threeYearsAgo)),
    fiveYear:  pctReturn(findIdx(fiveYearsAgo)),
  };
}

function computeMA(closes, n) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function computeRollingVwap(highs, lows, closes, volumes, n) {
  const out = new Array(closes.length).fill(null);
  let sumPV = 0, sumV = 0;
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    sumPV += tp * volumes[i];
    sumV += volumes[i];
    if (i >= n) {
      const otp = (highs[i - n] + lows[i - n] + closes[i - n]) / 3;
      sumPV -= otp * volumes[i - n];
      sumV -= volumes[i - n];
    }
    if (i >= n - 1 && sumV > 0) out[i] = sumPV / sumV;
  }
  return out;
}

function buildDailyChart(closes, highs, lows, volumes) {
  if (!closes || closes.length < 2) return { sparkline: null, dailyChart: null };
  const ma50All = computeMA(closes, 50);
  const ma200All = computeMA(closes, 200);
  const vwap30All = computeRollingVwap(highs, lows, closes, volumes, 30);
  // Trim to last 252 trading days for the detail card
  const displayCount = Math.min(252, closes.length);
  const start = closes.length - displayCount;
  const dailyChart = {
    closes: closes.slice(start),
    ma50: ma50All.slice(start),
    ma200: ma200All.slice(start),
    vwap30: vwap30All.slice(start),
  };
  // Summary sparkline: downsample last ~130 daily closes to ~26 pts (≈6 months)
  const recent = closes.slice(Math.max(0, closes.length - 130));
  const step = Math.ceil(recent.length / 26);
  const sparkline = recent.filter((_, i) => i % step === 0 || i === recent.length - 1);
  return { sparkline, dailyChart };
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1].trim());
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) return JSON.parse(text.slice(start, end + 1));
  return JSON.parse(text.trim());
}

// Fast Claude synthesis call — no web search tool, just inference from provided data
async function claudeAnalyze(ticker, context) {
  const response = await client.messages.create({
    model,
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `You are a stock analyst. Analyze ${ticker} based on this market data and return ONLY a JSON object.

${JSON.stringify(context, null, 2)}

Return ONLY: {"sentiment":"Bullish"|"Neutral"|"Bearish","one_liner":string,"news_summary":string,"risks":[string],"competitors":[string,string,string]}

news_summary: 2-3 sentence narrative synthesizing the recent news headlines into a coherent story. Bold key numbers, price moves, and critical facts using **double asterisks**. Focus on what's most market-moving.`,
    }],
  });
  const text = response.content.find(b => b.type === 'text')?.text || '';
  const analysis = extractJSON(text);
  return { analysis: { news_summary: null, ...analysis }, usage: response.usage };
}

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

async function finnhubGet(path) {
  const url = `https://finnhub.io/api/v1${path}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status} for ${path}`);
  return res.json();
}

async function fetchAlphaVantageNews(ticker) {
  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&limit=10&sort=LATEST&apikey=${process.env.ALPHA_VANTAGE_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const data = await res.json();
  if (data['Error Message'] || data['Note'] || data['Information']) {
    throw new Error(data['Error Message'] || data['Note'] || data['Information']);
  }
  return (data.feed || []).slice(0, 6).map(item => ({
    headline: item.title,
    url: item.url,
    source: item.source,
    sentiment: item.overall_sentiment_label,
  }));
}

// Plan A: yahoo-finance2 (no API key, instant market data)
async function fetchFromYahoo(ticker) {
  const twoYearsAgo = new Date(Date.now() - 730 * 24 * 3600 * 1000);
  const fiveYearsAgo = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000);
  const [quote, summary, searched, chartData, perfData] = await Promise.all([
    yahooFinance.quote(ticker),
    yahooFinance.quoteSummary(ticker, {
      modules: ['upgradeDowngradeHistory', 'financialData', 'assetProfile', 'earnings', 'calendarEvents'],
    }, { validateResult: false }).catch(() => ({})),
    yahooFinance.search(ticker, { newsCount: 5, quotesCount: 0 }).catch(() => ({ news: [] })),
    yahooFinance.chart(ticker, { period1: twoYearsAgo, interval: '1d' }).catch(() => null),
    yahooFinance.chart(ticker, { period1: fiveYearsAgo, interval: '1mo' }).catch(() => null),
  ]);

  if (!quote.regularMarketPrice) throw new Error('No price data from Yahoo Finance');

  const changePct = quote.regularMarketChangePercent ?? 0;
  const price = `$${quote.regularMarketPrice.toFixed(2)}`;
  const change_pct = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;

  let news = (searched.news || []).slice(0, 5).map(n => ({
    headline: n.title,
    url: n.link,
  }));

  // Upgrade news to Alpha Vantage when key is set — covers MarketWatch, Reuters, Bloomberg, etc.
  if (process.env.ALPHA_VANTAGE_KEY) {
    const avNews = await fetchAlphaVantageNews(ticker).catch(() => []);
    if (avNews.length > 0) {
      const avUrls = new Set(avNews.map(n => n.url));
      const yahooFill = news.filter(n => !avUrls.has(n.url));
      news = [...avNews, ...yahooFill].slice(0, 6);
    }
  }

  const targetMean = summary.financialData?.targetMeanPrice;
  const numAnalysts = summary.financialData?.numberOfAnalystOpinions;
  const history = (summary.upgradeDowngradeHistory?.history || []).slice(0, 10);

  const analyst_targets = [];
  if (targetMean) {
    const suffix = numAnalysts ? ` (${numAnalysts} analysts)` : '';
    analyst_targets.push({
      firm: 'Analyst Consensus',
      target: `$${Number(targetMean).toFixed(2)}${suffix}`,
      action: 'Mean Target',
      source: 'Yahoo',
      url: `https://finance.yahoo.com/quote/${ticker}/analysis`,
    });
  }

  // Prefer upgrades/downgrades/initiates — Maintains carry no new information
  const meaningful = history.filter(h => h.action !== 'main');
  const ratingEntries = meaningful.length > 0 ? meaningful.slice(0, 3) : history.slice(0, 2);
  for (const h of ratingEntries) {
    analyst_targets.push({
      firm: h.firm || 'Unknown',
      target: h.toGrade || '—',
      action: GRADE_ACTION[h.action] || 'Update',
      source: 'Yahoo',
      url: `https://finance.yahoo.com/quote/${ticker}/analysis`,
    });
  }

  // Supplement with Finnhub buy/hold/sell vote counts when key is available
  if (process.env.FINNHUB_API_KEY) {
    const recs = await finnhubGet(`/stock/recommendation?symbol=${ticker}`).catch(() => []);
    const rec = Array.isArray(recs) ? recs[0] : null;
    if (rec) {
      const totalBuy = (rec.strongBuy || 0) + (rec.buy || 0);
      const totalSell = (rec.strongSell || 0) + (rec.sell || 0);
      analyst_targets.push({
        firm: 'Analyst Ratings',
        target: `${totalBuy} Buy · ${rec.hold || 0} Hold · ${totalSell} Sell`,
        action: rec.period,
        source: 'Finnhub',
        url: `https://finance.yahoo.com/quote/${ticker}/analysis`,
      });
    }
  }

  const profile = summary.assetProfile || {};
  const rawDesc = profile.longBusinessSummary || '';
  const firstSentence = rawDesc.match(/^[^.!?]+[.!?]/)?.[0]?.trim() || '';
  const description = firstSentence.length > 120 ? firstSentence.slice(0, 117) + '…' : firstSentence;

  const earningsChart = summary.earnings?.earningsChart;
  const calEarnings = summary.calendarEvents?.earnings;

  // earnings module returns flat numbers (not {raw, fmt} objects)
  const earningsQuarters = (earningsChart?.quarterly || [])
    .filter(q => q.actual != null)
    .map(q => {
      const actual = q.actual ?? null;
      const estimate = q.estimate ?? null;
      const beat = actual != null && estimate != null ? actual >= estimate : null;
      const pct = q.surprisePct != null
        ? `${Number(q.surprisePct) >= 0 ? '+' : ''}${Number(q.surprisePct).toFixed(1)}%`
        : null;
      return { quarter: q.date || null, epsActual: actual, epsEstimate: estimate, beat, surprisePct: pct };
    })
    .reverse(); // most recent reported first

  const today = new Date().toISOString().slice(0, 10);
  const allEarningsDates = [
    ...(calEarnings?.earningsDate || []),
    ...(earningsChart?.earningsDate || []),
  ].map(d => new Date(d).toISOString().slice(0, 10)).filter(d => d > today);
  const nextDate = allEarningsDates[0] || null;
  const nextEpsEstimate = calEarnings?.earningsAverage ?? earningsChart?.currentQuarterEstimate ?? null;

  const earnings = (earningsQuarters.length > 0 || nextDate) ? {
    history: earningsQuarters,
    nextDate,
    nextEpsEstimate: nextEpsEstimate ?? null,
    currentQuarterLabel: earningsChart?.currentQuarterEstimateDate || null,
  } : null;

  const performance = computePerformanceReturns(perfData?.quotes || []);

  const rawQuotes = (chartData?.quotes || []).filter(q => q.close != null && q.close > 0);
  const { sparkline, dailyChart } = buildDailyChart(
    rawQuotes.map(q => q.close),
    rawQuotes.map(q => q.high ?? q.close),
    rawQuotes.map(q => q.low ?? q.close),
    rawQuotes.map(q => q.volume ?? 1),
  );

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
}

// Plan B: Finnhub (free API key, structured data + real peers)
async function fetchFromFinnhub(ticker) {
  const today = new Date().toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const nowTs = Math.floor(Date.now() / 1000);
  const twoYearsAgoTs = nowTs - 730 * 24 * 3600;

  const [quote, newsItems, peers, recs, fhProfile, fhEarnings, fhCandle] = await Promise.all([
    finnhubGet(`/quote?symbol=${ticker}`),
    finnhubGet(`/company-news?symbol=${ticker}&from=${twoDaysAgo}&to=${today}`),
    finnhubGet(`/stock/peers?symbol=${ticker}`).catch(() => []),
    finnhubGet(`/stock/recommendation?symbol=${ticker}`).catch(() => []),
    finnhubGet(`/stock/profile2?symbol=${ticker}`).catch(() => ({})),
    finnhubGet(`/stock/earnings?symbol=${ticker}`).catch(() => []),
    finnhubGet(`/stock/candle?symbol=${ticker}&resolution=D&from=${twoYearsAgoTs}&to=${nowTs}`).catch(() => null),
  ]);

  if (!quote.c || quote.c === 0) throw new Error('No price data from Finnhub');

  const changePct = quote.dp ?? 0;
  const price = `$${quote.c.toFixed(2)}`;
  const change_pct = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;

  const competitors = (Array.isArray(peers) ? peers : []).filter(p => p !== ticker).slice(0, 3);

  const news = (Array.isArray(newsItems) ? newsItems : []).slice(0, 5).map(n => ({
    headline: n.headline,
    url: n.url,
  }));

  const latestRec = Array.isArray(recs) ? recs[0] : null;
  const analyst_targets = [];
  if (latestRec) {
    const totalBuy = (latestRec.strongBuy || 0) + (latestRec.buy || 0);
    const totalSell = (latestRec.strongSell || 0) + (latestRec.sell || 0);
    analyst_targets.push({
      firm: 'Analyst Ratings',
      target: `${totalBuy} Buy · ${latestRec.hold || 0} Hold · ${totalSell} Sell`,
      action: latestRec.period,
      source: 'Finnhub',
      url: `https://finance.yahoo.com/quote/${ticker}/analysis`,
    });
  }

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

  const fhEarningsList = Array.isArray(fhEarnings) ? fhEarnings : [];
  const earningsHistory = fhEarningsList.slice(0, 4).map(e => {
    const actual = e.actual ?? null;
    const estimate = e.estimate ?? null;
    const beat = actual != null && estimate != null ? actual >= estimate : null;
    return {
      quarter: e.period || null,
      epsActual: actual,
      epsEstimate: estimate,
      beat,
      surprisePct: e.surprisePercent != null
        ? `${e.surprisePercent >= 0 ? '+' : ''}${e.surprisePercent.toFixed(1)}%`
        : null,
    };
  });

  const earnings = earningsHistory.length > 0 ? {
    history: earningsHistory,
    nextDate: null,
    nextEpsEstimate: null,
    currentQuarterLabel: null,
  } : null;

  const fhCloses = fhCandle?.s === 'ok' ? fhCandle.c : null;
  const { sparkline, dailyChart } = fhCloses
    ? buildDailyChart(fhCloses, fhCandle.h ?? fhCloses, fhCandle.l ?? fhCloses, fhCandle.v ?? new Array(fhCloses.length).fill(1))
    : { sparkline: null, dailyChart: null };

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
}

// Plan C: Claude + web search (always available, slowest)
async function fetchFromWebSearch(ticker, date) {
  const response = await client.messages.create({
    model, max_tokens: 1500,
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
7. Most recent quarterly earnings: EPS actual vs estimate, beat or miss, surprise %
8. Next earnings date (if known) and analyst consensus EPS estimate for that quarter

Return ONLY a JSON object (no markdown, no code fences) with these exact keys:
{"ticker":string,"price":string,"change_pct":string,"sector":string,"description":string (one sentence: what the company does),"sentiment":"Bullish"|"Neutral"|"Bearish","one_liner":string,"competitors":[string,string,string],"analyst_targets":[{"firm":string,"target":string,"action":string,"url":string}],"news":[{"headline":string,"url":string}],"risks":[string],"earnings":{"history":[{"quarter":string,"epsActual":number,"epsEstimate":number,"beat":boolean,"surprisePct":string}],"nextDate":string|null,"nextEpsEstimate":number|null,"currentQuarterLabel":string|null}|null}`,
    }],
  });
  const textBlocks = response.content.filter(b => b.type === 'text');
  if (!textBlocks.length) throw new Error('No text block in response');
  const data = extractJSON(textBlocks[textBlocks.length - 1].text);
  return { sector: null, industry: null, description: null, sector_detail: null, key_technologies: null, upcoming_engagements: null, earnings: null, sparkline: null, dailyChart: null, performance: null, ...data, source: 'Web Search', _usage: response.usage };
}

export async function fetchBenchmarkReturns() {
  const fiveYearsAgo = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000);
  try {
    const data = await yahooFinance.chart('^GSPC', { period1: fiveYearsAgo, interval: '1mo' }).catch(() => null);
    return computePerformanceReturns(data?.quotes || []);
  } catch {
    return null;
  }
}

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

export async function rankSectorGroup(sector, tickers) {
  if (tickers.length <= 1) return { ranked: tickers.map(r => r.ticker), usage: null };

  const tickerData = tickers.map(r => ({
    ticker: r.ticker,
    sentiment: r.sentiment,
    change_pct: r.change_pct,
    performance: r.performance || null,
    recentEarnings: (r.earnings?.history || []).slice(0, 4).map(q =>
      q.epsActual != null
        ? `${q.quarter}: EPS $${q.epsActual.toFixed(2)} vs est $${(q.epsEstimate ?? 0).toFixed(2)} (${q.beat ? 'Beat' : 'Miss'} ${q.surprisePct})`
        : null
    ).filter(Boolean),
    nextEarnings: r.earnings?.nextDate || null,
    analystTargets: r.analyst_targets || [],
  }));

  const response = await client.messages.create({
    model,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Rank these ${sector} stocks by profit potential. Priority: (1) recent price performance YTD/1Y/3Y, (2) earnings beats and surprise %, (3) analyst targets and ratings. Return ONLY: {"ranked":["BEST","SECOND",...]}

${JSON.stringify(tickerData, null, 2)}`,
    }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  const parsed = extractJSON(text);
  const ranked = Array.isArray(parsed?.ranked) ? parsed.ranked : tickers.map(r => r.ticker);
  return { ranked, usage: response.usage };
}

export async function fetchIPOCalendar() {
  if (!process.env.FINNHUB_API_KEY) return [];
  const today = new Date().toISOString().slice(0, 10);
  const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  try {
    const data = await finnhubGet(`/calendar/ipo?from=${today}&to=${in30Days}`);
    return (data.ipoCalendar || [])
      .filter(ipo => ipo.status === 'expected' || ipo.status === 'priced')
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  } catch {
    return [];
  }
}

export async function researchTicker(ticker, date) {
  // Plan A: yahoo-finance2
  try {
    console.log(`📊 ${ticker} — trying Yahoo Finance...`);
    const result = await fetchFromYahoo(ticker);
    console.log(`✅ ${ticker} complete (Yahoo Finance)`);
    return result;
  } catch (err) {
    console.warn(`⚠️  Yahoo Finance failed for ${ticker}: ${err.message}`);
  }

  // Plan B: Finnhub (only if key is configured)
  if (process.env.FINNHUB_API_KEY) {
    try {
      console.log(`📡 ${ticker} — trying Finnhub...`);
      const result = await fetchFromFinnhub(ticker);
      console.log(`✅ ${ticker} complete (Finnhub)`);
      return result;
    } catch (err) {
      console.warn(`⚠️  Finnhub failed for ${ticker}: ${err.message}`);
    }
  }

  // Plan C: Claude + web search (always available)
  console.log(`🔍 ${ticker} — falling back to web search...`);
  try {
    const result = await fetchFromWebSearch(ticker, date);
    console.log(`✅ ${ticker} complete (Web Search)`);
    return result;
  } catch (err) {
    console.error(`❌ Error researching ${ticker}: ${err.message}`);
    return { ticker, error: true, source: 'Web Search', _usage: null };
  }
}
