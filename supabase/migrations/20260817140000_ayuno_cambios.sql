-- ══════════════ HISTORIAL DE CAMBIOS DE AYUNO ══════════════
-- Espejo de public.dieta_cambios, pero para AYUNO (fasting). Log append-only de cada cambio de
-- ayuno que detecta cron-enrich-beds (compara el fasting del Payload_EC anterior vs el nuevo).
-- Antes ese cambio solo disparaba un push y se descartaba; ahora se persiste → historial COMPLETO
-- y DURABLE + es la fuente que dispara el push desde Supabase (webhook → Edge Function notify-change,
-- mismo patrón que traslados). entorno-scoped + RLS + service_role write.
--
-- resumen_prev/resumen_new: descripción horaria del ayuno antes/después ('sin ayuno' si no había).
-- detalle: frase lista para la notificación ("Nuevo ayuno programado: …" / "Ayuno cancelado" /
--          "Ayuno modificado: …"). La calcula el cron (una sola implementación) y la Edge Function
--          la usa tal cual para el body → no se re-implementa la lógica de fasting en Deno.

create table public.ayuno_cambios (
  id               uuid primary key default gen_random_uuid(),
  entorno          text not null default 'TESTING',
  paciente_codigo  text not null,
  paciente_nombre  text,
  area             text,                              -- sector/piso al momento del cambio
  habitacion       text,
  event_key        text,                              -- origen+número de evento Gamma (traza)
  resumen_prev     text,                              -- ayuno anterior (horario legible o 'sin ayuno')
  resumen_new      text,                              -- ayuno nuevo (horario legible o 'sin ayuno')
  detalle          text,                              -- frase de cambio (body de la notif)
  fecha_cambio     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- Listado del historial (más reciente primero) + por paciente (journey).
create index ayuno_cambios_fecha_idx     on public.ayuno_cambios (entorno, fecha_cambio desc);
create index ayuno_cambios_paciente_idx  on public.ayuno_cambios (entorno, paciente_codigo, fecha_cambio desc);

-- RLS: lectura del cliente por entorno (claim JWT); escritura por service_role (el cron).
alter table public.ayuno_cambios enable row level security;
create policy ayuno_cambios_select_env on public.ayuno_cambios
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

grant select on public.ayuno_cambios to authenticated;
grant select, insert, update, delete on public.ayuno_cambios to service_role;
