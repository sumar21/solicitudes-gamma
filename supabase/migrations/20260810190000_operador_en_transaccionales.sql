-- ══════════════ Columna `operador` en las tablas transaccionales ══════════════
-- Fase 2 de "identificación de operador (cuentas compartidas)". Cada tabla que registra una
-- operación suma `operador` = el nombre de la persona responsable: el operador de sesión (cuando
-- el rol requiere identificación) o el nombre de la cuenta (cuando no). Se mantienen las columnas
-- de usuario existentes (created_by / usuario / azafata_nombre / etc.) — `operador` es aditivo.
alter table public.traslados         add column if not exists operador text;
alter table public.traslado_eventos  add column if not exists operador text;
alter table public.traslado_obs      add column if not exists operador text;
alter table public.comandas          add column if not exists operador text;
alter table public.carga_menu        add column if not exists operador text;
alter table public.limpiezas         add column if not exists operador text;
alter table public.limpiezas_rutina  add column if not exists operador text;
alter table public.cirugia_traslados add column if not exists operador text;
alter table public.cirugia_eventos   add column if not exists operador text;
