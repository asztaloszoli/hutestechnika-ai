"""
Webcím / YouTube beolvasó a hűtéstechnikai tudásbázishoz
========================================================
Egy linkből (weboldal VAGY YouTube videó) kiszedi a szöveget,
és feltölti a Supabase tudásbázisba – ugyanúgy, mint a fájlfeltöltő.

A megbízható kinyerést az "online kutató robot" bevált eszközeiből vettük át:
  - YouTube felirat:  youtube-transcript-api
  - Weboldal:         TinyFish Fetch (tiszta markdown), vagy BeautifulSoup tartalék

Használat:
  python beolvas_url.py "https://valami-oldal.hu/cikk"
  python beolvas_url.py "https://www.youtube.com/watch?v=XXXXXXXXXXX"
  python beolvas_url.py "https://..." --cim "Egyéni cím"

Beállítások:
  Ugyanazok, mint az upload_to_supabase.py-nál (SUPABASE_URL, SUPABASE_KEY,
  GEMINI_KEY). Ha azokat ott kitöltötted, innen is működik. Megadhatók
  környezeti változóként vagy .env fájlban is.
  Opcionális: TINYFISH_API_KEY a tisztább weboldal-kinyeréshez.

Telepítés:
  pip install requests beautifulsoup4 youtube-transcript-api python-dotenv
"""

import os
import re
import sys
import time

import requests

# A meglévő feltöltő logika újrahasználása (chunkolás, embedding, Supabase feltöltés)
import upload_to_supabase as up

# .env betöltése, ha elérhető (nem kötelező)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# YouTube felirat könyvtár (a kutató robotból átvett megoldás)
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    HAS_YT = True
except ImportError:
    HAS_YT = False


TINYFISH_FETCH_URL = "https://api.fetch.tinyfish.ai"


# ===== BEÁLLÍTÁSOK BETÖLTÉSE =====
def resolve_config():
    """Beállítások összegyűjtése: előbb az upload_to_supabase.py-ból, majd .env / környezeti változókból."""
    url = up.SUPABASE_URL or os.getenv("SUPABASE_URL", "")
    key = up.SUPABASE_KEY or os.getenv("SUPABASE_KEY", "")
    gem = up.GEMINI_KEY or os.getenv("GEMINI_KEY", "") or os.getenv("GEMINI_API_KEY", "")

    missing = [n for n, v in [("SUPABASE_URL", url), ("SUPABASE_KEY", key), ("GEMINI_KEY", gem)] if not v]
    if missing:
        print("HIBA: Hiányzó beállítások:", ", ".join(missing))
        print("Töltsd ki az upload_to_supabase.py tetején, vagy add meg .env fájlban.")
        sys.exit(1)

    # A feltöltő modul globális értékeit beállítjuk, hogy az embed() és upload_chunk() működjön
    up.SUPABASE_URL = url
    up.SUPABASE_KEY = key
    up.GEMINI_KEY = gem
    up.SUPABASE_INSERT = f"{url}/rest/v1/documents"


# ===== YOUTUBE =====
def youtube_id(url: str):
    """YouTube videó azonosító kinyerése a linkből."""
    m = re.search(r'(?:v=|youtu\.be/|embed/|shorts/|live/)([A-Za-z0-9_-]{11})', url)
    return m.group(1) if m else None


def youtube_title(video_id: str) -> str:
    """Videó címe a YouTube oEmbed végpontról (nem kell hozzá kulcs)."""
    try:
        resp = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
            timeout=15,
        )
        if resp.ok:
            return resp.json().get("title", f"YouTube videó {video_id}")
    except Exception:
        pass
    return f"YouTube videó {video_id}"


def fetch_youtube(url: str):
    """YouTube videó feliratának (átiratának) kinyerése. Visszaad: (cím, szöveg)."""
    if not HAS_YT:
        print("HIBA: a youtube-transcript-api nincs telepítve. Telepítsd: pip install youtube-transcript-api")
        sys.exit(1)
    vid = youtube_id(url)
    if not vid:
        print("HIBA: nem ismertem fel a YouTube videó azonosítóját.")
        sys.exit(1)

    title = youtube_title(vid)

    # Több nyelven próbálkozunk: előbb magyar, majd angol, végül bármi
    segments = None
    for langs in (["hu"], ["en"], None):
        try:
            # Újabb (1.x) API: példányosított fetch
            try:
                api = YouTubeTranscriptApi()
                fetched = api.fetch(vid, languages=langs) if langs else api.fetch(vid)
                segments = [getattr(s, "text", "") for s in fetched]
            except (TypeError, AttributeError):
                # Régebbi API: statikus get_transcript
                data = YouTubeTranscriptApi.get_transcript(vid, languages=langs) if langs else YouTubeTranscriptApi.get_transcript(vid)
                segments = [s.get("text", "") for s in data]
            if segments:
                break
        except Exception:
            continue

    if not segments:
        print("HIBA: ehhez a videóhoz nem találtam feliratot (csak feliratos videó dolgozható fel).")
        sys.exit(1)

    text = " ".join(seg for seg in segments if seg).strip()
    return title, text


