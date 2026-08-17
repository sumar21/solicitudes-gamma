-- Database Webhook (trigger pg_net) sobre public.dieta_cambios y public.ayuno_cambios → Edge
-- Function notify-change. Mismo mecanismo que webhook_notify_push_traslados, versionado en SQL.
-- Payload {type, table, schema, record} = el shape que la función discrimina (usa `table` para
-- elegir DIET_CHANGE vs FASTING_CHANGE).
--
-- ⚠️ GATEADO A TESTING (WHEN new.entorno = 'TESTING'). La DB es COMPARTIDA por los dos entornos.
-- Este WHEN DEBE coincidir con la constante WEBHOOK_PUSH_ENTORNOS de api/cron-enrich-beds.ts: en los
-- entornos listados ahí el push sale del webhook y el enrich NO pushea; en el resto el enrich pushea
-- por Vercel (push-utils) y este trigger NO dispara. Son excluyentes por entorno → nunca hay doble
-- push, y como el enrich SIEMPRE inserta la fila del historial, mergear el enrich a main NO deja a
-- PRODUCTIVO sin notis (sigue pusheando por Vercel hasta habilitarlo).
-- Para habilitar PRODUCTIVO: agregar 'PRODUCTIVO' a WEBHOOK_PUSH_ENTORNOS Y reemplazar estos triggers
-- por unos SIN el WHEN, juntos.
--
-- La Edge Function se deploya con verify_jwt=false (el proyecto usa API keys nuevas sb_*, no JWTs).
-- La autorización se hace en la función con WEBHOOK_SECRET (vacío en este proyecto → sin header).
create extension if not exists pg_net;

create or replace function public.notify_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://qnxckwtssevvhnhyprcl.supabase.co/functions/v1/notify-change',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'schema', 'public',
      'record', to_jsonb(new)
    )
  );
  return new;
end;
$$;

create trigger notify_change_dieta
  after insert on public.dieta_cambios
  for each row
  when (new.entorno = 'TESTING')
  execute function public.notify_change();

create trigger notify_change_ayuno
  after insert on public.ayuno_cambios
  for each row
  when (new.entorno = 'TESTING')
  execute function public.notify_change();
