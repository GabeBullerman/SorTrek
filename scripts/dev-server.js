// Local dev API server — mirrors the Vercel serverless function on port 3001.
// Run alongside ng serve: node scripts/dev-server.js
const http = require('http');
const fs   = require('fs');
const path = require('path');

// Load .env.local (created by "vercel env pull .env.local")
try {
  const envPath = path.join(__dirname, '../.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    });
    console.log('Loaded .env.local');
  } else {
    console.warn('.env.local not found — run "vercel env pull .env.local" first');
  }
} catch (e) {
  console.warn('Could not load .env.local:', e.message);
}

// One entry per file in api/ — keep this in step with what Vercel deploys,
// which is every .js there that isn't prefixed with an underscore.
const routes = {
  '/api/accept-invite':    require('../api/accept-invite'),
  '/api/ai-advisor':       require('../api/ai-advisor'),
  '/api/delete-account':   require('../api/delete-account'),
  '/api/email-scraper':    require('../api/email-scraper'),
  '/api/find-plans':       require('../api/find-plans'),
  '/api/flight-status':    require('../api/flight-status'),
  '/api/link-preview':     require('../api/link-preview'),
  '/api/photos':           require('../api/photos'),
  '/api/plaid':            require('../api/plaid'),
  '/api/public-itinerary': require('../api/public-itinerary'),
  '/api/transport':        require('../api/transport'),
};

// Add Vercel's helpers to Node's ServerResponse. It's augmented rather than
// wrapped so it stays a writable stream — the photo download pipes straight
// into it rather than buffering a whole video in memory.
function wrapRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };
  // Binary or pre-typed bodies set their own Content-Type, so don't impose one.
  res.send = (body) => res.end(body);
  return res;
}

http.createServer((req, res) => {
  // Routes are keyed on the path; the query string carries params (several
  // routes dispatch on ?action= or ?token=), which Vercel exposes as req.query.
  const url = new URL(req.url, 'http://localhost');
  const handler = routes[url.pathname];

  if (!handler) {
    res.writeHead(404).end('Not found');
    return;
  }

  req.query = Object.fromEntries(url.searchParams);

  const run = async () => {
    try {
      await handler(req, wrapRes(res));
    } catch (err) {
      console.error(`[${url.pathname}]`, err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message ?? 'Handler threw' }));
    }
  };

  // GET routes (the photo download, the public itinerary) carry no body.
  if (req.method === 'GET' || req.method === 'HEAD') {
    req.body = {};
    void run();
    return;
  }

  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    try { req.body = JSON.parse(body); } catch (_) { req.body = {}; }
    void run();
  });
}).listen(3001, () => console.log('API dev server → http://localhost:3001'));
