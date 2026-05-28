# Hűtéstechnikai AI Súgó

PWA alkalmazás ipari és lakossági hűtéstechnikusoknak.

## Fájlok

| Fájl | Leírás |
|------|--------|
| `index.html` | Fő PWA alkalmazás (chat felület) |
| `manifest.json` | PWA telepíthetőség (homescreen ikon) |
| `sw.js` | Service worker (offline cache) |
| `admin.html` | Dokumentum feltöltő admin oldal |
| `supabase_setup.sql` | Adatbázis séma – Supabase SQL Editorban futtatd |
| `upload_to_supabase.py` | PC-s feltöltő script |

---

## Gyors indulás

### 1. App kipróbálása (Supabase nélkül)
Nyisd meg az `index.html`-t böngészőben → add meg a Gemini API kulcsot → kérdezz.
Tudásbázis nélkül a Gemini saját tudásából válaszol.

### 2. Supabase beállítás
1. Regisztrálj: [supabase.com](https://supabase.com) (ingyenes)
2. Hozz létre egy projektet
3. SQL Editor → másold be a `supabase_setup.sql` tartalmát → futtatd
4. Settings → API → másold ki a Project URL-t és az `anon` kulcsot
5. Az appban: Beállítások fül → Supabase URL + kulcs megadása

### 3. Dokumentumok feltöltése
1. Töltsd ki az `upload_to_supabase.py` tetején a beállításokat:
   - `SUPABASE_URL`, `SUPABASE_KEY` (service_role kulcs!), `GEMINI_KEY`
2. Futtasd: `python upload_to_supabase.py <mappa_vagy_fájl>`

### 4. Telepítés telefonra (PWA)
- Az app-ot HTTPS-en kell hosztolni (GitHub Pages vagy Netlify – mindkettő ingyenes)
- Androidon: böngésző menü → "Hozzáadás a főképernyőhöz"
- iOS-en: Safari → Megosztás → "Főképernyőre"

---

## GitHub Pages telepítés (ingyenes hosting)
1. GitHub.com → Új repo létrehozása
2. Fájlok feltöltése
3. Settings → Pages → Source: main branch
4. Az app elérhető: `https://<felhasználónév>.github.io/<repo-neve>/`

---

## API kulcsok
- **Gemini**: [aistudio.google.com/apikey](https://aistudio.google.com/apikey) – ingyenes
- **Supabase anon key**: publikus, biztonságos az appban tárolni
- **Supabase service_role key**: csak a feltöltő scriptben, NE tedd az appba!
