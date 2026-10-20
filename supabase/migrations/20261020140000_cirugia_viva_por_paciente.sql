-- Candado de cirugía POR PACIENTE, no por cama (decisión del equipo, 20/10/2026).
--
-- cirugia_viva_uidx garantizaba "una operatoria viva por (entorno, cama_origen)" — patrón copiado de
-- limpiezas/comandas. En cirugía todo lo demás ya es por paciente (la pill Cx lo sigue, la marca de
-- Admisión y el consentimiento son por paciente) y la cama solo traía problemas: el paciente se mueve y la
-- operatoria anterior trababa la cama para el siguiente (caso 825-01). Ahora: un PACIENTE no puede tener
-- dos operatorias EN CURSO. "Regreso de cirugía" (EN_DEVOLUCION) no cuenta: solo espera "Iniciar dieta".
-- Respaldo para operatorias SIN código de paciente (raro): sigue el candado por cama solo para ellas.
--
-- Reemplaza el índice de 20261020120000. Verificado antes de escribirla: ningún paciente tiene hoy dos
-- operatorias en curso, así que los índices se crean sin choques. Idempotente.
drop index if exists public.cirugia_viva_uidx;
create unique index if not exists cirugia_viva_paciente_uidx
  on public.cirugia_traslados (entorno, paciente_codigo)
  where paciente_codigo is not null and paciente_codigo <> ''
    and estado in ('LISTO_PARA_CIRUGIA','VAN_A_BUSCAR','EN_TRASLADO','EN_CIRUGIA');
create unique index if not exists cirugia_viva_sin_codigo_uidx
  on public.cirugia_traslados (entorno, cama_origen)
  where (paciente_codigo is null or paciente_codigo = '')
    and estado in ('LISTO_PARA_CIRUGIA','VAN_A_BUSCAR','EN_TRASLADO','EN_CIRUGIA');
