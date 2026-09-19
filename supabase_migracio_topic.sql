-- EGYSZERI MIGRÁCIÓ meglévő tudásbázishoz: "topic" (téma) oszlop + új keresőfüggvény
-- =====================================================================
-- ÍGY FUTTASD (egyszer, az egészet egyben):
--   1. supabase.com → jelentkezz be → válaszd ki a projekted
--   2. Bal oldali menü: "SQL Editor" → "New query"
--   3. Másold be ennek a fájlnak a TELJES tartalmát
--   4. Kattints a "Run" gombra
--   5. Ha minden OK: a meglévő dokumentumaid "hűtéstechnika" címkét kapnak,
--      és a keresés tud téma szerint szűrni.
-- =====================================================================

-- 1) Téma oszlop hozzáadása (ha még nincs)
alter table documents add column if not exists topic text not null default 'általános';
create index if not exists documents_topic_idx on documents (topic);

-- 2) Régi keresőfüggvény törlése (a szignatúra változott, ezért kell drop)
drop function if exists match_documents(vector, float, int);

-- 3) Új keresőfüggvény: match_topic paraméterrel (null = minden téma)
create or replace function match_documents(
  query_embedding vector(3072),
  match_threshold float  default 0.52,
  match_count     int    default 4,
  match_topic     text   default null
)
returns table (
  id         bigint,
  title      text,
  content    text,
  source     text,
  topic      text,
  similarity float
)
language sql stable
as $$
  select
    d.id,
    d.title,
    d.content,
    d.source,
    d.topic,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
    and (match_topic is null or d.topic = match_topic)
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- 4) Visszatöltés: a meglévő sorok (mind hűtéstechnikai tartalom) címkézése.
--    Ha NEM akarod, hogy minden régi sor 'hűtéstechnika' legyen,
--    ezt a sort futtatás előtt tedd kommentbe (-- elé).
update documents set topic = 'hűtéstechnika' where topic = 'általános';
