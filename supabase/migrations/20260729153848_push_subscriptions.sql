-- Suscripciones Web Push (migra 09.PushSubscriptions de SharePoint).
-- 🔑 EL FIX de las notis duplicadas: UNIQUE(endpoint). En SharePoint el dedup era un
-- check-then-write racy (dos suscripciones concurrentes → duplicado). Acá el duplicado es
-- IMPOSIBLE de crear: el alta es un upsert `on conflict (endpoint) do update`, atómico.
create table public.push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  endpoint       text not null unique,           -- una fila por endpoint, garantizado por la base
  keys           jsonb not null,                 -- { p256dh, auth }
  user_id        text,
  user_role      text,
  assigned_areas text[] not null default '{}',   -- array nativo (en SP era string con ';')
  sede           text not null default 'HPR',
  entorno        text not null default 'TESTING',
  last_seen_at   timestamptz not null default now(),  -- heartbeat: reemplaza el lastModified de SP
  created_at     timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id, entorno);
create index push_subscriptions_stale_idx on public.push_subscriptions (last_seen_at);

-- Solo el backend/Edge Function (service_role) lee y escribe las suscripciones. El cliente no
-- las lee directo; hace upsert de la suya (por endpoint) vía un endpoint fino o Edge Function.
-- RLS queda enabled (por el event trigger del proyecto) SIN policies: service_role la bypassa,
-- y anon/authenticated no tienen grants ni policy → candado total. Es intencional.
grant select, insert, update, delete on public.push_subscriptions to service_role;
