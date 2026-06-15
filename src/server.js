import 'dotenv/config';
import express from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const PORT = parseInt(process.env.WEB_PORT ?? '9999', 10);
const INDEX_FILE = join(fileURLToPath(new URL('.', import.meta.url)), '../public/index.html');

const NOT_READY_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Digest Pending</title></head>
<body style="font-family:-apple-system,sans-serif;text-align:center;padding:60px;background:#0f172a;color:#94a3b8">
  <h1 style="color:#f1f5f9">Digest Not Ready Yet</h1>
  <p>The daily digest will be available after 7AM EST.</p>
</body>
</html>`;

const limiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyGenerator: req => req.headers['cf-connecting-ip'] || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests — try again in a minute.',
});

const app = express();
app.set('trust proxy', 1);
app.use(limiter);

app.use((req, res, next) => {
  if (!req.headers['cf-connecting-ip']) {
    return res.status(403).type('text').send('Access only via stocks.sapientiaworks.com');
  }
  next();
});

app.get('/health', (_req, res) => res.type('text').send('ok'));

app.get('/', async (_req, res) => {
  try {
    const html = await readFile(INDEX_FILE, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch {
    res.status(503).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(NOT_READY_HTML);
  }
});

app.use((_req, res) => res.status(404).type('text').send('Not found'));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🌐 Stock web server listening on http://127.0.0.1:${PORT}`);
});
