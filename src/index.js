import 'dotenv/config';
import { researchTicker, fetchIPOCalendar, fetchBenchmarkReturns, fetchMarketContext, rankSectorGroup, claudeSummarize, delay, model } from './agent.js';
import { formatHTML, formatEmailHTML } from './formatter.js';
import { writeFile, rename, mkdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
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

  // Kick off background fetches in parallel with the ticker loop
  const ipoPromise = fetchIPOCalendar();
  const benchmarkPromise = fetchBenchmarkReturns();
  const marketContextPromise = fetchMarketContext();

  const raw = [];
  for (let i = 0; i < tickers.length; i++) {
    raw.push(await researchTicker(tickers[i], date));
    if (i < tickers.length - 1) await new Promise(r => setTimeout(r, delay));
  }

  const [ipos, benchmark, marketContext] = await Promise.all([ipoPromise, benchmarkPromise, marketContextPromise]);

  const usage = raw.reduce((acc, r) => {
    if (r._usage) {
      acc.input_tokens += r._usage.input_tokens ?? 0;
      acc.output_tokens += r._usage.output_tokens ?? 0;
    }
    return acc;
  }, { input_tokens: 0, output_tokens: 0 });

  const results = raw.map(({ _usage, ...r }) => r);

  // Rank tickers within each sector group by profit potential
  const sectorMap = {};
  for (const r of results) {
    const s = r.sector || 'Other';
    (sectorMap[s] ??= []).push(r);
  }
  const rankedResults = [];
  for (const [sector, group] of Object.entries(sectorMap)) {
    if (group.length <= 1) { rankedResults.push(...group); continue; }
    try {
      const { ranked, usage: rankUsage } = await rankSectorGroup(sector, group);
      if (rankUsage) {
        usage.input_tokens += rankUsage.input_tokens ?? 0;
        usage.output_tokens += rankUsage.output_tokens ?? 0;
      }
      const byTicker = Object.fromEntries(group.map(r => [r.ticker, r]));
      const seen = new Set(ranked);
      rankedResults.push(
        ...ranked.filter(t => byTicker[t]).map(t => byTicker[t]),
        ...group.filter(r => !seen.has(r.ticker)),
      );
    } catch (e) {
      console.warn(`⚠️  Ranking failed for ${sector}: ${e.message}`);
      rankedResults.push(...group);
    }
  }

  const cost = (usage.input_tokens / 1e6) * 3 + (usage.output_tokens / 1e6) * 15;
  console.log(`📊 ${usage.input_tokens.toLocaleString()} input · ${usage.output_tokens.toLocaleString()} output tokens · est. $${cost.toFixed(3)}`);

  const { html: webHtml } = formatHTML(rankedResults, date, model, usage, ipos, benchmark, { inline: true });
  const serverUrl = process.env.SERVER_URL || 'https://stocks.sapientiaworks.com';

  // Write full digest to public/index.html for the web server
  const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), '../public');
  await mkdir(publicDir, { recursive: true });
  const tmpPath = join(publicDir, 'index.html.tmp');
  await writeFile(tmpPath, webHtml, 'utf8');
  await rename(tmpPath, join(publicDir, 'index.html'));
  console.log('🌐 Web digest written to public/index.html');

  // Generate compact email — fall back gracefully if Anthropic is unavailable
  let subject, highlights;
  try {
    const { subject: s, highlights: h, usage: sumUsage } = await claudeSummarize(rankedResults, marketContext, date);
    subject = s; highlights = h;
    if (sumUsage) {
      usage.input_tokens += sumUsage.input_tokens ?? 0;
      usage.output_tokens += sumUsage.output_tokens ?? 0;
    }
  } catch (e) {
    console.warn(`⚠️  Summary failed, sending without highlights: ${e.message}`);
    subject = `📈 Daily Stock Digest — ${date}`;
    highlights = [];
  }

  const { html: emailHtml, text: emailText } = formatEmailHTML(rankedResults, { subject, highlights }, serverUrl);

  console.log('📧 Sending digest...');
  await sendDigest({ html: emailHtml, text: emailText, subject, date, dryRun });
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
