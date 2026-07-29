-- Campanita in-app (migra 10.Notificaciones de SharePoint). Una fila por USUARIO por evento.
-- El envío de push va a todos los endpoints del user, pero el registro de la campanita es único.
-- Scoping por `entorno` = la MISMA columna que usamos en traslados y push_subscriptions.
create table public.notificaciones (
  id          uuid primary key default gen_random_uuid(),
  traslado_id text,                                   -- TicketId_N (IDUnivocoTraslado, string)
  user_id     text not null,                          -- UserId_N (destinatario de la campanita)
  title       text not null,                          -- Title_N
  message     text,                                   -- Message_N
  type        text,                                   -- Type_N (NEW_TICKET, STATUS_UPDATE, RECEPTION_CONFIRMED, ROOM_CLEANED, DIET_CHANGE, FASTING_CHANGE)
  status      text not null default 'Enviada'
                check (status in ('Enviada','Leida')),-- Status_N
  leida_at    timestamptz,
  entorno     text not null default 'TESTING',        -- Entorno_N (separa PRODUCTIVO / TESTING)
  created_at  timestamptz not null default now()      -- Fecha_N
);
create index notificaciones_user_idx on public.notificaciones (user_id, entorno, created_at desc);

-- Realtime: la campanita se actualiza sola (sin poll) cuando entra una notif nueva.
alter table public.notificaciones replica identity full;
alter publication supabase_realtime add table public.notificaciones;

-- A diferencia de roles/push_subscriptions (solo service_role), la campanita SÍ la lee el cliente:
-- cada usuario ve SOLO sus notificaciones en SU entorno. Los claims vienen del pase (sub, entorno).
create policy notificaciones_select_own on public.notificaciones
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno') and user_id = (auth.jwt() ->> 'sub'));

-- Marcar como leída: el usuario solo puede tocar sus propias filas (Status → 'Leida').
create policy notificaciones_update_own on public.notificaciones
  for update to authenticated
  using (entorno = (auth.jwt() ->> 'entorno') and user_id = (auth.jwt() ->> 'sub'))
  with check (entorno = (auth.jwt() ->> 'entorno') and user_id = (auth.jwt() ->> 'sub'));

grant select, update on public.notificaciones to authenticated;
grant select, insert, update, delete on public.notificaciones to service_role;
