-- ══════════════ CIRUGÍA — MARCA "VA A CIRUGÍA" (pacientes SIN internación quirúrgica) ══════════════
-- Flag que Admisión prende sobre un PACIENTE para habilitar el circuito de Cirugía existente en camas
-- NO quirúrgicas (admissionTypeCode != 'Q'). NO es una operatoria: es un PRE-cursor keyed por PACIENTE
-- (no por cama) para que el flag SIGA al paciente aunque un traslado normal lo mueva de cama ANTES de
-- operarse (mismo criterio "sigue al paciente" del enrich). NO cambia el estado de la cama ni el Tipo de
-- internación de PROGAL (read-only). El circuito Cx (public.cirugia_traslados) queda INTACTO: el flag
-- sólo habilita el botón "Listo para cirugía"; desde el alta todo es el circuito de siempre.
-- Calca el patrón limpiezas_rutina/cirugia: entorno-scoped + índice único parcial "una viva" + RLS +
-- Realtime + soft-close. Reutiliza public.set_updated_at().
-- NOTA: public.roles NO lleva entorno (config compartida); esta tabla TRANSACCIONAL SÍ lo lleva.

create table public.cirugia_marcas (
  id               uuid primary key default gen_random_uuid(),
  entorno          text not null default 'TESTING',
  paciente_codigo  text not null,                     -- CLAVE de la marca viva (sigue al paciente, no a la cama)
  paciente_nombre  text,
  cama_label       text,                              -- snapshot al marcar (display/journey; NO es la clave)
  area             text,                              -- área/piso al marcar (agrupar/filtrar)
  estado           text not null default 'ACTIVA'
                     check (estado in ('ACTIVA','CERRADA','ANULADA')),
  motivo_cierre    text,                              -- 'cirugia_recibida' | 'admision_desmarco'
  marcada_por_id   text,
  marcada_por      text,
  cerrada_por_id   text,
  cerrada_por      text,
  operador         text,                              -- operador identificado (cuentas compartidas)
  version          text,                              -- APP_VERSION del cliente
  fecha_marca      timestamptz not null default now(),
  fecha_cierre     timestamptz,                       -- CERRADA / ANULADA
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 🔒 UNA marca ACTIVA por paciente + entorno: candado anti-doble-marca + idempotencia del POST vía 23505.
create unique index cirugia_marcas_activa_uidx
  on public.cirugia_marcas (entorno, paciente_codigo)
  where estado = 'ACTIVA';

-- Overlay por estado (marcas activas del entorno); journey/histórico por fecha de marca.
create index cirugia_marcas_estado_idx on public.cirugia_marcas (entorno, estado);
create index cirugia_marcas_marca_idx  on public.cirugia_marcas (entorno, fecha_marca);

create trigger cirugia_marcas_set_updated_at before update on public.cirugia_marcas
  for each row execute function public.set_updated_at();

-- ── Realtime: el overlay del mapa se sincroniza solo entre Admisión y Enfermería (canal 'cirugia-marcas-live').
alter table public.cirugia_marcas replica identity full;
alter publication supabase_realtime add table public.cirugia_marcas;

-- ── RLS: lectura del cliente por entorno (claim JWT); escrituras por service_role (backend).
alter table public.cirugia_marcas enable row level security;
create policy cirugia_marcas_select_env on public.cirugia_marcas
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

grant select on public.cirugia_marcas to authenticated;
grant select, insert, update, delete on public.cirugia_marcas to service_role;
