-- ══════════════ DOMINIO COMANDAS (pedidos de comida) ══════════════
-- Migra 15.CargaComandas + 16.CargaMenu de SharePoint. Calca el patrón de public.limpiezas:
-- tabla entorno-scoped + índice único parcial "una viva" + RLS de lectura por entorno + Realtime
-- + soft-delete. 12.EnrichCamas NO se migra (queda en SP; la lee api/dietas.ts de forma híbrida
-- para el backstop 409 'sin_dieta'). Reutiliza public.set_updated_at() (ya creada, search_path='').
--
-- OJO "comandas" ≠ "dietas": comandas = pedidos de comida (este dominio). Las notis DIET_CHANGE /
-- FASTING_CHANGE son de los crons (cron-enrich-beds / cron-diet-changes), que quedan en SP y NO
-- tocan estas tablas. Comandas NO emite push.

-- ── 1) comandas (15.CargaComandas) ──────────────────────────────────────────
-- Multi-fila: una fila = una bandeja. Titular (comensal='TITULAR', orden 0) + acompañantes
-- (orden max+1, inmutable) sobre la misma (identidad, comida, día). VIVA = Activo|Entregado.
create table public.comandas (
  id                    uuid primary key default gen_random_uuid(),
  entorno               text not null default 'TESTING',        -- Entorno_D
  cama_label            text not null,                          -- CamaLabel_D (fallback de identidad)
  cama_codigo           text,                                   -- CamaCodigo_D
  habitacion            text,                                   -- Habitacion_D (roomCode)
  area                  text,                                   -- Area_D
  paciente_nombre       text,                                   -- PacienteNombre_D
  paciente_codigo       text,                                   -- PacienteCodigo_D (identidad primaria)
  comida                text not null                           -- Comida_D
                          check (comida in ('DESAYUNO','ALMUERZO','MERIENDA','CENA')),
  tipo                  text not null                           -- Tipo_D
                          check (tipo in ('MENU','OPCION','OTROS')),
  detalle               text,                                   -- Detalle_D (requerido si tipo=OTROS, en app)
  observaciones         text,                                   -- Observaciones_D
  status                text not null default 'Activo'          -- Status_D
                          check (status in ('Activo','Entregado','Inactivo')),
  motivo_anulacion      text,                                   -- MotivoAnulacion_D
  nutricionista_nombre  text,                                   -- NutricionistaNombre_D
  nutricionista_id      bigint,                                 -- NutricionistaID_D (int nullable)
  comensal              text not null default 'TITULAR'         -- Comensal_D
                          check (comensal in ('TITULAR','ACOMPANANTE')),
  orden_comensal        integer not null default 0,             -- OrdenComensal_D (0=titular)
  fecha_carga           timestamptz not null default now(),     -- FechaCarga_D (deriva el día-ART)
  fecha_cierre          timestamptz,                            -- FechaCierre_D (entrega/anulación)
  -- Identidad efectiva del upsert: paciente si hay código, si no la cama. Materializada para
  -- indexar el lookup (reemplaza el identityClause OData que se armaba en JS).
  identidad             text generated always as
                          (coalesce(nullif(paciente_codigo,''), cama_label)) stored,
  -- Día calendario en hora Argentina (UTC-3). El "día" NO existía como columna en SP: se filtraba
  -- en JS (artDay). Se materializa para poder WHERE dia = <hoy-ART> indexado. Cada PATCH/reuso
  -- re-setea fecha_carga=now() → dia se recomputa a hoy (reusar una pendiente vieja la "muda" a hoy).
  -- Offset FIJO -03:00 (no zona nombrada): Argentina no tiene DST, y `AT TIME ZONE interval` es
  -- IMMUTABLE (requisito de una columna generated), a diferencia de `AT TIME ZONE '<zona>'` sobre
  -- timestamptz, que es STABLE.
  dia                   date generated always as
                          (((fecha_carga at time zone interval '-03:00'))::date) stored,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 🔒 Candado real contra duplicados concurrentes: UN solo TITULAR vivo (pendiente o entregado)
-- por (entorno, identidad, comida, día). Los ACOMPAÑANTES quedan FUERA a propósito: la RAMA C
-- inserta (nunca upsertea) y admite varias bandejas por turno, incluso en carrera.
create unique index comandas_titular_viva_uidx
  on public.comandas (entorno, identidad, comida, dia)
  where comensal = 'TITULAR' and status in ('Activo','Entregado');

-- GET de hoy: vivas por entorno/día. Histórico: por día de carga. Lookup del upsert: por identidad.
create index comandas_vivas_idx     on public.comandas (entorno, status, dia);
create index comandas_dia_idx       on public.comandas (entorno, dia, fecha_carga);
create index comandas_identidad_idx on public.comandas (entorno, identidad, comida);

create trigger comandas_set_updated_at before update on public.comandas
  for each row execute function public.set_updated_at();

-- ── 2) carga_menu (16.CargaMenu) ────────────────────────────────────────────
-- Plantilla de menú por rango de fechas (autocompleta la carga por paciente; copia por valor).
create table public.carga_menu (
  id                 uuid primary key default gen_random_uuid(),
  entorno            text not null default 'TESTING',           -- Entorno_CM
  turno              text not null                              -- Turno_CM
                       check (turno in ('DESAYUNO','ALMUERZO','MERIENDA','CENA')),
  tipo               text not null                              -- Tipo_CM
                       check (tipo in ('MENU','OPCION')),
  fecha_inicio       date not null,                             -- FechaInicio_CM (date → 'YYYY-MM-DD', sin hack T12Z)
  fecha_fin          date not null,                             -- FechaFin_CM
  comanda            text not null                              -- Comanda_CM
                       check (char_length(comanda) <= 255),
  status             text not null default 'Activo'             -- Status_CM
                       check (status in ('Activo','Inactivo')),
  nombre_user_carga  text,                                      -- NombreUserCarga_CM
  user_id            bigint,                                    -- UserID_CM (int nullable, sin quirk uidField)
  fecha_carga        timestamptz not null default now(),        -- FechaCarga_CM (INSTANTE)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- Filtro activo del GET (Status_CM='Activo' and Entorno_CM). El no-overlap por (turno,tipo) se
-- sigue validando en JS en el endpoint para preservar el 409 con conflictingId human-readable.
create index carga_menu_activa_idx on public.carga_menu (entorno, status, turno, tipo);

create trigger carga_menu_set_updated_at before update on public.carga_menu
  for each row execute function public.set_updated_at();

-- ── Realtime ────────────────────────────────────────────────────────────────
-- comandas: reemplaza el poll de 60s del overlay de meals (canal 'comandas-live' en el cliente).
alter table public.comandas replica identity full;
alter publication supabase_realtime add table public.comandas;
-- carga_menu: Realtime OPCIONAL (ambos consumidores hacen fetch-on-open, baja rotación). Se deja
-- fuera de la publicación por ahora; agregarla es un one-liner si se quiere en el futuro.

-- ── RLS + policies de LECTURA por entorno (idéntico a limpiezas/traslados) ────
-- Lectura del cliente restringida a su entorno vía el claim del pase JWT. Escrituras: sin policy
-- → denegadas para authenticated; van por el backend con service_role (bypassa RLS).
alter table public.comandas   enable row level security;
alter table public.carga_menu enable row level security;

create policy comandas_select_env on public.comandas
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

create policy carga_menu_select_env on public.carga_menu
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

-- ── Grants (authenticated: SELECT lo restringe la RLS; service_role: DML completo) ──
grant select on public.comandas   to authenticated;
grant select on public.carga_menu to authenticated;
grant select, insert, update, delete on public.comandas   to service_role;
grant select, insert, update, delete on public.carga_menu to service_role;
