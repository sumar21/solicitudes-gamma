-- Columnas nuevas para que la Edge Function (webhook) reproduzca el push SIN el contexto del
-- request de Vercel. El write-path de dominio no cambia (nullable, sin default disruptivo).
alter table public.traslados
  add column cama_origen_area  text,   -- nombre de área real del origen (hoy derivado client-side, no persistido)
  add column cama_destino_area text,   -- ídem destino → necesarios para subAreaMatches (filter_by_floors) y el "(Piso N)" de Catering
  add column last_actor_id     bigint; -- quién ejecutó el último PATCH → excludeUserId de STATUS_UPDATE/RECEPTION_CONFIRMED (NEW_TICKET usa created_by_id)

-- Idempotencia del webhook: Supabase puede reintentar el POST si la Edge Function timeoutea.
-- La key = hash(id_univoco + status + updated_at); insert ON CONFLICT DO NOTHING → si ya se
-- despachó esa versión, la función sale sin re-enviar. Candado service_role (como push_subscriptions).
create table public.push_dispatch_log (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);
grant select, insert on public.push_dispatch_log to service_role;
