# PWA Mobile Font Sizing Issues - Developer Notes

## Probléma leírása

**Eszköz:** Google Pixel 10  
**Tünet:** A telepített PWA (ikonról indítva) sokkal kisebb betűméretekkel jelenik meg, mint a böngészős változat, annak ellenére hogy a rendszer betűméret-beállítása fent van húzva.

## Gyökérok

### 1. Android rendszer font scaling különbségek
- A böngésző tiszteletben tartja a rendszer betűméret-beállításait
- A standalone PWA más renderelési kontextusban fut, és a rendszer font scaling nem mindig érvényesül
- A CSS `text-size-adjust` tulajdonságok eltérően viselkednek a két módban

### 2. Cache és verziókezelési problémák
- A Service Worker cache-elt verziókat szolgál ki
- A manifest `start_url` csak telepítéskor olvasódik be
- A böngésző cache törlése NEM törli a PWA saját cache-ét

## Próbálkozások és eredmények

### ❌ 1. próbálkozás: CSS `zoom` property
```css
@media (display-mode: standalone) {
  body { zoom: 1.15; }
}
```
**Eredmény:** A layout eltörött, az alsó gombok és beviteli mező eltűnt. A `zoom` nem kompatibilis a `100dvh` és `overflow: hidden` kombinációval.

### ❌ 2. próbálkozás: `text-size-adjust: none` és `max-height: 999999px`
```css
* { max-height: 999999px; }
body {
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
}
```
**Eredmény:** A böngészős változat lett brutálisan nagy, a PWA változat maradt kicsi. A workaround nem működött megfelelően.

### ❌ 3. próbálkozás: `@media (display-mode: standalone)` media query
```css
@media (display-mode: standalone) {
  .msg { font-size: 32px !important; }
  /* ... */
}
```
**Eredmény:** Nem működött a Pixel 10-en. A media query nem aktiválódott, valószínűleg a Chrome/ Android verzióspecifikus viselkedés miatt.

### ❌ 4. próbálkozás: JavaScript class injection
```javascript
window.onload = function() {
  if (window.matchMedia('(display-mode: standalone)').matches || 
      window.navigator.standalone) {
    document.body.classList.add('standalone');
  }
}
```
**Eredmény:** Nem működött. A `matchMedia` nem érzékelte a standalone módot.

### ✅ 5. próbálkozás: Manifest `start_url` paraméter + URL alapú érzékelés
```json
// manifest.json
"start_url": "./index.html?mode=standalone"
```

```javascript
// index.html - body elején
<script>
if (window.location.search.includes('standalone') || 
    window.matchMedia('(display-mode: standalone)').matches || 
    window.navigator.standalone) {
  document.body.classList.add('standalone');
}
</script>
```

```css
body.standalone .msg { font-size: 32px !important; }
/* ... többi override ... */
```

**Eredmény:** Ez a megbízható megoldás. Az ikonról indításkor az URL tartalmazza a `?mode=standalone` paramétert, amit a JavaScript azonnal érzékel és class-t ad hozzá.

## Aktuális implementáció (v5 - dinamikus scaling)

### 1. Manifest konfiguráció
```json
{
  "start_url": "./index.html?mode=standalone",
  "scope": "./",
  "display": "standalone"
}
```

### 2. CSS - dinamikus `--pwa-scale` custom property
A CSS mostantól `calc(Xpx * var(--pwa-scale))` formátumot használ, nem fix értékeket.
Az alap font-méretek megegyeznek a normál (nem-standalone) nézettel.
Csak ha a JavaScript eltérést mér, akkor kap a `--pwa-scale` más értéket mint 1.

```css
:root { --pwa-scale: 1; }
body.standalone .msg { font-size: calc(17px * var(--pwa-scale)) !important; }
/* ... többi elem hasonlóan ... */
```

### 3. JavaScript - automatikus font-scaling érzékelés
```html
<body>
<script>
(function() {
  var isStandalone = window.location.search.includes('standalone') ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone;

  if (isStandalone) {
    document.body.classList.add('standalone');

    // Mérjük: 16px-et állítunk, mennyit kapunk ténylegesen?
    var testEl = document.createElement('div');
    testEl.style.cssText = 'font-size:16px;position:absolute;visibility:hidden;pointer-events:none;';
    testEl.textContent = 'M';
    document.body.appendChild(testEl);
    var actualSize = parseFloat(window.getComputedStyle(testEl).fontSize);
    document.body.removeChild(testEl);

    var scale = 16 / actualSize;
    if (scale < 0.85 || scale > 1.15) {
      document.documentElement.style.setProperty('--pwa-scale', scale.toFixed(3));
    }
  }
})();
</script>
```

### Hogyan működik
- Ha a PWA standalone módban 16px helyett pl. 12px-et renderel → `scale = 16/12 = 1.33`
- A CSS `calc(17px * 1.33) = 22.6px` → kompenzál, visszaállítja a designolt méretet
- Ha nincs eltérés (böngészőben megnyitva), `--pwa-scale` marad `1` → nincs változás
- A megoldás **automatikusan alkalmazkodik** bármilyen rendszer betűméret-beállításhoz

## Fontos megjegyzések

### Telepítési/előzmény törlési procedúra
Mivel a manifest `start_url` csak telepítéskor olvasódik be, **minden manifest változtatásnál**:

1. Beállítások → Alkalmazások → "HűtésAI" → **Eltávolítás**
2. Chrome cache törlése az oldalra
3. Böngészőben megnyitni az új verziót
4. Újratelepítés: három pont ⋮ → "Alkalmazás telepítése"

### Service Worker verziókezelés
Minden jelentősebb változásnál növelni kell a cache verziót:
```javascript
const CACHE = 'hutestech-v5';  // ← növelni kell
```

## Alternatív megközelítések (jövőbeli fejlesztések)

1. **REM/EM egységek használata** a fix px helyett, hogy tiszteletben tartsa a rendszer beállításait
2. **CSS `clamp()` függvény** a reszponzív méretekhez
3. **JavaScript font-size slider** a felhasználói beállítások panelen
4. **CSS Container Queries** a komponens-szintű reszponzivitáshoz

## Kapcsolódó fájlok
- `index.html` - Fő CSS és JavaScript
- `manifest.json` - PWA konfiguráció, `start_url`
- `sw.js` - Service Worker, cache verziókezelés
