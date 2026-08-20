-- Fase B: cada transición de cirugía (fila append-only en cirugia_eventos) dispara notify-change,
-- que mapea el `tipo` (estado alcanzado) → notificación configurable por rol. Reusa la función
-- genérica notify_change() (tg_table_name + to_jsonb(new)), igual que dieta/ayuno/cirugia_cambios.
--
-- NOTA: se aplicó originalmente vía MCP (apply_migration) y se versiona acá para sincronizar el repo
-- con la DB. cirugia_eventos ya existía (ver 20260810134648_cirugia_en_traslado_y_eventos); acá solo
-- se agrega el trigger del webhook.
drop trigger if exists notify_change_cirugia_eventos on public.cirugia_eventos;
create trigger notify_change_cirugia_eventos
  after insert on public.cirugia_eventos
  for each row execute function public.notify_change();
