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
  created_at  timestamptz default now()
);

-- Full-text keresési index (kulcsszavas fallback)
create index if not exists documents_fts_idx
  on documents using gin(to_tsvector('hungarian', content));

-- Szemantikus keresési függvény (az app ezt hívja)
create or replace function match_documents(
  query_embedding vector(3072),
  match_threshold float  default 0.52,
  match_count     int    default 4
)
returns table (
  id         bigint,
  title      text,
  content    text,
  source     text,
  similarity float
)
language sql stable
as $$
  select
    d.id,
    d.title,
    d.content,
    d.source,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- Row Level Security: olvasás mindenki számára engedélyezett (anon kulcsal)
alter table documents enable row level security;

create policy "Publikus olvasás"
  on documents for select
  using (true);

-- Megjegyzés: írás (insert/delete) csak szerveren keresztül, nem anon kulcsal
