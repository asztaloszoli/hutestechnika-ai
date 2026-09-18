// Hűtéstechnika AI – Electron főfolyamat
// Megnyitja az indító felületet, és biztosít egy CORS nélküli letöltő függvényt
// (a weboldal- és YouTube-feldolgozáshoz), ami a felhasználó saját gépéről tölt le.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

// ─── BEÁLLÍTÁSOK TARTÓS TÁROLÁSA ───
// A localStorage-t a takarító programok (CCleaner, Norton) törölhetik,
// ezért a kulcsokat egy sima JSON fájlba IS mentjük, és onnan visszatöltjük.
function settingsFile() {
  return path.join(app.getPath('userData'), 'beallitasok.json');
}
ipcMain.handle('settings-load', () => {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); }
  catch (e) { return {}; }
});
ipcMain.handle('settings-save', (_event, obj) => {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(obj || {}, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
});

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

  // Fejlesztői konzol: F12 kapcsolja, Ctrl+R újratölti az oldalt.
  // Hibakeresés alatt automatikusan is megnyílik (külön ablakban).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'r') {
      win.webContents.reload();
      event.preventDefault();
    }
  });
  win.webContents.openDevTools({ mode: 'detach' });

  // Külső http(s) linkek az alapértelmezett böngészőben nyíljanak (ne az appban)
  const linkHandler = ({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  };
  win.webContents.setWindowOpenHandler(linkHandler);

  // Az app által nyitott gyerekablakok (pl. a kutatási eredmény olvasó ablaka):
  // ott se legyen menüsor, és a linkek onnan is a rendes böngészőben nyíljanak.
  win.webContents.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false);
    child.webContents.setWindowOpenHandler(linkHandler);
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

// ─── YOUTUBE ÁTIRAT (felirat) + KÖZZÉTÉTELI DÁTUM ───
// A videó címe/kivonata önmagában használhatatlan a kutatáshoz. A felirat viszont
// teljes értékű szöveges forrás – és a dátum kell ahhoz, hogy az árakat ne fogadjuk
// el egy évekkel ezelőtti videóból. API kulcs nem szükséges.
//
// FONTOS TAPASZTALAT: a watch oldal HTML-jében található feliratsáv-URL-ek már NEM
// működnek (a YouTube üres, 0 bájtos választ ad rájuk "proof of origin" token nélkül).
// Ami működik (ezt használja a bevált Python youtube-transcript-api is):
//   1) watch oldal letöltése → INNERTUBE_API_KEY kiszedése a HTML-ből
//   2) InnerTube "player" hívás ANDROID kliensként → innen jönnek a használható sáv-URL-ek
//   3) a sáv URL letöltése (&fmt=srv3 nélkül) → XML, amiből a <text> elemek adják a szöveget

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'hu-HU,hu;q=0.9,en;q=0.8',
};

