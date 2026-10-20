-- "Regreso de cirugía" (EN_DEVOLUCION) deja de tomar la cama de origen (pedido del 20/10/2026).
--
-- El índice parcial cirugia_viva_uidx garantiza UNA operatoria viva por (entorno, cama_origen): el
-- candado contra el doble tap / dos dispositivos marcando "Listo para cirugía" a la vez. Incluía
-- EN_DEVOLUCION, que solo espera "Iniciar dieta" (el paciente vuelve a comer) y no tiene nada que ver
-- con que la cama esté libre. Caso real: la operatoria del paciente anterior de la 825-01 quedó en
-- "Regreso de cirugía" toda la noche y el alta del paciente nuevo rebotaba (la API devolvía ok sin crear
-- nada). Ahora el candado cubre solo los estados EN CURSO; una cama puede tener una operatoria en curso
-- y, además, operatorias en "Regreso de cirugía" esperando "Iniciar dieta".
--
-- Seguro e idempotente: el índice nuevo es MÁS estrecho que el viejo (cualquier fila que cumplía el
-- viejo cumple el nuevo), así que crearlo no puede fallar por datos existentes. Proyecto compartido
-- TESTING/PRODUCTIVO: el código (api/cirugia.ts, v20261020_1.11.2) funciona con el índice viejo y con
-- el nuevo.
drop index if exists public.cirugia_viva_uidx;
create unique index cirugia_viva_uidx
  on public.cirugia_traslados (entorno, cama_origen)
  where estado in ('LISTO_PARA_CIRUGIA','VAN_A_BUSCAR','EN_TRASLADO','EN_CIRUGIA');
