"""
Hűtéstechnikai tudásbázis feltöltő – Supabase
===============================================
Használat:
  python upload_to_supabase.py <fájl_vagy_mappa>

Támogatott formátumok: .md, .txt, .pdf (ha pymupdf telepítve van)

Szükséges Python csomagok:
  pip install requests pymupdf
  vagy: pip install requests pypdf (ha pymupdf nem telepíthető)

Beállítások (töltsd ki):
"""

import os
import sys
import json
import math
import time
import requests

# ===== BEÁLLÍTÁSOK – IDE ÍRD BE =====
SUPABASE_URL = ""   # pl. "https://abcdefgh.supabase.co"
SUPABASE_KEY = ""   # Publishable VAGY Service Role kulcs – Supabase → Settings → API
GEMINI_KEY   = ""   # Google AI Studio API kulcs
# =====================================

CHUNK_SIZE   = 400   # szavak száma egy chunk-ban
CHUNK_OVERLAP = 50   # átfedés szavakban
EMBED_MODEL  = "models/gemini-embedding-001"
EMBED_URL    = f"https://generativelanguage.googleapis.com/v1beta/{EMBED_MODEL}:embedContent"
SUPABASE_INSERT = f"{SUPABASE_URL}/rest/v1/documents"


def check_config():
    missing = [k for k, v in [("SUPABASE_URL", SUPABASE_URL), ("SUPABASE_KEY", SUPABASE_KEY), ("GEMINI_KEY", GEMINI_KEY)] if not v]
    if missing:
        print(f"HIBA: Töltsd ki a beállításokat a script tetején: {', '.join(missing)}")
        sys.exit(1)


def read_pdf(path: str) -> str:
    # 1. próba: pymupdf (fitz) – legjobb minőség
    try:
        import fitz
        doc = fitz.open(path)
        text = "\n".join(page.get_text() for page in doc)
        if text.strip():
            print("  (pymupdf/fitz)")
            return text
    except ImportError:
        pass
    except Exception as e:
        print(f"  pymupdf hiba: {e}")

    # 2. próba: pypdf – alternatíva
    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        if text.strip():
            print("  (pypdf)")
            return text
    except ImportError:
        pass
    except Exception as e:
        print(f"  pypdf hiba: {e}")

    print("  HIBA: PDF olvasáshoz telepítsd: pip install pymupdf")
    print("  vagy: pip install pypdf")
    return ""


def read_file(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        return read_pdf(path)
    else:
        with open(path, encoding="utf-8", errors="ignore") as f:
            return f.read()


def chunk_text(text: str, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP) -> list[str]:
    words = text.split()
    if len(words) <= chunk_size:
        return [text] if text.strip() else []
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return chunks


class QuotaExceededError(Exception):
    pass


def embed(text: str) -> list[float]:
    resp = requests.post(
        EMBED_URL + f"?key={GEMINI_KEY}",
        json={
            "model": EMBED_MODEL,
            "content": {"parts": [{"text": text}]},
            "taskType": "RETRIEVAL_DOCUMENT"
        },
        timeout=30
    )
    if resp.status_code == 429 or (resp.status_code != 200 and "quota" in resp.text.lower()):
        raise QuotaExceededError(resp.json().get("error", {}).get("message", "Quota exceeded"))
    resp.raise_for_status()
    vec = resp.json()["embedding"]["values"]
    # normalizálás
    n = math.sqrt(sum(v * v for v in vec))
    return [v / n for v in vec] if n > 0 else vec


def upload_chunk(title: str, content: str, embedding: list[float], source: str, chunk_idx: int):
    resp = requests.post(
        SUPABASE_INSERT,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        json={
            "title": title,
            "content": content,
            "embedding": embedding,
            "source": source,
            "chunk_idx": chunk_idx
        },
        timeout=30
    )
    if resp.status_code not in (200, 201):
        print(f"  HIBA feltöltésnél: {resp.status_code} – {resp.text[:200]}")
        return False
    return True


def process_file(path: str, global_counter: list, start_from: int = 0):
    filename = os.path.basename(path)
    title = os.path.splitext(filename)[0]
    print(f"\n📄 Feldolgozás: {filename}")

    text = read_file(path)
    if not text.strip():
        print("  Üres fájl, kihagyva.")
        return

    chunks = chunk_text(text)
    print(f"  {len(chunks)} chunk generálva")

    for i, chunk in enumerate(chunks):
        global_counter[0] += 1
        chunk_num = global_counter[0]
        if chunk_num < start_from:
            print(f"  chunk {chunk_num} kihagyva (--start-from {start_from})")
            continue
        chunk_title = f"{title} [{i+1}/{len(chunks)}]" if len(chunks) > 1 else title
        print(f"  chunk {chunk_num} – Embedding {i+1}/{len(chunks)}...", end=" ", flush=True)
        try:
            emb = embed(chunk)
            ok = upload_chunk(chunk_title, chunk, emb, filename, i)
            print("✓" if ok else "✗")
            time.sleep(1.0)  # rate limit elkerülése
        except QuotaExceededError as e:
            print(f"\n\n⛔ KVÓTA KIMERÜLT a {chunk_num}. chunknál!")
            print(f"   Hiba: {e}")
            print(f"\n   Folytatáshoz holnap futtasd újra:")
            print(f"   python upload_to_supabase.py <mappa> --start-from {chunk_num}")
            sys.exit(2)
        except Exception as e:
            print(f"✗ hiba: {e}")
            time.sleep(2)


def main():
    check_config()

    if len(sys.argv) < 2:
        print("Használat: python upload_to_supabase.py <fájl_vagy_mappa>")
        print("Példák:")
        print("  python upload_to_supabase.py dokumentumok/")
        print("  python upload_to_supabase.py hutokozeg_tablazat.pdf")
        sys.exit(1)

    target = sys.argv[1]
    files = []

    if os.path.isfile(target):
        files = [target]
    elif os.path.isdir(target):
        for root, _, fnames in os.walk(target):
            for fn in fnames:
                if fn.lower().endswith(('.md', '.txt', '.pdf')):
                    files.append(os.path.join(root, fn))
    else:
        print(f"HIBA: Nem létező fájl vagy mappa: {target}")
        sys.exit(1)

    if not files:
        print("Nem találtam .md, .txt vagy .pdf fájlt.")
        sys.exit(1)

    start_from = 1
    if "--start-from" in sys.argv:
        idx = sys.argv.index("--start-from")
        try:
            start_from = int(sys.argv[idx + 1])
            print(f"▶️  Folytatás a {start_from}. chunktól...")
        except (IndexError, ValueError):
            print("HIBA: --start-from után add meg a chunk számát (pl. --start-from 236)")
            sys.exit(1)

    global_counter = [0]
    print(f"🔍 {len(files)} fájl feldolgozása...")
    for f in files:
        process_file(f, global_counter, start_from)

    print("\n✅ Kész!")


if __name__ == "__main__":
    main()
