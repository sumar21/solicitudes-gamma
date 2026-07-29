-- Los roles anon/authenticated no recibieron los GRANT de DML al crear las tablas (quedaron solo
-- con REFERENCES/TRIGGER/TRUNCATE) → un SELECT del rol authenticated daba 403 "permission denied
-- for table" ANTES de evaluar la RLS. Se otorga:
--  · SELECT a authenticated → las lecturas del cliente (la RLS ya restringe a su entorno).
--  · DML completo a service_role → las escrituras del backend (bypassa RLS con la secret key).
--  · anon queda SIN grants → no puede leer ni a nivel tabla (doble candado con la RLS).

grant select on public.traslados        to authenticated;
grant select on public.traslado_eventos to authenticated;
grant select on public.traslado_obs     to authenticated;

grant select, insert, update, delete on public.traslados        to service_role;
grant select, insert, update, delete on public.traslado_eventos to service_role;
grant select, insert, update, delete on public.traslado_obs     to service_role;
