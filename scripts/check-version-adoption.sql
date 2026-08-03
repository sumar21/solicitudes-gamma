-- ============================================================================
-- check-version-adoption.sql — ¿quién tomó el build actual? (columna `version`)
-- ----------------------------------------------------------------------------
-- Reutilizable en CADA bump de APP_VERSION (lib/version.ts). NO hay que editar
-- la versión: se auto-detecta como el último `vYYYYMMDD_*` visto en cada entorno.
-- La señal más limpia es push_subscriptions.version (solo la escribe el cliente
-- al re-suscribirse en cada mount/reload; nunca el server).
--
-- Cómo correr:
--   • Supabase SQL editor (pegá un bloque a la vez), o
--   • pedile a Claude: "corré el check de adopción de versión".
-- Zona horaria de display: America/Argentina/Buenos_Aires (UTC-3, sin DST).
-- ============================================================================


-- ============================================================================
-- BLOQUE 1 · Distribución de versiones por tabla y entorno (health check)
--   ∅ NULL   = fila anterior al feature de versionado
--   ∅ vacío  = build viejo (cliente que no manda `version`) o escritura server-side
--   vYYYYMMDD_x.y.z = build real de un cliente
-- ============================================================================
WITH v AS (
  SELECT 'traslados'          t, entorno, version ver, updated_at                       ts FROM traslados
  UNION ALL SELECT 'traslado_eventos',   entorno, version, created_at                      FROM traslado_eventos
  UNION ALL SELECT 'traslado_obs',       entorno, version, created_at                      FROM traslado_obs
  UNION ALL SELECT 'limpiezas',          entorno, version, updated_at                      FROM limpiezas
  UNION ALL SELECT 'comandas',           entorno, version, updated_at                      FROM comandas
  UNION ALL SELECT 'carga_menu',         entorno, version, updated_at                      FROM carga_menu
  UNION ALL SELECT 'push_subscriptions', entorno, version, COALESCE(last_seen_at, created_at) FROM push_subscriptions
)
SELECT
  t AS tabla, entorno,
  CASE WHEN ver IS NULL THEN '∅ NULL (pre-feature)'
       WHEN ver = ''    THEN '∅ vacío (build viejo/server)'
       ELSE ver END AS version,
  count(*) AS filas,
  to_char((min(ts) AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'MM-DD HH24:MI') AS primera_art,
  to_char((max(ts) AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'MM-DD HH24:MI') AS ultima_art
FROM v
GROUP BY t, entorno, ver
ORDER BY entorno, t, version;


-- ============================================================================
-- BLOQUE 2 · Adopción por USUARIO del último build (auto-detectado)
--   Cambiá 'PRODUCTIVO' por 'TESTING' si querés el otro entorno.
--   🟢 en versión nueva          = tiene ≥1 device con el build actual (refrescó)
--   🔴 activo sin refrescar      = operó DESPUÉS del deploy pero sin el build nuevo
--   ⚪ no visto desde el deploy   = no abrió la app desde que salió (no es build viejo)
-- ============================================================================
WITH cfg AS (SELECT 'PRODUCTIVO'::text AS entorno),
target AS (   -- último build real visto en ese entorno
  SELECT max(ps.version) AS ver
  FROM push_subscriptions ps, cfg
  WHERE ps.entorno = cfg.entorno AND ps.version ~ '^v[0-9]{8}_'
),
t0 AS (       -- primer avistaje de ese build = momento de deploy/refresh
  SELECT min(ps.last_seen_at) AS deploy_ts
  FROM push_subscriptions ps, target, cfg
  WHERE ps.entorno = cfg.entorno AND ps.version = target.ver
),
per_user AS (
  SELECT ps.user_id,
    string_agg(DISTINCT ps.user_role, ',') AS roles,
    bool_or(ps.version = (SELECT ver FROM target))       AS has_new,
    bool_or(ps.last_seen_at >= (SELECT deploy_ts FROM t0)) AS active_post
  FROM push_subscriptions ps, cfg
  WHERE ps.entorno = cfg.entorno
  GROUP BY ps.user_id
)
SELECT
  (SELECT ver FROM target) AS build_actual,
  to_char((SELECT deploy_ts FROM t0) AT TIME ZONE 'America/Argentina/Buenos_Aires','MM-DD HH24:MI') AS deploy_art,
  CASE WHEN has_new     THEN '🟢 en versión nueva'
       WHEN active_post THEN '🔴 activo sin refrescar'
       ELSE                  '⚪ no visto desde el deploy' END AS estado,
  count(*) AS usuarios,
  string_agg(DISTINCT roles, ' | ') AS roles
FROM per_user
GROUP BY has_new, active_post
ORDER BY estado;


-- ============================================================================
-- BLOQUE 3 · Detalle de los que NO tomaron el build (para empujarlos a abrir)
--   Cambiá 'PRODUCTIVO' por 'TESTING' si aplica.
-- ============================================================================
SELECT user_role,
  count(DISTINCT user_id) AS usuarios,
  to_char(max(last_seen_at) AT TIME ZONE 'America/Argentina/Buenos_Aires','MM-DD HH24:MI') AS ult_visto_art
FROM push_subscriptions
WHERE entorno = 'PRODUCTIVO'
  AND user_id NOT IN (
    SELECT user_id FROM push_subscriptions
    WHERE entorno = 'PRODUCTIVO' AND version ~ '^v[0-9]{8}_'
  )
GROUP BY user_role
ORDER BY max(last_seen_at) DESC NULLS LAST;
