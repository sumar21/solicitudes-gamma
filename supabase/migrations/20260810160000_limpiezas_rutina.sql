-- ══════════════ LIMPIEZA DE RUTINA (camas ocupadas) ══════════════
-- Distinta de public.limpiezas (esa es la limpieza terminal de una cama recién desocupada,
-- ciclo Activo→Inactivo). La RUTINA se hace ~2 veces por día sobre cada cama OCUPADA: la azafata
-- toca "Iniciar" y luego "Finalizar". Modelo de estados propio: INICIADA → FINALIZADA (dos
-- timestamps, para medir duración) + ANULADA (cancelar una abierta). NO cambia el estado de la
-- cama — es un overlay/flag sobre la cama ocupada. Se snapshotea el ocupante para el journey y el
-- reporte del día. Calca el patrón de limpiezas: entorno-scoped + índice único parcial + RLS +
-- Realtime + version. Reutiliza public.set_updated_at().

create table public.limpiezas_rutina (
  id                uuid primary key default gen_random_uuid(),
  entorno           text not null default 'TESTING',
  cama_label        text not null,                    -- clave de la rutina abierta (candado por cama)
  cama_codigo       text,
  habitacion        text,
  area              text,                             -- sector/piso (agrupar + filtrar el reporte)
  paciente_codigo   text,                             -- snapshot del ocupante al iniciar (journey + reporte)
  paciente_nombre   text,
  estado            text not null default 'INICIADA'
                      check (estado in ('INICIADA','FINALIZADA','ANULADA')),
  iniciada_por_id   text,
  iniciada_por      text,
  finalizada_por_id text,
  finalizada_por    text,
  motivo_anulacion  text,
  version           text,                             -- APP_VERSION del cliente
  fecha_inicio      timestamptz not null default now(),
  fecha_fin         timestamptz,                      -- FINALIZADA / ANULADA
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 🔒 UNA rutina ABIERTA por cama + entorno (candado real contra doble-inicio concurrente).
-- Al finalizar/anular libera la cama → se puede iniciar la siguiente ronda del día.
create unique index limpiezas_rutina_abierta_uidx
  on public.limpiezas_rutina (entorno, cama_label)
  where estado = 'INICIADA';

-- Reporte del día / histórico por fecha de inicio; y la cola de abiertas por estado.
create index limpiezas_rutina_inicio_idx on public.limpiezas_rutina (entorno, fecha_inicio);
create index limpiezas_rutina_estado_idx on public.limpiezas_rutina (entorno, estado);

create trigger limpiezas_rutina_set_updated_at before update on public.limpiezas_rutina
  for each row execute function public.set_updated_at();

-- ── Realtime: el overlay del mapa + el reporte se actualizan solos (canal 'limpiezas-rutina-live').
alter table public.limpiezas_rutina replica identity full;
alter publication supabase_realtime add table public.limpiezas_rutina;

-- ── RLS: lectura del cliente por entorno; escrituras por service_role (backend).
alter table public.limpiezas_rutina enable row level security;
create policy limpiezas_rutina_select_env on public.limpiezas_rutina
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

grant select on public.limpiezas_rutina to authenticated;
grant select, insert, update, delete on public.limpiezas_rutina to service_role;
