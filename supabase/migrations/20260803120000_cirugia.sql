-- ══════════════ DOMINIO CIRUGÍA (traslados a quirófano) ══════════════
-- Máquina de estados propia de un traslado a cirugía (overlay tipo "Cx" sobre la cama, NO un ticket
-- de public.traslados). Calca el patrón de public.limpiezas/comandas: tabla entorno-scoped + índice
-- único parcial "una viva por cama" + RLS de lectura por entorno + Realtime + soft-cancel.
--
-- 2 roles con app: Enfermería marca LISTO_PARA_CIRUGIA + RECIBIDA; Cirugía marca VAN_A_BUSCAR /
-- EN_CIRUGIA / EN_DEVOLUCION (el camillero es actor físico SIN app — Cirugía lo despacha verbal).
-- Si al devolver cambia la cama, Admisión consolida reusando la mecánica de traslados.
-- SIN campo `tipo`: no hay dato (D8 + PROGAL solo manda el flag Q + fecha probable, ver enrich).
-- El journey/timeline se adjunta en public.traslado_eventos (no tabla nueva).
-- Reutiliza public.set_updated_at() (ya creada por migraciones previas).

create table public.cirugia_traslados (
  id                 uuid primary key default gen_random_uuid(),
  entorno            text not null default 'TESTING',
  id_univoco         text not null,                          -- idempotencia del alta (reintento no duplica)
  paciente_codigo    text,                                   -- identidad primaria
  paciente_nombre    text,
  cama_origen        text not null,                          -- cama donde está el paciente (clave de la operatoria viva)
  cama_destino       text,                                   -- se setea al devolver, solo si cambia de cama
  area               text,                                   -- área/piso del origen (filtro de notis por sector + agrupar la cola)
  tipo               text,                                   -- "Tipo" de la solapa Internación (admissionType: Quirúrgica/Trasplante/Hemodinamia/…). Snapshot al alta.
  estado             text not null default 'LISTO_PARA_CIRUGIA'
                       check (estado in ('LISTO_PARA_CIRUGIA','VAN_A_BUSCAR','EN_CIRUGIA','EN_DEVOLUCION','PENDIENTE_CONSOLIDACION','RECIBIDA','CONSOLIDADO','CANCELADO')),
  motivo_cancelacion text,
  created_by_id      text,                                   -- quién marcó el LISTO (se excluye del push)
  last_actor_id      text,                                   -- quién marcó la última transición
  version            text,                                   -- APP_VERSION del cliente (versionado)
  fecha_cierre       timestamptz,                            -- RECIBIDA / CANCELADO
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 🔒 Candado real contra duplicados concurrentes: UNA operatoria VIVA por cama de origen + entorno.
-- Vivas = todos los estados menos los terminales (RECIBIDA/CANCELADO). Al cerrarse libera la cama.
create unique index cirugia_viva_uidx
  on public.cirugia_traslados (entorno, cama_origen)
  where estado in ('LISTO_PARA_CIRUGIA','VAN_A_BUSCAR','EN_CIRUGIA','EN_DEVOLUCION');

-- Idempotencia del alta (el POST reintentado no duplica).
create unique index cirugia_univoco_uidx on public.cirugia_traslados (entorno, id_univoco);

-- Cola/overlay: vivas por entorno+estado. Histórico: por fecha de cierre.
create index cirugia_estado_idx on public.cirugia_traslados (entorno, estado);
create index cirugia_cierre_idx on public.cirugia_traslados (entorno, fecha_cierre);

create trigger cirugia_set_updated_at before update on public.cirugia_traslados
  for each row execute function public.set_updated_at();

-- ── Realtime: el overlay Cx del mapa + la cola de Cirugías se actualizan solos (canal 'cirugia-live').
alter table public.cirugia_traslados replica identity full;
alter publication supabase_realtime add table public.cirugia_traslados;

-- ── RLS: lectura del cliente restringida a su entorno vía el claim del pase JWT; escrituras sin
-- policy → denegadas para authenticated (van por el backend con service_role, que bypassa RLS).
alter table public.cirugia_traslados enable row level security;

create policy cirugia_select_env on public.cirugia_traslados
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

-- ── Grants (authenticated: SELECT lo restringe la RLS; service_role: DML completo desde el backend).
grant select on public.cirugia_traslados to authenticated;
grant select, insert, update, delete on public.cirugia_traslados to service_role;
