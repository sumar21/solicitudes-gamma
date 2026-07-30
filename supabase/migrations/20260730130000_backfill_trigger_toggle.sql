-- Toggle del trigger de push de traslados, para que el backfill de PRODUCTIVO NO dispare una
-- tormenta de "Nueva Solicitud" a todo el hospital (el trigger notify_push_traslados es AFTER
-- INSERT/UPDATE sin condición y la Edge Function clasifica cualquier histórico como NEW_TICKET).
-- PostgREST no ejecuta DDL; esta función SECURITY DEFINER (owner = postgres) sí puede ALTER TABLE,
-- y solo la llama service_role desde scripts/backfill-traslados.mts (disable antes del upsert,
-- enable en el finally). Así el backfill es inmune al orden y a re-corridas, sin depender de que
-- push_subscriptions esté vacío.
create or replace function public.set_traslados_notify_enabled(p_enabled boolean)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if p_enabled then
    execute 'alter table public.traslados enable trigger notify_push_traslados';
  else
    execute 'alter table public.traslados disable trigger notify_push_traslados';
  end if;
end;
$$;

-- Solo el backend (service_role). NUNCA anon/authenticated (revoke a public los cubre a los dos).
revoke all on function public.set_traslados_notify_enabled(boolean) from public;
grant execute on function public.set_traslados_notify_enabled(boolean) to service_role;
