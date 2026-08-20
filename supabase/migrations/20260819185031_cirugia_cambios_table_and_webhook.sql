-- Historial append-only de movimientos de cama en PROGAL para pacientes en cirugía (detectados por
-- el enrich, dirección PROGAL→app). Cada INSERT dispara notify_change() → push al equipo de cirugía
-- (permiso notif_cirugia_cama_progal). Mismo patrón que dieta_cambios / ayuno_cambios.
--
-- NOTA: esta migración se aplicó originalmente vía MCP (apply_migration) y se versiona acá para que
-- el repo refleje el estado real de la DB (webhook de cirugía). Ver 20260817152653_webhook_notify_change.
create table if not exists public.cirugia_cambios (
  id              uuid primary key default gen_random_uuid(),
  entorno         text not null,
  cirugia_id      uuid,
  paciente_codigo text,
  paciente_nombre text,
  area            text,
  habitacion      text,
  cama_prev       text,
  cama_new        text,
  created_at      timestamptz not null default now()
);

create index if not exists cirugia_cambios_entorno_created_idx
  on public.cirugia_cambios (entorno, created_at desc);

-- Solo el service_role (cron + Edge Function) toca esta tabla; sin políticas = negado para anon/auth.
alter table public.cirugia_cambios enable row level security;

-- Webhook: reusa la función genérica notify_change() (tg_table_name + to_jsonb(new)), igual que
-- los triggers de dieta/ayuno → POST a la Edge Function notify-change (tipo CIRUGIA_MOVE).
drop trigger if exists notify_change_cirugia on public.cirugia_cambios;
create trigger notify_change_cirugia
  after insert on public.cirugia_cambios
  for each row execute function public.notify_change();
