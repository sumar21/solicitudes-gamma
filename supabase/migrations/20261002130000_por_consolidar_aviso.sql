-- ══════════════ AVISO "POR CONSOLIDAR" A LOS 15 MIN ══════════════
-- Un traslado queda "Por Consolidar" cuando la azafata confirma la recepción; a partir de ahí Admisión
-- tiene que consolidarlo en PROGAL. Si pasan 15 minutos sin que nadie lo haga, se avisa (push +
-- campanita) a los roles que tengan el permiso `notif_por_consolidar` en el ABM.
--
-- Cómo funciona (sin Vercel, sin envs nuevas):
--   1) Un trigger BEFORE INSERT/UPDATE estampa `por_consolidar_at` cuando el traslado ENTRA a
--      "Por Consolidar" (no depende de que el cliente escriba un evento).
--   2) `avisar_por_consolidar()` — que corre pg_cron cada minuto — marca `aviso_consolidar_at` en los
--      que llevan >= 15 min y todavía no se avisaron. Ese UPDATE dispara el webhook existente
--      (notify_push_traslados → Edge Function notify-push), que ve el cambio null → fecha y emite el
--      tipo POR_CONSOLIDAR. UNA sola vez por ingreso a "Por Consolidar".
--
-- El permiso `notif_por_consolidar` no está asignado a ningún rol hasta que se tilde en el ABM, así que
-- aplicar esta migración no genera ningún aviso por sí sola.
alter table public.traslados
  add column if not exists por_consolidar_at   timestamptz,
  add column if not exists aviso_consolidar_at timestamptz;

create or replace function public.traslados_set_por_consolidar_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.status = 'Por Consolidar'
     and (tg_op = 'INSERT' or old.status is distinct from 'Por Consolidar') then
    new.por_consolidar_at   := now();
    new.aviso_consolidar_at := null;  -- si volviera a entrar, el aviso se rearma
  end if;
  return new;
end;
$$;

drop trigger if exists traslados_set_por_consolidar_at on public.traslados;
create trigger traslados_set_por_consolidar_at
  before insert or update on public.traslados
  for each row execute function public.traslados_set_por_consolidar_at();

-- Índice parcial: la consulta del cron corre CADA MINUTO y sólo mira los pendientes de aviso.
create index if not exists traslados_por_consolidar_pend_idx
  on public.traslados (por_consolidar_at)
  where status = 'Por Consolidar' and aviso_consolidar_at is null;

create or replace function public.avisar_por_consolidar(p_minutos integer default 15)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  n integer;
begin
  update public.traslados
     set aviso_consolidar_at = now()
   where status = 'Por Consolidar'
     and por_consolidar_at is not null
     and aviso_consolidar_at is null
     and por_consolidar_at <= now() - make_interval(mins => p_minutos);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Sólo la ejecuta el cron (rol postgres). No se expone por la API REST.
revoke all on function public.avisar_por_consolidar(integer) from public, anon, authenticated;

-- Idempotente: cron.schedule con el mismo nombre reemplaza el job.
select cron.schedule(
  'traslados-aviso-por-consolidar',
  '* * * * *',
  $$select public.avisar_por_consolidar(15)$$
);
