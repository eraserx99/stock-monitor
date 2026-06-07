import Anthropic from '@anthropic-ai/sdk';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const client = new Anthropic();

export const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
export const delay = parseInt(process.env.TICKER_DELAY_MS ?? '2000', 10);

const GRADE_ACTION = { up: 'Upgrade', down: 'Downgrade', init: 'Initiate', main: 'Maintain', reit: 'Reiterate' };

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

Return ONLY: {"sentiment":"Bullish"|"Neutral"|"Bearish","one_liner":string,"risks":[string],"competitors":[string,string,string]}`,
    }],
  });
  const text = response.content.find(b => b.type === 'text')?.text || '';
  return { analysis: extractJSON(text), usage: response.usage };
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
  const [quote, summary, searched, chartData] = await Promise.all([
    yahooFinance.quote(ticker),
    yahooFinance.quoteSummary(ticker, {
      modules: ['upgradeDowngradeHistory', 'financialData', 'assetProfile', 'earnings', 'calendarEvents'],
    }, { validateResult: false }).catch(() => ({})),
    yahooFinance.search(ticker, { newsCount: 5, quotesCount: 0 }).catch(() => ({ news: [] })),
    yahooFinance.chart(ticker, { period1: twoYearsAgo, interval: '1d' }).catch(() => null),
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

  const rawQuotes = (chartData?.quotes || []).filter(q => q.close != null && q.close > 0);
  const { sparkline, dailyChart } = buildDailyChart(
    rawQuotes.map(q => q.close),
    rawQuotes.map(q => q.high ?? q.close),
    rawQuotes.map(q => q.low ?? q.close),
    rawQuotes.map(q => q.volume ?? 1),
  );

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
  });

  return {
    ticker, price, change_pct,
    sector: profile.sector || null,
    industry: profile.industry || null,
    description: description || null,
    earnings,
    sparkline,
    dailyChart,
    sentiment: analysis.sentiment,
    one_liner: analysis.one_liner,
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

  const { analysis, usage } = await claudeAnalyze(ticker, {
    ticker, price, change_pct,
    analystRecommendation: recs[0]
      ? `Buy:${recs[0].buy} Hold:${recs[0].hold} Sell:${recs[0].sell} (${recs[0].period})`
      : null,
    recentHeadlines: news.slice(0, 3).map(n => n.headline),
    peers: competitors,
  });

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
    earnings,
    sparkline,
    dailyChart,
    sentiment: analysis.sentiment,
    one_liner: analysis.one_liner,
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
  return { sector: null, industry: null, description: null, earnings: null, sparkline: null, dailyChart: null, ...data, source: 'Web Search', _usage: response.usage };
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
