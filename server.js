const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, '_data', 'settings.json');

// Accept large payloads (base64 images)
app.use(express.json({ limit: '100mb' }));
app.use(express.text({ limit: '100mb' }));

// CORS — allow admin panel to post from same origin
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Save all settings (called from admin panel)
app.post('/api/save', (req, res) => {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Persist Gist credentials separately for auto-heal — never expose them to clients
    const ghToken  = parsed?.ghToken  || '';
    const ghGistId = parsed?.ghGistId || '';
    if (ghToken && ghGistId) {
      const credsFile = path.join(__dirname, '_data', 'gist-creds.json');
      fs.writeFileSync(credsFile, JSON.stringify({ ghToken, ghGistId }), 'utf8');
    }

    // Strip sensitive fields before saving public settings
    const { ghToken: _t, ghGistId: _g, ...publicData } = parsed;
    fs.writeFileSync(DATA_FILE, JSON.stringify(publicData), 'utf8');

    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (e) {
    console.error('Save error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Get settings (called from all devices on page load)
app.get('/api/data', (req, res) => {
  try {
    if (!fs.existsSync(DATA_FILE)) return res.json(null);
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.send(raw);
  } catch (e) {
    res.json(null);
  }
});

// Expose Gist ID publicly so any device can discover and load from Gist
// (token is NOT exposed — only the public Gist ID)
app.get('/api/gist-id', (req, res) => {
  let gistId = process.env.GIST_ID || null;
  if (!gistId) {
    try {
      const credsFile = path.join(__dirname, '_data', 'gist-creds.json');
      if (fs.existsSync(credsFile)) {
        gistId = JSON.parse(fs.readFileSync(credsFile, 'utf8'))?.ghGistId || null;
      }
    } catch(_) {}
  }
  res.json({ gistId });
});

// Check if server has data + auto-heal config status
app.get('/api/status', (req, res) => {
  const exists = fs.existsSync(DATA_FILE);
  let savedAt = null;
  if (exists) {
    try {
      savedAt = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))?.syncedAt || null;
    } catch(e) {}
  }
  const envToken  = !!process.env.GIST_TOKEN;
  const envGistId = !!process.env.GIST_ID;
  res.json({ hasData: exists, savedAt, autoHeal: envToken && envGistId });
});

// Check env vars for auto-heal (used by admin panel)
app.get('/api/env-check', (req, res) => {
  res.json({
    hasGistToken: !!process.env.GIST_TOKEN,
    hasGistId:    !!process.env.GIST_ID,
    autoHealReady: !!(process.env.GIST_TOKEN && process.env.GIST_ID)
  });
});

// Serve static files (HTML, CSS, JS, images)
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ─── Auto-heal: restore settings.json from GitHub Gist on startup ─── */
function fetchGist(token, gistId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/gists/${gistId}`,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent':    'drivo-server/1.0',
        'Accept':        'application/vnd.github.v3+json'
      }
    };
    https.get(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function selfHealFromGist() {
  // Already have data — nothing to do
  if (fs.existsSync(DATA_FILE)) {
    console.log('settings.json found — skipping auto-heal');
    return;
  }

  // Priority 1: Railway environment variables (set once in Railway dashboard)
  let token  = process.env.GIST_TOKEN;
  let gistId = process.env.GIST_ID;

  // Priority 2: Persisted credentials from last admin push (same filesystem, survives small restarts)
  if (!token || !gistId) {
    try {
      const credsFile = path.join(__dirname, '_data', 'gist-creds.json');
      if (fs.existsSync(credsFile)) {
        const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
        token  = token  || creds.ghToken;
        gistId = gistId || creds.ghGistId;
      }
    } catch(_) {}
  }

  if (!token || !gistId) {
    console.log('Auto-heal: no Gist credentials — set GIST_TOKEN & GIST_ID env vars on Railway');
    return;
  }

  console.log(`Auto-heal: restoring settings from Gist ${gistId} ...`);
  try {
    const data    = await fetchGist(token, gistId);
    const content = data?.files?.['drivo-settings.json']?.content;
    if (content) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, content, 'utf8');
      console.log('Auto-heal: settings restored successfully ✓');
    } else {
      console.log('Auto-heal: Gist found but drivo-settings.json file is missing inside it');
    }
  } catch(e) {
    console.error('Auto-heal failed:', e.message);
  }
}

// Boot: self-heal first, then listen
selfHealFromGist().then(() => {
  app.listen(PORT, () => {
    console.log(`Drivo server running on port ${PORT}`);
  });
});
