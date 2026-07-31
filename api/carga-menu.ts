/**
 * Vercel serverless — CRUD para la planificación de menú por rango de fechas.
 * FUENTE: Supabase public.carga_menu (migrado de la lista SP 16.CargaMenu).
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
 * ⚠️ CONTRATO. El GET lo consumen DOS lugares: el modal ABM (PlanificacionMenuModal) y
 * BedsView.usePlannedMenu (autocompletado por cama). La forma {plans:[{spItemId,turno,tipo,desde,
 * hasta,comanda,by,at}]} con turno en MAYÚSCULAS y desde/hasta como 'YYYY-MM-DD' NO puede cambiar.
 *
 * REGLAS DE NEGOCIO (ver docs/plan-comandas-planificacion.md):
 *  · Sin solapamiento (P1/D8): un solo rango activo por (turno, tipo) → 409 duro (validado en JS
 *    para conservar el mensaje human-readable con conflictingId que muestra el modal).
 *  · Las vencidas no se tocan (P8): editar/eliminar exige fecha_fin >= hoy(ART).
 *  · Planificación GLOBAL (P7): la clave es (turno, tipo). Si algún día se planifica por dieta,
 *    sumar la dimensión ACÁ (findOverlaps) y no inlinear la clave en otro lado.
 *  · Tipo ∈ MENU|OPCION (D5). 'OTROS' NO es planificable.
 *
 * FECHAS. fecha_inicio/fecha_fin son columnas `date` en Postgres → PostgREST devuelve 'YYYY-MM-DD'
 * pelado, y se insertan igual. Adiós al hack T12:00:00Z / UTC-7 de SharePoint. La comparación
 * sigue siendo lexicográfica ('YYYY-MM-DD' → orden = cronológico). fecha_carga es un INSTANTE.
 */

import { requireAuth } from './jwt.js';
import { getRoleByName } from './role-cache.js';
import { getUserAreasById } from './user-cache.js';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from './supabase-admin.js';
import { MEAL_SLOTS_SP, TIPOS_PLAN_SP, COMANDA_MAX_LEN } from '../types.js';

// Entorno: separa producción y testing en la misma base. Default seguro 'TESTING'.
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const isDay = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));

/** "Hoy" en hora Argentina como 'YYYY-MM-DD'. NUNCA `toISOString().slice(0,10)` (da UTC). */
const artToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

/** `date` de Postgres (o lo que devuelva PostgREST) → 'YYYY-MM-DD' pelado. */
const asDay = (raw: unknown): string => String(raw ?? '').slice(0, 10);

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

function rowToPlan(r: any): PlanRow {
  return {
    spItemId: String(r.id),
    turno:   String(r.turno ?? '').trim().toUpperCase(),
    tipo:    String(r.tipo ?? '').trim().toUpperCase(),
    desde:   asDay(r.fecha_inicio),
    hasta:   asDay(r.fecha_fin),
    comanda: String(r.comanda ?? ''),
    by:      String(r.nombre_user_carga ?? ''),
    at:      String(r.fecha_carga ?? ''),
  };
}

/** Trae las planificaciones ACTIVAS del entorno. `null` = la DB falló (→ 502, nunca [] mentiroso). */
async function fetchActivePlans(supa: any): Promise<PlanRow[] | null> {
  const { data, error } = await supa.from('carga_menu').select('*')
    .eq('entorno', ENTORNO).eq('status', 'Activo').limit(500);
  if (error) { console.error('[api/carga-menu] Supabase GET failed:', error.message); return null; }
  return (data ?? []).map(rowToPlan);
}

