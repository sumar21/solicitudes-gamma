/**
 * Vercel serverless — CRUD para "16.CargaMenu" (planificación de menú por rango de fechas).
 *
 * GET    /api/carga-menu   → planificaciones activas  { plans: CargaMenu[] }
 * POST   /api/carga-menu   → crear      { turno, tipo, desde, hasta, comanda }
 * PATCH  /api/carga-menu   → editar     { spItemId, turno, tipo, desde, hasta, comanda }
 * DELETE /api/carga-menu   → soft-delete { spItemId }
 *
 * MODELO. Una planificación dice: "del {desde} al {hasta}, en el {turno}, el {tipo} es {comanda}".
 * Es la PLANTILLA que autocompleta la carga por paciente de 15.CargaComandas. La relación es
 * plantilla → instancia y la copia es POR VALOR: al cargar la comanda de un paciente se copia el
 * texto (editable). Editar la planificación NO reescribe retroactivamente lo ya cargado.
 *
 * REGLAS DE NEGOCIO (definidas por el usuario, ver docs/plan-comandas-planificacion.md):
 *  · Sin solapamiento (P1/D8): un solo rango activo por (turno, tipo) → 409 duro. No existe el
 *    caso "excepción dentro de un rango".
 *  · Las vencidas no se tocan (P8): editar/eliminar exige FechaFin_CM >= hoy(ART).
 *  · Planificación GLOBAL (P7): ni por sede, ni por piso, ni por dieta. La clave es (turno, tipo).
 *    Si algún día se planifica por dieta, sumar la dimensión ACÁ (findOverlaps + planKey) y no
 *    inlinear la clave en otro lado.
 *  · Tipo_CM ∈ MENU|OPCION (D5). 'OTROS' NO es planificable: es texto libre caso por caso.
 *
 * FECHAS — leer docs/plan-comandas-planificacion.md D2 antes de tocar:
 *  · FechaInicio_CM / FechaFin_CM son `dateOnly`: fechas CALENDARIAS, no instantes.
 *  · Se escriben como `${dia}T12:00:00Z` (mediodía UTC) y se leen con `.slice(0,10)`.
 *  · NUNCA `T00:00:00Z`: el site de SP está en UTC-7 (medido) → la UI mostraría el día anterior,
 *    aunque el round-trip por Graph dé bien. NUNCA un offset local (`-03:00`): corre el día.
 *  · NUNCA `artDay()`/`new Date()` sobre estas columnas — es correcto para instantes
 *    (FechaCarga_CM) e incorrecto para fechas calendarias.
 */

import { graphFetch }  from './graph.js';
import { requireAuth } from './jwt.js';
import { getRoleByName } from './role-cache.js';
import { getUserAreasById } from './user-cache.js';
import { MEAL_SLOTS_SP, TIPOS_PLAN_SP, COMANDA_MAX_LEN } from '../types.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = (process.env.CARGA_MENU_LIST_ID ?? 'f6720c30-aecb-4e7e-ad50-2ba108498bd3').trim(); // 16.CargaMenu

// Entorno: separa producción y testing en la misma lista. Default seguro 'TESTING'.
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const esc = (s: unknown) => String(s ?? '').replace(/'/g, "''");
const PREFER = { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as const;

const isDay = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));

/** "Hoy" en hora Argentina como 'YYYY-MM-DD'. NUNCA `toISOString().slice(0,10)` (da UTC). */
const artToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

/** Fecha calendaria → valor a escribir en una columna dateOnly. Ver D2. */
const toSpDay = (day: string): string => `${day}T12:00:00Z`;

/** Columna dateOnly → fecha calendaria. Ver D2: por string, nunca por `new Date`. */
const fromSpDay = (raw: unknown): string => String(raw ?? '').slice(0, 10);

/**
 * `UserID_CM` es columna **Número**: un string vacío hace fallar el request ENTERO con un
 * 400 opaco que no dice qué campo fue. Solo se manda si es un número finito.
 */
