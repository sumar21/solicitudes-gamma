-- ══════════════ ENRICH DE CAMAS → SUPABASE (Fase 2, migración de 12.EnrichCamas SP) ══════════════
-- Reemplaza gradualmente la lista SharePoint 12.EnrichCamas (precompute del cron cada 15': dieta,
-- ayuno, DNI, diagnóstico, internación, aislamientos por cama ocupada).
--
-- CLAVE del diseño: UNIQUE (entorno, event_key). El cron hace upsert ON CONFLICT → una sola fila por
-- evento, atómico, a prueba de carreras → los DUPLICADOS son IMPOSIBLES. SharePoint no tenía esta
-- restricción y por eso acumulaba filas duplicadas activas con el mismo EventKey (bug del 2026-08-18
-- que bloqueaba comandas con falso "sin dieta"). Esta tabla elimina esa clase de bug de raíz.
--
-- SEGURIDAD: el payload trae datos médicos (dni, diagnóstico). NO se expone al cliente: el enrich se
-- sirve SOLO server-side vía /api/beds (service_role, que aplica el scoping por rol). Por eso NO hay
-- política de select para authenticated — solo service_role escribe y lee.

create table public.enrich_camas (
  id            uuid primary key default gen_random_uuid(),
  entorno       text not null default 'TESTING',
  event_key     text not null,                    -- origen-numero de evento Gamma (HIN-70204, etc.)
  patient_code  text,
  payload       jsonb not null,                   -- EnrichResult (dieta/ayuno/dni/dx/…)
  status        text not null default 'Activo',   -- 'Activo' | 'Inactivo' (cama liberada)
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (entorno, event_key)                     -- ← el upsert ON CONFLICT usa esto: sin duplicados
);

create index enrich_camas_entorno_status_idx on public.enrich_camas (entorno, status);

alter table public.enrich_camas enable row level security;
-- Sin policy de select para authenticated (dato médico): solo service_role.
grant select, insert, update, delete on public.enrich_camas to service_role;
