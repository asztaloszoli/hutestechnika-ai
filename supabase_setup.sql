-- Hűtéstechnikai AI Súgó – Supabase adatbázis séma
-- Futtatd a Supabase SQL Editor-ban

-- pgvector extension engedélyezése
create extension if not exists vector;

-- Dokumentumok tábla
create table if not exists documents (
  id          bigserial primary key,
  title       text not null,
  content     text not null,
  embedding   vector(3072),
  source      text,          -- eredeti fájl neve
  chunk_idx   int default 0, -- hanyadik chunk a fájlban
  topic       text not null default 'általános', -- téma/kategória (több-témájú tudásbázis)
  created_at  timestamptz default now()
);

-- Meglévő tábla bővítése téma mezővel (ha már létezik a tábla)
alter table documents add column if not exists topic text not null default 'általános';
create index if not exists documents_topic_idx on documents (topic);

-- Egyszeri visszatöltés (csak EGYSZER futtasd, ha már vannak sorok a táblában):
-- a meglévő hűtéstechnikai dokumentumok megkapják a 'hűtéstechnika' címkét.
-- Vedd ki a kommentet az alábbi sorból, futtasd le, majd tedd vissza kommentbe:
-- update documents set topic = 'hűtéstechnika' where topic = 'általános';

-- Full-text keresési index (kulcsszavas fallback)
create index if not exists documents_fts_idx
  on documents using gin(to_tsvector('hungarian', content));

-- Régi verzió törlése (a szignatúra változott: topic oszlop + match_topic paraméter)
drop function if exists match_documents(vector, float, int);

-- Szemantikus keresési függvény (az app ezt hívja)
-- match_topic: null = minden téma; egyébként csak az adott témában keres
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

-- Row Level Security: olvasás mindenki számára engedélyezett (anon kulcsal)
alter table documents enable row level security;

create policy "Publikus olvasás"
  on documents for select
  using (true);

-- Megjegyzés: írás (insert/delete) csak szerveren keresztül, nem anon kulcsal
