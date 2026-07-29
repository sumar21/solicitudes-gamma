-- Limpiezas de habitaciones por azafatas (migra 14.Limpiezas de SharePoint).
-- Una limpieza = una cama que una azafata marcó limpia; overlay "Limpia" sobre lo que reporta
-- Gamma. Ciclo: Activo → Inactivo (cerrada por ticket/gamma/anulada/consolidado).
create table public.limpiezas (
  id             uuid primary key default gen_random_uuid(),
  entorno        text not null default 'TESTING',       -- Entorno_L
  cama_label     text not null,                          -- CamaLabel_L (clave de la limpieza activa)
  cama_codigo    text,                                   -- CamaCodigo_L
  habitacion     text,                                   -- Habitacion_L
  area           text,                                   -- Area_L (nombre de área real)
  status         text not null default 'Activo'
                   check (status in ('Activo','Inactivo')), -- Status_L
  motivo_cierre  text,                                   -- MotivoCierre_L (ANULADA|TICKET|GAMMA|CONSOLIDADO)
  azafata_id     text,                                   -- AzafataId_L
  azafata_nombre text,                                   -- AzafataNombre_L
  fecha_limpieza timestamptz,                            -- FechaLimpieza_L
  fecha_cierre   timestamptz,                            -- FechaCierre_L
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Una sola limpieza ACTIVA por cama+entorno (reemplaza el read-then-write racy de SP; el endpoint
-- igual hace upsert lógico, y este índice es el candado real contra duplicados concurrentes).
create unique index limpiezas_activa_uidx on public.limpiezas (entorno, cama_label) where status = 'Activo';
-- Histórico: cerradas por fecha de cierre.
create index limpiezas_cierre_idx on public.limpiezas (entorno, status, fecha_cierre);

create trigger limpiezas_set_updated_at before update on public.limpiezas
  for each row execute function public.set_updated_at();

-- Realtime: el overlay de limpiezas del mapa se actualiza solo (reemplaza el poll de 60s).
alter table public.limpiezas replica identity full;
alter publication supabase_realtime add table public.limpiezas;

-- Lectura del cliente (overlay) por entorno vía el pase; escrituras solo service_role.
create policy limpiezas_select_env on public.limpiezas
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

grant select on public.limpiezas to authenticated;
grant select, insert, update, delete on public.limpiezas to service_role;
