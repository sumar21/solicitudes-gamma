-- Database Webhook nativo: trigger pg_net sobre public.traslados → Edge Function notify-push.
-- Es exactamente lo que hace el "Database Webhook" del dashboard, pero versionado en SQL.
-- Payload {type, table, schema, record, old_record} = el shape que la función discrimina.
--
-- La Edge Function se deploya con verify_jwt=false PORQUE el proyecto usa las API keys nuevas
-- (sb_publishable_/sb_secret_), que NO son JWTs → el verify_jwt de la plataforma las rechazaría.
-- La autorización se hace en la función con WEBHOOK_SECRET (vacío en dev; setear en prod y agregar
-- el header 'x-webhook-secret' acá).
create extension if not exists pg_net;

create or replace function public.notify_push_traslados()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://qnxckwtssevvhnhyprcl.supabase.co/functions/v1/notify-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'type', tg_op,
      'table', 'traslados',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
    )
  );
  return new;
end;
$$;

create trigger notify_push_traslados
  after insert or update on public.traslados
  for each row execute function public.notify_push_traslados();
