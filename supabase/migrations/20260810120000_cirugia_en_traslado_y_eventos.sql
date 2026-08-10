-- ══════════════ CIRUGÍA · paso "EN_TRASLADO" + tabla de detalle (eventos) ══════════════
-- 1) Nuevo estado EN_TRASLADO entre VAN_A_BUSCAR y EN_CIRUGIA: la enfermera confirma que ENTREGÓ
--    el paciente al camillero (transferencia de custodia — "se lo llevó el camillero"). El flujo
--    pasa a ser ESTRICTO: cada click existe y se registra, para poder medir tiempos (cuánto tarda
--    el camillero en buscar/entregar, cuánto dura la cirugía, cuánto la devolución, etc.).
-- 2) cirugia_eventos: log append-only de cada transición — la "tabla de detalle" de cirugía, que
--    calca public.traslado_eventos. Es lo que habilita calcular las duraciones entre pasos.

-- ── 1) Ampliar el CHECK del estado con EN_TRASLADO (superset → ninguna fila existente se viola) ──
alter table public.cirugia_traslados drop constraint if exists cirugia_traslados_estado_check;
alter table public.cirugia_traslados add constraint cirugia_traslados_estado_check
  check (estado in (
    'LISTO_PARA_CIRUGIA','VAN_A_BUSCAR','EN_TRASLADO','EN_CIRUGIA','EN_DEVOLUCION',
    'PENDIENTE_CONSOLIDACION','RECIBIDA','CONSOLIDADO','CANCELADO'
  ));

-- ── 2) EN_TRASLADO es VIVO (ocupa el candado "una viva por cama") → recrear el índice parcial ──
--    Como aún no existe ninguna fila EN_TRASLADO, el conjunto indexado no cambia: recrear es seguro.
drop index if exists cirugia_viva_uidx;
create unique index cirugia_viva_uidx
  on public.cirugia_traslados (entorno, cama_origen)
  where estado in ('LISTO_PARA_CIRUGIA','VAN_A_BUSCAR','EN_TRASLADO','EN_CIRUGIA','EN_DEVOLUCION');

-- ── 3) cirugia_eventos (detalle) — log append-only, calca public.traslado_eventos ─────────────
create table public.cirugia_eventos (
  id          uuid primary key default gen_random_uuid(),
  cirugia_id  text not null,           -- id (uuid) de cirugia_traslados (relación lógica, sin FK dura)
  entorno     text not null default 'TESTING',
  tipo        text not null,           -- estado/acción alcanzado: 'LISTO_PARA_CIRUGIA' | 'VAN_A_BUSCAR' | 'EN_TRASLADO' | …
  usuario     text,
  usuario_id  text,                    -- los ids de usuario de cirugía son text (no bigint como en traslados)
  meta        jsonb,                   -- contexto: { camaOrigen, camaDestino?, motivo?, estadoResultante? }
  version     text,                    -- APP_VERSION del cliente que disparó la transición
  created_at  timestamptz not null default now()
);
-- Lectura por operatoria en orden cronológico (timeline) y para las métricas de duración.
create index cirugia_eventos_idx on public.cirugia_eventos (cirugia_id, entorno, created_at);

-- RLS: lectura del cliente restringida a su entorno (calca cirugia_traslados); escrituras sin policy
-- → denegadas para authenticated (van por el backend con service_role, que bypassa RLS).
alter table public.cirugia_eventos enable row level security;
create policy cirugia_eventos_select_env on public.cirugia_eventos
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

grant select on public.cirugia_eventos to authenticated;
grant select, insert, update, delete on public.cirugia_eventos to service_role;
