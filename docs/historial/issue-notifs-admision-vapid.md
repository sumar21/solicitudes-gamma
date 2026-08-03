# Issue — Admisión no recibe push (traslados ni limpieza) tras el cutover

**Estado:** ✅ **RESUELTO — device-side.** Confirmado por la usuaria: en su **celular SÍ le llegan**, en su **PC no** → las notificaciones **no están activadas en la PC** (permiso del SO/navegador). NO es del backend (la hipótesis VAPID/403 quedó descartada por los logs de Vercel).
**Fecha reporte:** 2026-07-31 (Julieta, Admisión, vía WhatsApp: "no le llegan los mensajes, de traslados ni de limpieza").
**Entorno:** PRODUCTIVO.

## Síntoma
Usuarios de **Admisión** dejaron de recibir el **push nativo** (banner en el teléfono) — de traslados Y de limpieza. La **campanita in-app sí** aparece. Otros roles reciben normal.

## ✅ CORRECCIÓN (2026-07-31, tras revisar los logs de Vercel)
La hipótesis de VAPID/403 (abajo) quedó **DESCARTADA**. Un export de logs de Vercel (push-utils, ventana 03:45–15:38) muestra:
- **Cero `Push failed`.** Ni un solo fallo de envío.
- **Todos `Push complete: X/X delivered`** — el push service (FCM) **aceptó el 100%** de los envíos, incluidas las subs backfilleadas de Admisión (user 61, 54).
- Admisión aparece **✓ relevant** (user 61 ✓ 20×, 54 ✓ 7×, etc.) → el sistema la apunta bien.
- **0 subs removidas** (no hay 404/410).

**Conclusión:** el backend entrega perfecto (201). El problema está **río abajo, en el dispositivo**: el push llega a FCM pero el SO/navegador no muestra el banner. Causas probables (mismo patrón que el caso previo *"no llegan las de Chrome a desktop"* = macOS bloqueaba Chrome a nivel Sistema):
1. **Permiso de notificaciones a nivel SO/navegador** apagado en el device de Julieta (la campanita in-app igual aparece → confirma que la app anda; solo el banner nativo está suprimido).
2. **Optimización de batería / No molestar** (Android).
3. **Cuenta genérica** (user 61 "RECEPCIÓN, INFORMES" tiene 3 dispositivos): el push va a los 3 y puede caer en uno que nadie mira.

**Qué chequear con Julieta:** config de notificaciones del SO para Chrome/PWA · PWA instalada + device correcto · No molestar/batería · permiso del sitio (candadito) en "permitir".

**El fix self-heal (403-delete + re-sub en mount) NO resuelve esto** (arregla un 403 que no ocurre). Es buena higiene igual, pero no desplegarlo *como solución a este issue*.

---

## Hipótesis inicial — DESCARTADA (se deja para registro)
Las suscripciones push que se **backfillearon de SharePoint** al cutover (2026-07-30 ~18:16) fueron creadas por la app vieja con un **`applicationServerKey` (VAPID) distinto** al que usa el sender actual. El push service (FCM) las rechaza con **403 Forbidden**.

Dos cosas lo vuelven silencioso y transversal:
1. **Transversal:** el 403 es a nivel VAPID → rompe **todos** los caminos de push por igual: traslados (Edge Function `notify-push`) y limpieza/dietas (Vercel `push-utils`). Por eso "ni traslados ni limpieza".
2. **Silencioso:** el sender solo **borra** subs en 404/410, **no en 403** (`api/push-utils.ts` y `supabase/functions/notify-push/index.ts`) → la sub queda viva pero nunca entrega. Y la **campanita** se escribe igual (insert a `notificaciones`, independiente del envío), enmascarando la falla.

Los usuarios que **re-loguearon** en el prod nuevo tienen una sub fresca con el VAPID actual → reciben bien. Los que no, siguen rotos. No es por rol: es por **quién re-suscribió**.

## Evidencia (Supabase `public.push_subscriptions`, PRODUCTIVO, rol Admision)
- **Rotas (VAPID viejo, `created_at` = 07-30 18:16 = backfill):** user_id 61 (x3), 54, 90 (x2), 52 → 403 probable, no reciben.
- **OK (re-suscritas post-cutover):** user_id 48 (07-31 13:36), 58 (07-31 15:21) → VAPID actual, reciben.
- La campanita ROOM_CLEANED de Admisión SÍ existe (38 filas recientes) → confirma que la relevancia/targeting funciona; lo que falla es la entrega nativa.

### Alcance (2026-07-31) — NO es solo Admisión
Contando usuarios ACTIVOS (last_seen ≤36h) todavía con sub backfilleada:
- **21 usuarios activos ROTOS** (35 subs) across **7 roles** → no reciben push nativo.
- **3 usuarios OK** (re-suscritos post-cutover).
- Conclusión: **solo 3 de 24 se auto-arreglaron re-logueando** → el camino manual NO escala. Se necesita el fix desplegado.

## Fix (escrito, en el working tree, SIN commitear) — self-healing en 3 piezas
1. **`lib/pushSubscription.ts`** — `subscribeToPush` compara la `applicationServerKey` de la sub existente del browser contra el VAPID actual; si no matchea, la **desuscribe y regenera** (antes re-posteaba la vieja → 403 eterno).
2. **`hooks/useHospitalState.ts`** — `useEffect` en el **mount** que re-suscribe en cada apertura/F5 (no solo en el login) + heartbeat de `last_seen`. Sin esto, con tokens de ~10 años, una sub rota no se regeneraba nunca.
3. **`api/push-utils.ts` + `supabase/functions/notify-push/index.ts`** — agregar **403** al branch que borra la sub (antes solo 404/410), para que se auto-limpie.

**Cómo cura:** al desplegar, cuando el usuario abre la app (pieza 2), `subscribeToPush` detecta el VAPID viejo y **regenera la sub** con el actual (pieza 1) → empieza a recibir, sin pedirle que deslogee. El 403-delete (pieza 3) limpia las filas muertas.

> La cura efectiva la dan las piezas **1 + 2 (cliente)**: regeneran la sub en la próxima apertura. La pieza 3 (server) es limpieza. El redeploy de la Edge Function `notify-push` sube además su versión limpia (diferido del cutover).

## Remediación interina (mientras no se despliega el fix)
- **Logout + login** en el prod nuevo regenera la sub con el VAPID actual (el logout desuscribe la vieja, el login crea la fresca). Es lo único que funciona con el código actualmente desplegado. Solo 2 de ~5 usuarios de Admisión lo hicieron.
- ⚠️ **Borrar la fila en la base NO alcanza** con el código actual: el browser sigue con la sub vieja y el código desplegado no re-suscribe en el mount (solo en login) → quedaría sin sub. La regeneración la habilita la pieza 2 del fix.

## Recomendación
Desplegar el fix (piezas 1–3) a prod. Es la solución robusta y se auto-cura para todos (no solo Admisión: cualquier sub backfilleada con VAPID viejo). Ver [migracion-supabase-estado] en memoria.