# ===== WEBOLDAL =====
def fetch_via_tinyfish(url: str):
    """Weboldal tartalma TinyFish Fetch API-val (tiszta markdown). Csak ha van TINYFISH_API_KEY."""
    key = os.getenv("TINYFISH_API_KEY", "")
    if not key:
        return None
    try:
        resp = requests.post(
            TINYFISH_FETCH_URL,
            headers={"X-API-Key": key, "Content-Type": "application/json"},
            json={"urls": [url]},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        results = data if isinstance(data, list) else data.get("results", data.get("data", []))
        if results:
            item = results[0]
            return item.get("content", item.get("markdown", item.get("text", ""))) or None
    except Exception as e:
        print(f"  TinyFish Fetch nem sikerült ({e}), tartalék: BeautifulSoup")
    return None


def fetch_via_soup(url: str):
    """Weboldal szövege requests + BeautifulSoup segítségével (tartalék megoldás)."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        print("HIBA: a beautifulsoup4 nincs telepítve. Telepítsd: pip install beautifulsoup4")
        sys.exit(1)

    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; HutestechnikaBot/1.0)"}, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer", "svg", "iframe", "form", "button"]):
        tag.decompose()
    main = soup.find("article") or soup.find("main") or soup.body or soup
    text = main.get_text(separator="\n")
    lines = [ln.strip() for ln in text.splitlines()]
    text = "\n".join(ln for ln in lines if ln)
    title = soup.title.string.strip() if soup.title and soup.title.string else url
    return title, text


def fetch_web(url: str):
    """Weboldal szöveg kinyerése: előbb TinyFish (ha van kulcs), különben BeautifulSoup. (cím, szöveg)."""
    title, _ = (url, "")
    content = fetch_via_tinyfish(url)
    if content:
        # A címet a TinyFish nem mindig adja vissza, ezért külön is megpróbáljuk
        try:
            title2, _ = fetch_via_soup(url)
            title = title2
        except Exception:
            title = url
        return title, content
    return fetch_via_soup(url)


# ===== FELTÖLTÉS =====
def clean_text(text: str) -> str:
    """Null és vezérlő karakterek eltávolítása (a Supabase nem tűri a \\u0000-t)."""
    text = text.replace("\u0000", "")
    return re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", text)


def upload_text(title: str, text: str, source: str):
    """A kinyert szöveget chunkokra bontja, beágyazza és feltölti a Supabase-be."""
    text = clean_text(text)
    chunks = up.chunk_text(text)
    if not chunks:
        print("  Üres tartalom, nincs mit feltölteni.")
        return

    print(f"  {len(chunks)} chunk generálva, feltöltés...")
    for i, chunk in enumerate(chunks):
        chunk_title = f"{title} [{i+1}/{len(chunks)}]" if len(chunks) > 1 else title
        print(f"  chunk {i+1}/{len(chunks)}...", end=" ", flush=True)
        try:
            emb = up.embed(chunk)
            ok = up.upload_chunk(chunk_title, chunk, emb, source, i)
            print("✓" if ok else "✗")
            time.sleep(1.0)
        except up.QuotaExceededError as e:
            print(f"\n\n⛔ KVÓTA KIMERÜLT a(z) {i+1}. chunknál! ({e})")
            print("   A napi ingyenes keret elfogyott – holnap próbáld újra.")
            sys.exit(2)
        except Exception as e:
            print(f"✗ hiba: {e}")
            time.sleep(2)


# ===== FŐPROGRAM =====
def main():
    args = [a for a in sys.argv[1:]]
    if not args:
        print(__doc__)
        sys.exit(1)

    url = args[0]
    cim = None
    if "--cim" in args:
        idx = args.index("--cim")
        if idx + 1 < len(args):
            cim = args[idx + 1]

    if not re.match(r"^https?://", url, re.I):
        print("HIBA: a linknek http:// vagy https:// kezdetűnek kell lennie.")
        sys.exit(1)

    resolve_config()

    print(f"\n🌐 Feldolgozás: {url}")
    if "youtube.com" in url.lower() or "youtu.be" in url.lower():
        print("  📺 YouTube videó felismerve – felirat letöltése...")
        title, text = fetch_youtube(url)
        source = f"youtube:{youtube_id(url)}"
    else:
        print("  ⬇️ Weboldal letöltése...")
        title, text = fetch_web(url)
        source = url

    if cim:
        title = cim

    if not text or len(text.strip()) < 30:
        print("HIBA: nem sikerült érdemi szöveget kinyerni ebből a linkből.")
        sys.exit(1)

    print(f"  ✓ Cím: {title}")
    print(f"  ✓ Szöveg: {len(text)} karakter")
    upload_text(title, text, source)
    print("\n✅ Kész – a tartalom bekerült a tudásbázisba.")


if __name__ == "__main__":
    main()
