-- public.cirugia_cambios no tenía GRANT para service_role (sí lo tienen dieta_cambios/ayuno_cambios), así
-- que el cron (cron-enrich-beds, service_role) no podía insertar el cambio de cama de un paciente con
-- cirugía abierta → ni push CIRUGIA_MOVE ni cama_destino (verificado el 20/10/2026: la tabla da 403 con la
-- service key). Se iguala al patrón de las otras tablas de cambios. Idempotente.
grant select, insert, update, delete on public.cirugia_cambios to service_role;
