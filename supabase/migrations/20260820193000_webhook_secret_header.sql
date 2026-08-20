-- Cierra el endpoint PÚBLICO de las Edge Functions notify-change / notify-push (verify_jwt=false):
-- ahora los triggers PG mandan el header `x-webhook-secret` y las funciones exigen que coincida con
-- el secret WEBHOOK_SECRET. Sin este header, un POST arbitrario a la URL de la función devuelve 401.
--
-- El VALOR del secret NO va en git: vive en public.webhook_config (fila 'webhook_secret', seteada
-- FUERA de esta migración) y se setea igual como secret de Edge Function:
--     insert into public.webhook_config(key,value) values ('webhook_secret', '<valor>')
--       on conflict (key) do update set value = excluded.value;
--     supabase secrets set WEBHOOK_SECRET=<valor>   (mismo valor; secret por-proyecto, aplica a ambas funciones)
--
-- La tabla lleva RLS SIN policies → no es legible por la API (anon/authenticated); las funciones
-- (SECURITY DEFINER, owner postgres) la leen igual (bypassan RLS). Rotación: cambiar el valor en la
-- tabla y en el secret de la función, juntos.

create table if not exists public.webhook_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.webhook_config enable row level security;

create or replace function public.notify_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform net.http_post(
    url := 'https://qnxckwtssevvhnhyprcl.supabase.co/functions/v1/notify-change',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select value from public.webhook_config where key = 'webhook_secret')
    ),
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'schema', 'public',
      'record', to_jsonb(new)
    )
  );
  return new;
end;
$function$;

create or replace function public.notify_push_traslados()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform net.http_post(
    url := 'https://qnxckwtssevvhnhyprcl.supabase.co/functions/v1/notify-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select value from public.webhook_config where key = 'webhook_secret')
    ),
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
$function$;
