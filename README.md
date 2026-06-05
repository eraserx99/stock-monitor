# Stock Monitor Agent

Daily stock digest delivered to your email. Researches each ticker
with Claude + web search; sends an HTML email with price, sentiment,
news links, analyst targets, risks, and competitors.

## Setup

1. Clone and install:
   ```bash
   git clone <repo>
   cd stock-monitor
   npm install
   ```

2. Copy config template and fill in values:
   ```bash
   cp .env.example .env
   ```

3. Gmail app password (required for Gmail SMTP):
   - Google Account → Security → 2-Step Verification → App Passwords
   - Create an app password for "Mail"
   - Paste the 16-character code as `SMTP_PASS` in `.env`

## Running

```bash
# Preview digest in browser (no email sent — good for first-run testing)
npm run dry-run

# Send digest now
npm run run-now

# Start on schedule (weekdays 7am by default)
npm start
```

## Deploy as background process (pm2)

```bash
npm install -g pm2
pm2 start "node src/index.js" --name stock-monitor
pm2 save
pm2 startup   # follow the printed instructions to enable auto-start
```

## Watchlist configuration

Edit `TICKERS` in `.env` — comma-separated symbols, no spaces:
```
TICKERS=CEG,ETN,COHR,VST,TLN,GEV,VRT,AAPL,MSFT
```

## Rate limit tuning

`TICKER_DELAY_MS` controls the pause between Claude API calls.
- Small watchlist (< 10 tickers): `1000` is fine
- Large watchlist (20–40 tickers): start at `2000`, raise to `5000` if you see errors
