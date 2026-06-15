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
