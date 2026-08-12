-- ══════════════ HISTORIAL DE CAMBIOS DE DIETA ══════════════
-- Log append-only de cada cambio de dieta detectado por cron-enrich-beds (compara el dietTags del
-- Payload_EC anterior vs el nuevo). Guarda el "de X → a Y" que hoy sólo se usaba para el push y se
-- descartaba. Independiente de push/suscriptores/retención de la campanita → historial COMPLETO y
-- DURABLE. NO cambia el estado de nada; es sólo auditoría. entorno-scoped + RLS + service_role write.

create table public.dieta_cambios (
  id               uuid primary key default gen_random_uuid(),
  entorno          text not null default 'TESTING',
  paciente_codigo  text not null,
  paciente_nombre  text,
  area             text,                              -- sector/piso al momento del cambio
  habitacion       text,
  event_key        text,                              -- origen+número de evento Gamma (traza)
  tags_prev        text,                              -- tags de dieta anteriores (join '; ')
  tags_new         text,                              -- tags de dieta nuevos (join '; ')
  fecha_cambio     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- Listado del historial (más reciente primero) + por paciente (journey).
create index dieta_cambios_fecha_idx     on public.dieta_cambios (entorno, fecha_cambio desc);
create index dieta_cambios_paciente_idx  on public.dieta_cambios (entorno, paciente_codigo, fecha_cambio desc);

-- RLS: lectura del cliente por entorno (claim JWT); escritura por service_role (el cron).
alter table public.dieta_cambios enable row level security;
create policy dieta_cambios_select_env on public.dieta_cambios
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

grant select on public.dieta_cambios to authenticated;
grant select, insert, update, delete on public.dieta_cambios to service_role;
