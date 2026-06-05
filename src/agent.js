import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
export const delay = parseInt(process.env.TICKER_DELAY_MS ?? '2000', 10);

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1].trim() : text.trim());
}

export async function researchTicker(ticker, date) {
  console.log(`🔍 Researching ${ticker}...`);
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1500,
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

Return ONLY a JSON object (no markdown, no code fences) with these exact keys:
{"ticker":string,"price":string,"change_pct":string,"sentiment":"Bullish"|"Neutral"|"Bearish","one_liner":string,"competitors":[string,string,string],"analyst_targets":[{"firm":string,"target":string,"action":string,"url":string}],"news":[{"headline":string,"url":string}],"risks":[string]}`,
      }],
    });

    const textBlocks = response.content.filter(b => b.type === 'text');
    if (!textBlocks.length) throw new Error('No text block in response');

    const data = extractJSON(textBlocks[textBlocks.length - 1].text);
    console.log(`✅ ${ticker} complete`);
    return data;
  } catch (err) {
    console.error(`❌ Error researching ${ticker}: ${err.message}`);
    return { ticker, error: true };
  }
}
