const express = require('express');
const fs = require('fs');
const path = require('path');

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
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    fs.writeFileSync(DATA_FILE, body, 'utf8');
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

// Check if server has data
app.get('/api/status', (req, res) => {
  const exists = fs.existsSync(DATA_FILE);
  let savedAt = null;
  if (exists) {
    try {
      savedAt = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))?.syncedAt || null;
    } catch(e) {}
  }
  res.json({ hasData: exists, savedAt });
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

app.listen(PORT, () => {
  console.log(`Drivo server running on port ${PORT}`);
});