/**
 * Solapamiento de rangos: [a.desde, a.hasta] ∩ [b.desde, b.hasta] ≠ ∅  ⇔  a.desde <= b.hasta && b.desde <= a.hasta.
 * Las fechas son 'YYYY-MM-DD' → el orden lexicográfico ES el cronológico, se comparan como strings.
 * Se resuelve en JS (no en SQL) para preservar el 409 human-readable con conflictingId del modal.
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
  if (comanda.length > COMANDA_MAX_LEN) return { error: `La comanda no puede superar los ${COMANDA_MAX_LEN} caracteres (tiene ${comanda.length}).` };

  return { turno, tipo, desde, hasta, comanda };
}

/** `user_id` es columna bigint nullable → un id no numérico se guarda como null (sin romper nada). */
function uidOrNull(userId: unknown): number | null {
  const n = Number(String(userId ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Permisos server-side. El repo hoy no enforcea permisos en casi ningún endpoint (la restricción
 * suele ser de UI) — acá sí, porque la planificación la consume TODA la operación: una comanda
 * mal planificada se propaga a cientos de bandejas. Se resuelve por user-id del JWT (no por lo
 * que mande el cliente) → un token viejo con permisos de más no sirve.
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
  if (!isSupabaseAdminConfigured()) return res.status(503).json({ error: 'Supabase no configurado' });

  let supa;
  try { supa = getSupabaseAdmin(); }
  catch (e: any) { console.error('[api/carga-menu]', e?.message ?? e); return res.status(503).json({ error: 'Supabase no configurado' }); }

  try {
    // ── GET — planificaciones activas ───────────────────────────────────────
    if (req.method === 'GET') {
      const perms = await userPermissions(req);
      if (!perms.includes('ver_planificacion') && !perms.includes('abm_planificacion')) {
        return res.status(403).json({ error: 'No autorizado para ver la planificación de menú.' });
      }
      const plans = await fetchActivePlans(supa);
      // Falla DURA (D10): un 200 con [] haría que la tarjeta diga "no hay comanda planificada"
      // cuando en realidad la DB se cayó — el usuario escribiría la comanda a mano sin saber que
      // existía una planificada. Mejor un error visible que un vacío mentiroso.
      if (plans === null) return res.status(502).json({ error: 'No se pudo leer la planificación.' });
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

      const plans = await fetchActivePlans(supa);
      if (plans === null) return res.status(502).json({ error: 'No se pudo validar contra la base. Reintentá.' });

      const clash = findOverlaps(plans, v.turno, v.tipo, v.desde, v.hasta);
      if (clash.length > 0) {
        const c = clash[0];
        return res.status(409).json({
          error: `Ya existe una planificación de ${v.tipo} para ${v.turno} entre ${c.desde} y ${c.hasta}. Los rangos no pueden solaparse.`,
          conflictingId: c.spItemId,
        });
      }

      const { data, error } = await supa.from('carga_menu').insert({
        entorno: ENTORNO,
        turno: v.turno,
        tipo: v.tipo,
        fecha_inicio: v.desde,
        fecha_fin: v.hasta,
        comanda: v.comanda,
        status: 'Activo',
        version: String(req.body?.version ?? ''),
        nombre_user_carga: String(req?.user?.name ?? ''),
        user_id: uidOrNull(req?.user?.id),
        fecha_carga: new Date().toISOString(),
      }).select('id').single();
      if (error) {
        console.error('[api/carga-menu] create failed:', error.message);
        return res.status(500).json({ error: 'No se pudo guardar la planificación.' });
      }
      return res.status(201).json({ ok: true, spItemId: String(data.id) });
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

      const plans = await fetchActivePlans(supa);
      if (plans === null) return res.status(502).json({ error: 'No se pudo validar contra la base. Reintentá.' });

      const current = plans.find(p => p.spItemId === spItemId);
      if (!current) return res.status(409).json({ error: 'La planificación ya no existe o fue eliminada por otro usuario.' });

      // P8 — las vencidas son histórico, read-only. Se valida ACÁ y no solo escondiendo el
      // botón: la grilla del cliente puede estar stale y mostrar como editable un rango que venció.
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

      const uid = uidOrNull(req?.user?.id);
      const { error } = await supa.from('carga_menu').update({
        turno: v.turno,
        tipo: v.tipo,
        fecha_inicio: v.desde,
        fecha_fin: v.hasta,
        comanda: v.comanda,
        nombre_user_carga: String(req?.user?.name ?? ''),
        // Solo se pisa si hay id numérico; si no, se preserva el previo (igual que `...uidField` original).
        ...(uid != null ? { user_id: uid } : {}),
        version: String(req.body?.version ?? ''),
        fecha_carga: new Date().toISOString(),
      }).eq('id', spItemId);
      if (error) {
        console.error('[api/carga-menu] update failed:', error.message);
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

      const plans = await fetchActivePlans(supa);
      if (plans === null) return res.status(502).json({ error: 'No se pudo validar contra la base. Reintentá.' });

      const current = plans.find(p => p.spItemId === spItemId);
      // Idempotente: si ya no está activa, el resultado deseado ya se cumplió.
      if (!current) return res.status(200).json({ ok: true, alreadyInactive: true });

      if (current.hasta < artToday()) {
        return res.status(409).json({ error: 'planificacion_vencida', message: 'No se puede eliminar una planificación vencida.' });
      }

      // Soft-delete (regla del repo: nunca borrar).
      const { error } = await supa.from('carga_menu').update({ status: 'Inactivo', version: String(req.body?.version ?? '') }).eq('id', spItemId);
      if (error) {
        console.error('[api/carga-menu] soft-delete failed:', error.message);
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
