-- Fase A del rediseño de cirugía: se eliminan PENDIENTE_CONSOLIDACION y CONSOLIDADO (ya no hay
-- consolidación en la app — Admisión mueve al paciente en PROGAL y el cron detecta el destino) y se
-- agrega TOLERANCIA_EVALUADA (nuevo terminal que cierra el ticket, tras la evaluación de tolerancia).
--
-- RECIBIDA pasa de terminal a INTERMEDIO (espera la evaluación de tolerancia). Por eso las viejas
-- RECIBIDA —terminal-cerradas en el flujo anterior— se migran a TOLERANCIA_EVALUADA; si no,
-- reaparecerían en la cola activa. CONSOLIDADO (cerrada) y PENDIENTE_CONSOLIDACION (a mitad de
-- consolidar) también → TOLERANCIA_EVALUADA (nuevo terminal cerrado).
--
-- Orden: soltar el CHECK primero (para poder escribir el valor nuevo), migrar, y recrearlo con el
-- set de 8 estados. El índice parcial cirugia_viva_uidx (5 estados vivos) NO se toca.
alter table public.cirugia_traslados drop constraint cirugia_traslados_estado_check;

update public.cirugia_traslados
  set estado = 'TOLERANCIA_EVALUADA',
      fecha_cierre = coalesce(fecha_cierre, updated_at, now())
  where estado in ('RECIBIDA', 'CONSOLIDADO', 'PENDIENTE_CONSOLIDACION');

alter table public.cirugia_traslados add constraint cirugia_traslados_estado_check
  check (estado = any (array[
    'LISTO_PARA_CIRUGIA','VAN_A_BUSCAR','EN_TRASLADO','EN_CIRUGIA','EN_DEVOLUCION',
    'RECIBIDA','TOLERANCIA_EVALUADA','CANCELADO'
  ]));