function uidField(userId: unknown): Record<string, unknown> {
  const n = Number(String(userId ?? '').trim());
  return Number.isFinite(n) && n > 0 ? { UserID_CM: n } : {};
}

interface PlanRow {
  spItemId: string;
  turno: string;
  tipo: string;
  desde: string;
  hasta: string;
  comanda: string;
  by: string;
  at: string;
}

function spToPlan(item: any): PlanRow {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  return {
    spItemId: String(item.id),
    turno:   String(f.Turno_CM ?? '').trim().toUpperCase(),
    tipo:    String(f.Tipo_CM ?? '').trim().toUpperCase(),
    desde:   fromSpDay(f.FechaInicio_CM),
    hasta:   fromSpDay(f.FechaFin_CM),
    comanda: String(f.Comanda_CM ?? ''),
    by:      String(f.NombreUserCarga_CM ?? ''),
    at:      String(f.FechaCarga_CM ?? ''),
  };
}

/** Trae las planificaciones ACTIVAS del entorno. Filtro por columnas indexadas. */
async function fetchActivePlans(basePath: string): Promise<PlanRow[] | null> {
  const filter = encodeURIComponent(`fields/Status_CM eq 'Activo' and fields/Entorno_CM eq '${esc(ENTORNO)}'`);
  const r = await graphFetch(`${basePath}?$expand=fields&$filter=${filter}&$top=500`, { headers: PREFER });
  if (!r.ok) { console.error('[api/carga-menu] SP GET failed:', r.status); return null; }
  const data = (await r.json()) as { value: any[] };
  return (data.value ?? []).map(spToPlan);
}

/**
 * Solapamiento de rangos: [a.desde, a.hasta] ∩ [b.desde, b.hasta] ≠ ∅  ⇔  a.desde <= b.hasta && b.desde <= a.hasta.
 * Las fechas son 'YYYY-MM-DD' → el orden lexicográfico ES el cronológico, se comparan como strings.
 * Se resuelve en JS y no con $filter OData: SP no compara rangos de DateTime de forma confiable
 * (regla del repo — ver api/dietas.ts:89-92 y api/limpiezas.ts:53-56).
 */
function findOverlaps(plans: PlanRow[], turno: string, tipo: string, desde: string, hasta: string, excludeId?: string): PlanRow[] {
  return plans.filter(p =>
    p.spItemId !== excludeId &&
    p.turno === turno &&
    p.tipo === tipo &&
    desde <= p.hasta &&
    p.desde <= hasta
  );
}

/** Valida el payload de alta/edición. Devuelve el error o los valores normalizados. */
function validate(body: any): { error: string } | { turno: string; tipo: string; desde: string; hasta: string; comanda: string } {
  const turno = String(body?.turno ?? '').trim().toUpperCase();
  const tipo  = String(body?.tipo ?? '').trim().toUpperCase();
  const desde = String(body?.desde ?? '').trim();
  const hasta = String(body?.hasta ?? '').trim();
  const comanda = String(body?.comanda ?? '').trim();

  if (!MEAL_SLOTS_SP.includes(turno)) return { error: `turno inválido — debe ser uno de: ${MEAL_SLOTS_SP.join(', ')}` };
  if (!TIPOS_PLAN_SP.includes(tipo))  return { error: `tipo inválido — debe ser uno de: ${TIPOS_PLAN_SP.join(', ')}` };
  if (!isDay(desde)) return { error: 'desde inválido — formato YYYY-MM-DD' };
  if (!isDay(hasta)) return { error: 'hasta inválido — formato YYYY-MM-DD' };
  if (hasta < desde) return { error: 'La fecha hasta no puede ser anterior a la fecha desde.' };
  if (!comanda) return { error: 'La comanda es obligatoria.' };
  // El tope no es cosmético: SP RECHAZA >255 con un 400 opaco (verificado), no trunca.
  if (comanda.length > COMANDA_MAX_LEN) return { error: `La comanda no puede superar los ${COMANDA_MAX_LEN} caracteres (tiene ${comanda.length}).` };

  return { turno, tipo, desde, hasta, comanda };
}

