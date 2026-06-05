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
