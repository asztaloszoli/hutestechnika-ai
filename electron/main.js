// Hűtéstechnika AI – Electron főfolyamat
// Megnyitja az indító felületet, és biztosít egy CORS nélküli letöltő függvényt
// (a weboldal- és YouTube-feldolgozáshoz), ami a felhasználó saját gépéről tölt le.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 840,
    minWidth: 720,
    minHeight: 560,
    icon: path.join(ROOT, 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(ROOT, 'start.html'));

  // Külső http(s) linkek az alapértelmezett böngészőben nyíljanak (ne az appban)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

// Tetszőleges URL letöltése a háttérből (nincs böngészős CORS-korlát).
// A nyers szöveget adja vissza; a feldolgozást (HTML→szöveg, felirat) a felület végzi.
ipcMain.handle('fetch-text', async (_event, url) => {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'hu-HU,hu;q=0.9,en;q=0.8',
  };
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new Error('A letöltés nem sikerült (HTTP ' + resp.status + ')');
  }
  return await resp.text();
});

// ─── KUTATÓ ÜGYNÖK: webkeresés és oldal-letöltés a háttérből ───
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';
const TF_SEARCH_URL = 'https://api.search.tinyfish.ai';
const TF_FETCH_URL = 'https://api.fetch.tinyfish.ai';
const BLOCKED_DOMAINS = [
  'facebook.com', 'twitter.com', 'instagram.com',
  'linkedin.com', 'pinterest.com', 'x.com', 'threads.net',
];

function isBlocked(url) {
  return BLOCKED_DOMAINS.some((d) => url.includes(d));
}

// Tavily webkeresés (Bearer). A találatok mellé a tiszta tartalmat is kéri
// (include_raw_content), így gyakran nem kell külön oldal-letöltés.
// Visszaad: [{title,url,snippet,content}]
ipcMain.handle('tavily-search', async (_event, apiKey, query, maxResults = 10) => {
  const resp = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      include_raw_content: true,
    }),
  });
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json()).detail || ''; } catch (e) {}
    throw new Error('Tavily Search HTTP ' + resp.status + (detail ? ' – ' + detail : ''));
  }
  const data = await resp.json();
  const items = Array.isArray(data.results) ? data.results : [];
  const out = [];
  for (const it of items) {
    const url = it.url || it.link || '';
    if (!url || isBlocked(url)) continue;
    out.push({
      title: it.title || '',
      url,
      snippet: it.content || it.snippet || '',
      content: it.raw_content ? String(it.raw_content) : '',
    });
    if (out.length >= maxResults) break;
  }
  return out;
});

// Tavily oldal-letöltés (tiszta markdown). Visszaad: szöveg vagy ''
ipcMain.handle('tavily-extract', async (_event, apiKey, url, maxChars = 4000) => {
  const resp = await fetch(TAVILY_EXTRACT_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: url, extract_depth: 'basic', format: 'markdown' }),
  });
  if (!resp.ok) throw new Error('Tavily Extract HTTP ' + resp.status);
  const data = await resp.json();
  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length) {
    const content = results[0].raw_content || results[0].content || '';
    if (content) return String(content).slice(0, maxChars);
  }
  return '';
});

// TinyFish webkeresés (X-API-Key). Visszaad: [{title,url,snippet}]
ipcMain.handle('tf-search', async (_event, apiKey, query, maxResults = 10) => {
  const u = `${TF_SEARCH_URL}?query=${encodeURIComponent(query)}`;
  const resp = await fetch(u, { headers: { 'X-API-Key': apiKey } });
  if (!resp.ok) throw new Error('TinyFish Search HTTP ' + resp.status);
  const data = await resp.json();
  const items = Array.isArray(data) ? data : (data.results || data.data || []);
  const out = [];
  for (const it of items) {
    const url = it.url || it.link || '';
    if (!url || isBlocked(url)) continue;
    out.push({
      title: it.title || '',
      url,
      snippet: it.snippet || it.description || it.content || '',
    });
    if (out.length >= maxResults) break;
  }
  return out;
});

// TinyFish oldal-letöltés (tiszta markdown). Visszaad: szöveg vagy ''
ipcMain.handle('tf-fetch', async (_event, apiKey, url, maxChars = 4000) => {
  const resp = await fetch(TF_FETCH_URL, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: [url] }),
  });
  if (!resp.ok) throw new Error('TinyFish Fetch HTTP ' + resp.status);
  const data = await resp.json();
  const results = Array.isArray(data) ? data : (data.results || data.data || []);
  if (results && results.length) {
    const item = results[0];
    const content = item.content || item.markdown || item.text || '';
    if (content) return String(content).slice(0, maxChars);
  }
  return '';
});

// DuckDuckGo tartalék keresés (ha nincs TinyFish kulcs). Visszaad: [{title,url,snippet}]
ipcMain.handle('ddg-search', async (_event, query, maxResults = 10) => {
  const u = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const resp = await fetch(u, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!resp.ok) throw new Error('DuckDuckGo HTTP ' + resp.status);
  const html = await resp.text();
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < maxResults) {
    let url = m[1];
    const dec = url.match(/[?&]uddg=([^&]+)/);
    if (dec) url = decodeURIComponent(dec[1]);
    if (!/^https?:\/\//i.test(url) || isBlocked(url)) continue;
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    out.push({ title, url, snippet: '' });
  }
  return out;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
