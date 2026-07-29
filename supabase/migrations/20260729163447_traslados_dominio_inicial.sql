-- ══════════════ DOMINIO TRASLADOS ══════════════
-- Migra 07.Traslados + 08.DetalleTraslados + 13.ObservacionesTraslados de SharePoint.
-- Relaciones eventos/obs → traslados por índice (no FK dura) para backfill sin fricción.
-- Ver docs/traslados-migracion-supabase.md para el mapeo columna a columna.

-- 1) traslados (07.Traslados) — tabla central
create table public.traslados (
  id                  uuid primary key default gen_random_uuid(),
  id_univoco          text not null,
  entorno             text not null default 'TESTING',
  paciente            text not null,
  codigo_paciente     text,
  cama_origen         text not null,
  cama_origen_codigo  text,
  cama_origen_status  text,
  cama_destino        text,
  cama_destino_codigo text,
  cama_destino_status text,
  workflow            text not null,
  status              text not null,
  financiador         text,
  motivo_cambio       text,
  motivo_cancelacion  text,
  observaciones       text,
  intervino_azafata   text not null default 'NO',
  created_by          text,
  created_by_id       bigint,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  updated_at          timestamptz not null default now(),
  unique (id_univoco, entorno)
);
create index traslados_entorno_status_idx    on public.traslados (entorno, status);
create index traslados_entorno_completed_idx on public.traslados (entorno, completed_at);
create index traslados_entorno_paciente_idx  on public.traslados (entorno, codigo_paciente);
-- un traslado ACTIVO por cama destino (reemplaza el chequeo de conflicto 409)
create unique index traslados_cama_destino_activa_idx
  on public.traslados (entorno, cama_destino)
  where status not in ('Consolidado','Cancelado') and cama_destino is not null;

-- 2) traslado_eventos (08.DetalleTraslados) — log de auditoría, append-only
create table public.traslado_eventos (
  id          uuid primary key default gen_random_uuid(),
  traslado_id text not null,           -- id_univoco del traslado (relación lógica)
  entorno     text not null default 'TESTING',
  tipo        text not null,           -- 'Solicitud Creada' | 'Inicio Traslado' | ...
  usuario     text,
  usuario_id  bigint,
  created_at  timestamptz not null default now()
);
create index traslado_eventos_ticket_idx on public.traslado_eventos (traslado_id, entorno, created_at);

-- 3) traslado_obs (13.ObservacionesTraslados) — notas con snapshot de status
create table public.traslado_obs (
  id            uuid primary key default gen_random_uuid(),
  traslado_id   text not null,
  entorno       text not null default 'TESTING',
  status_ticket text,                  -- snapshot del status al escribir la nota
  texto         text not null,
  usuario       text,
  usuario_id    bigint,
  created_at    timestamptz not null default now()
);
create index traslado_obs_ticket_idx on public.traslado_obs (traslado_id, entorno, created_at);

-- updated_at automático en traslados
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger traslados_set_updated_at before update on public.traslados
  for each row execute function public.set_updated_at();

-- 🔑 Realtime: el mapa en vivo se suscribe a traslados → esto reemplaza el poll de 15s
alter table public.traslados replica identity full;
alter publication supabase_realtime add table public.traslados;

-- RLS activado en las 3 desde el arranque (las policies se agregan en el próximo paso)
alter table public.traslados        enable row level security;
alter table public.traslado_eventos enable row level security;
alter table public.traslado_obs     enable row level security;
