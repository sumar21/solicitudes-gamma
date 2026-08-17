-- Índice para el filtro por RANGO del Historial/Monitor.
--
-- El fetch server-side por rango (api/tickets.ts ?all=1&from&to) hace:
--   WHERE entorno = X AND created_at BETWEEN A AND B ORDER BY created_at DESC
-- Antes no había índice por created_at (solo entorno+status / entorno+completed_at /
-- entorno+codigo_paciente), así que el rango iba por seq scan + sort. Con este índice el
-- planner resuelve el rango por Index Scan (verificado por EXPLAIN) y ordena presortido por
-- created_at (Incremental Sort para el tiebreaker id_univoco).
--
-- Beneficia también al código anterior, que ya ordenaba por created_at. La tabla es compartida
-- TESTING/PRODUCTIVO por la columna entorno → el índice la lleva de prefijo.
CREATE INDEX IF NOT EXISTS traslados_entorno_created_idx
  ON public.traslados (entorno, created_at DESC);
