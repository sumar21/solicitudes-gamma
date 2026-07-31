-- ============== VERSIONADO DE CLIENTES ==============
-- Estampa APP_VERSION del build del cliente en cada escritura transaccional para detectar quién
-- corre código viejo (build cacheado / no recargó el deploy). Columna nullable SIN default →
-- filas viejas y escrituras server-side quedan NULL/'' = legacy/desconocido. Agregar columna
-- nullable NO toca RLS ni grants (los GRANT son a nivel tabla) ni Realtime (replica identity full).
alter table public.traslados          add column version text;
alter table public.traslado_eventos   add column version text;
alter table public.traslado_obs       add column version text;
alter table public.limpiezas          add column version text;
alter table public.comandas           add column version text;
alter table public.carga_menu         add column version text;
alter table public.push_subscriptions add column version text;