function ytVideoId(url) {
  const m = String(url).match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// JSON-ban escape-elt szövegrészlet visszafejtése (pl. \u00e1 → á)
function jsonUnescape(raw) {
  try { return JSON.parse('"' + raw + '"'); } catch (e) { return raw; }
}

// HTML/XML entitások visszafejtése. A felirat-XML-ben duplán kódolt részek is vannak
// (pl. &amp;#39; → &#39; → '), ezért kétszer futtatjuk le.
function decodeEntities(s) {
  const once = (x) => String(x)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return once(once(s));
}

// A feliratsávok közül a legjobb kiválasztása: magyar → angol → bármi,
// és azonos nyelven belül az emberi felirat előnyt élvez a gépivel szemben.
function pickCaptionTrack(tracks) {
  const score = (t) => {
    const lang = String(t.languageCode || '').toLowerCase();
    const auto = t.kind === 'asr';
    let s = lang.startsWith('hu') ? 0 : (lang.startsWith('en') ? 10 : 20);
    if (auto) s += 5;
    return s;
  };
  return tracks.slice().sort((a, b) => score(a) - score(b))[0];
}

ipcMain.handle('yt-transcript', async (_event, url, maxChars = 8000) => {
  const id = ytVideoId(url);
  if (!id) return null;

  const meta = {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: '', channel: '', publishDate: '', description: '',
    transcript: '', isAuto: false, lang: '', note: '',
  };

  // 1) A watch oldal: innen jön az InnerTube API kulcs ÉS a közzétételi dátum
  const resp = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: BROWSER_HEADERS });
  if (!resp.ok) throw new Error('YouTube HTTP ' + resp.status);
  const html = await resp.text();
  const grab = (re) => { const m = html.match(re); return m ? jsonUnescape(m[1]) : ''; };
  meta.publishDate = grab(/"publishDate":"(\d{4}-\d{2}-\d{2})/) || grab(/"uploadDate":"(\d{4}-\d{2}-\d{2})/) ||
    grab(/<meta itemprop="datePublished" content="(\d{4}-\d{2}-\d{2})/);
  const apiKey = (html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/) || [])[1];
  if (!apiKey) { meta.note = 'nem-talalt-api-kulcs'; return meta; }

  // 2) InnerTube player ANDROID klienssel – csak így kapunk letölthető feliratsávokat
  const pr = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_HEADERS['User-Agent'] },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
      videoId: id,
    }),
  });
  if (!pr.ok) { meta.note = 'innertube-hiba-' + pr.status; return meta; }
  const data = await pr.json();

  const details = data.videoDetails || {};
  meta.title = details.title || grab(/<meta name="title" content="([^"]*)"/);
  meta.channel = details.author || grab(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/);
  meta.description = String(details.shortDescription || '').slice(0, 800);
  meta.publishDate = meta.publishDate ||
    (data.microformat && data.microformat.playerMicroformatRenderer &&
      String(data.microformat.playerMicroformatRenderer.publishDate || '').slice(0, 10)) || '';

  const tracks = (data.captions && data.captions.playerCaptionsTracklistRenderer &&
    data.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
  if (!tracks.length) { meta.note = 'nincs-felirat'; return meta; }

  const track = pickCaptionTrack(tracks);
  meta.isAuto = track.kind === 'asr';
  meta.lang = track.languageCode || '';

  // 3) A felirat letöltése. Az &fmt=srv3 elhagyása a működő (sima XML) változatot adja.
  const capUrl = String(track.baseUrl || '').replace('&fmt=srv3', '');
  if (!capUrl) { meta.note = 'nincs-felirat-url'; return meta; }
  if (capUrl.includes('&exp=xpe')) { meta.note = 'po-token-kellene'; return meta; }
  try {
    const r = await fetch(capUrl, { headers: BROWSER_HEADERS });
    if (r.ok) {
      const xml = await r.text();
      const texts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
        .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')));
      meta.transcript = texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
    } else meta.note = 'felirat-http-' + r.status;
  } catch (e) { meta.note = 'felirat-hiba'; }

  return meta;
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
ipcMain.handle('tavily-search', async (_event, apiKey, query, maxResults = 10, country = '') => {
  const body = {
    query,
    search_depth: 'advanced',
    max_results: maxResults,
    include_raw_content: true,
  };
  // Ország-preferencia (pl. 'hungary'): a Tavily FELERŐSÍTI az adott ország találatait,
  // de nem zárja ki a többit. Csak a 'general' témánál értelmezett, ami itt az alapértelmezés.
  if (country) body.country = String(country).toLowerCase();
  const resp = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
      // Ha a Tavily ismeri a közzététel dátumát, továbbadjuk: ez dönti el,
      // hogy egy árat/akciót elfogadhatunk-e frissként
      published: it.published_date || '',
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
    body: JSON.stringify({ urls: url, extract_depth: 'advanced', format: 'markdown' }),
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