/**
 * Permisos server-side. El repo hoy no enforcea permisos en ningún endpoint (la restricción
 * siempre fue de UI) — acá sí, porque la planificación la consume TODA la operación: una
 * comanda mal planificada se propaga a cientos de bandejas.
 * Se resuelve por user-id del JWT (no por lo que mande el cliente) → un token viejo con
 * permisos de más no sirve: manda lo que dice SP hoy.
 */
async function userPermissions(req: any): Promise<string[]> {
  const userId = String(req?.user?.id ?? '');
  if (!userId) return [];
  const ua = await getUserAreasById(userId);
  const role = ua?.perfil ? await getRoleByName(ua.perfil) : null;
  return role?.permissions ?? [];
}

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });
  if (!LIST_ID) return res.status(503).json({ error: 'CARGA_MENU_LIST_ID not configured' });

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

  try {
    // ── GET — planificaciones activas ───────────────────────────────────────
    if (req.method === 'GET') {
      const perms = await userPermissions(req);
      if (!perms.includes('ver_planificacion') && !perms.includes('abm_planificacion')) {
        return res.status(403).json({ error: 'No autorizado para ver la planificación de menú.' });
      }
      const plans = await fetchActivePlans(basePath);
      // Falla DURA (D10): un 200 con [] haría que la tarjeta diga "no hay comanda planificada"
      // cuando en realidad SP se cayó — el usuario escribiría la comanda a mano sin saber que
      // existía una planificada. Mejor un error visible que un vacío mentiroso.
      if (plans === null) return res.status(502).json({ error: 'No se pudo leer la planificación desde SharePoint.' });
      // Orden: turno cronológico, luego desde. El front igual reordena; esto es para la API.
      plans.sort((a, b) =>
        MEAL_SLOTS_SP.indexOf(a.turno) - MEAL_SLOTS_SP.indexOf(b.turno) ||
        a.desde.localeCompare(b.desde));
      return res.status(200).json({ plans });
    }

    // ── POST — crear ────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const perms = await userPermissions(req);
      if (!perms.includes('abm_planificacion')) {
        return res.status(403).json({ error: 'No autorizado para crear planificaciones.' });
      }

      const v = validate(req.body);
      if ('error' in v) return res.status(400).json({ error: v.error });

      const plans = await fetchActivePlans(basePath);
      if (plans === null) return res.status(502).json({ error: 'No se pudo validar contra SharePoint. Reintentá.' });

      const clash = findOverlaps(plans, v.turno, v.tipo, v.desde, v.hasta);
      if (clash.length > 0) {
        const c = clash[0];
        return res.status(409).json({
          error: `Ya existe una planificación de ${v.tipo} para ${v.turno} entre ${c.desde} y ${c.hasta}. Los rangos no pueden solaparse.`,
          conflictingId: c.spItemId,
        });
      }

      const fields = {
        Title: '[sumar]',
        Turno_CM: v.turno,
        Tipo_CM: v.tipo,
        FechaInicio_CM: toSpDay(v.desde),
        FechaFin_CM: toSpDay(v.hasta),
        Comanda_CM: v.comanda,
        Status_CM: 'Activo',
        Entorno_CM: ENTORNO,
        NombreUserCarga_CM: String(req?.user?.name ?? ''),
        FechaCarga_CM: new Date().toISOString(),
        ...uidField(req?.user?.id),
      };
      const spRes = await graphFetch(basePath, { method: 'POST', body: JSON.stringify({ fields }) });
      if (!spRes.ok) {
        const t = await spRes.text();
        console.error('[api/carga-menu] SP create failed:', spRes.status, t.slice(0, 300));
        return res.status(500).json({ error: 'No se pudo guardar la planificación.' });
      }
      const created = (await spRes.json()) as { id: string };
      return res.status(201).json({ ok: true, spItemId: String(created.id) });
    }

    // ── PATCH — editar ──────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const perms = await userPermissions(req);
      if (!perms.includes('abm_planificacion')) {
        return res.status(403).json({ error: 'No autorizado para editar planificaciones.' });
      }

      const spItemId = String(req.body?.spItemId ?? '').trim();
      if (!spItemId) return res.status(400).json({ error: 'spItemId required' });

      const v = validate(req.body);
      if ('error' in v) return res.status(400).json({ error: v.error });

      const plans = await fetchActivePlans(basePath);
      if (plans === null) return res.status(502).json({ error: 'No se pudo validar contra SharePoint. Reintentá.' });

      const current = plans.find(p => p.spItemId === spItemId);
      if (!current) return res.status(409).json({ error: 'La planificación ya no existe o fue eliminada por otro usuario.' });

      // P8 — las vencidas son histórico, read-only. Se valida ACÁ y no solo escondiendo el
      // botón: la grilla del cliente puede estar hasta 5 min stale y mostrar como editable
      // un rango que venció anoche.
      if (current.hasta < artToday()) {
        return res.status(409).json({ error: 'planificacion_vencida', message: 'No se puede editar una planificación vencida.' });
      }

      const clash = findOverlaps(plans, v.turno, v.tipo, v.desde, v.hasta, spItemId);
      if (clash.length > 0) {
        const c = clash[0];
        return res.status(409).json({
          error: `Ya existe una planificación de ${v.tipo} para ${v.turno} entre ${c.desde} y ${c.hasta}. Los rangos no pueden solaparse.`,
          conflictingId: c.spItemId,
        });
      }

      const fields = {
        Turno_CM: v.turno,
        Tipo_CM: v.tipo,
        FechaInicio_CM: toSpDay(v.desde),
        FechaFin_CM: toSpDay(v.hasta),
        Comanda_CM: v.comanda,
        NombreUserCarga_CM: String(req?.user?.name ?? ''),
        FechaCarga_CM: new Date().toISOString(),
        ...uidField(req?.user?.id),
      };
      const spRes = await graphFetch(`${basePath}/${spItemId}/fields`, { method: 'PATCH', body: JSON.stringify(fields) });
      if (!spRes.ok) {
        const t = await spRes.text();
        console.error('[api/carga-menu] SP update failed:', spRes.status, t.slice(0, 300));
        return res.status(500).json({ error: 'No se pudo actualizar la planificación.' });
      }
      return res.status(200).json({ ok: true, spItemId });
    }

    // ── DELETE — soft-delete ────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const perms = await userPermissions(req);
      if (!perms.includes('abm_planificacion')) {
        return res.status(403).json({ error: 'No autorizado para eliminar planificaciones.' });
      }

      const spItemId = String(req.body?.spItemId ?? '').trim();
      if (!spItemId) return res.status(400).json({ error: 'spItemId required' });

      const plans = await fetchActivePlans(basePath);
      if (plans === null) return res.status(502).json({ error: 'No se pudo validar contra SharePoint. Reintentá.' });

      const current = plans.find(p => p.spItemId === spItemId);
      // Idempotente: si ya no está activa, el resultado deseado ya se cumplió.
      if (!current) return res.status(200).json({ ok: true, alreadyInactive: true });

      if (current.hasta < artToday()) {
        return res.status(409).json({ error: 'planificacion_vencida', message: 'No se puede eliminar una planificación vencida.' });
      }

      // Soft-delete (regla del repo: nunca borrar de SP).
      const spRes = await graphFetch(`${basePath}/${spItemId}/fields`, {
        method: 'PATCH',
        body: JSON.stringify({ Status_CM: 'Inactivo' }),
      });
      if (!spRes.ok) {
        console.error('[api/carga-menu] SP soft-delete failed:', spRes.status);
        return res.status(500).json({ error: 'No se pudo eliminar la planificación.' });
      }
      return res.status(200).json({ ok: true, spItemId });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[api/carga-menu]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
