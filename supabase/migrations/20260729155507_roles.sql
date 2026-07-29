-- Migración: sistema de ROLES (mueve 99.ABMRoles_Traslados de SharePoint a Postgres).
-- Mismo patrón de candado que public.push_subscriptions: RLS enabled, SIN policies, grants SOLO
-- a service_role. El backend (api/) lee/escribe con la SERVICE key; ni anon ni authenticated
-- tienen grant ni policy → no ven roles nunca. El cliente sigue recibiendo permisos/módulos por
-- el BODY de /api/auth y /api/me, no toca esta tabla directo.
create table public.roles (
  id                    uuid primary key default gen_random_uuid(),
  -- NombreRol_RT. CLAVE DE JOIN por nombre (Perfil_U de 00.Usuarios ↔ name), resuelta
  -- case/trim-insensitive en getRoleByName. El índice único por lower(name) evita dos roles
  -- que colisionen en el lookup (hoy en SP nada lo impide).
  name                  text not null,
  -- Acceso_RT (en SP era string con '/'). Array nativo: elimina el split/join load-bearing.
  -- El endpoint de la ABM recompone 'a/b' para no romper el front.
  modules               text[] not null default '{}',
  -- Permisos_RT (en SP string con ';'). Array nativo, mismo criterio.
  permissions           text[] not null default '{}',
  -- FiltrarPisos_RT (en SP string 'Sí'/'No'). Boolean nativo: mata la asimetría de escritura
  -- que existía en SP (FiltrarPisos como 'Sí'/'No' vs BypassUbicacion como boolean).
  filter_by_floors      boolean not null default false,
  -- BypassUbicacion_RT (en SP ya era boolean Yes/No).
  bypass_location_check boolean not null default false,
  -- Status_RT. Soft-delete: DELETE = update status='Inactivo'. Las lecturas filtran 'Activo'.
  -- Se conserva como texto (no boolean is_active) para que el GET de la ABM siga devolviendo
  -- `status` verbatim como hoy.
  status                text not null default 'Activo'
                          check (status in ('Activo','Inactivo')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Join por nombre case-insensitive garantizado único (getRoleByName / me.ts / push-utils).
create unique index roles_name_lower_uidx on public.roles (lower(name));
-- Las 3 rutas de lectura filtran status='Activo'; índice parcial para ese acceso.
create index roles_active_idx on public.roles (status) where status = 'Activo';

-- updated_at automático. Reutiliza la función ya existente (creada en la migración de traslados,
-- endurecida con search_path='' en 20260729163645). No se redefine.
create trigger roles_set_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

-- Candado idéntico a push_subscriptions: solo el backend (service_role) entra. El event trigger
-- rls_auto_enable del proyecto activa RLS al crear la tabla; queda SIN policies.
grant select, insert, update, delete on public.roles to service_role;
