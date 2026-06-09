// Híd a felület (admin.html) és a háttérfolyamat között.
// Csak egy biztonságos függvényt teszünk elérhetővé: tetszőleges URL letöltése.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  // Igaz, ha asztali alkalmazásban futunk (van háttérletöltés)
  isDesktop: true,
  // Egy URL nyers tartalmának letöltése CORS-korlát nélkül
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
  // Kutató ügynök: webkeresés és oldal-letöltés a háttérből
  tavilySearch: (apiKey, query, maxResults) => ipcRenderer.invoke('tavily-search', apiKey, query, maxResults),
  tavilyExtract: (apiKey, url, maxChars) => ipcRenderer.invoke('tavily-extract', apiKey, url, maxChars),
  tfSearch: (apiKey, query, maxResults) => ipcRenderer.invoke('tf-search', apiKey, query, maxResults),
  tfFetch: (apiKey, url, maxChars) => ipcRenderer.invoke('tf-fetch', apiKey, url, maxChars),
  ddgSearch: (query, maxResults) => ipcRenderer.invoke('ddg-search', query, maxResults),
});
