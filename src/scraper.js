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
