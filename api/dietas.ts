/**
 * Vercel serverless — CRUD para "15.CargasDieta" (cargas de menú por Nutrición).
 *
 * GET   /api/dietas  → cargas activas (Status_D='Activo'). El front las agrupa por cama+comida.
 * POST  /api/dietas  → cargar/actualizar menú (upsert por cama+comida)
 *                      { bedLabel, bedCode, roomCode, area, patientName, patientCode,
 *                        comida ∈ ALMUERZO|CENA, tipo ∈ MENU|OPCION, observaciones,
 *                        userId, userName }
 * PATCH /api/dietas  → quitar una carga (soft-delete) { spItemId | (bedLabel + comida) }
 *
 * Modelo (calca 14.Limpiezas): una fila activa por (cama, comida, entorno). Menú y Opción
 * son excluyentes → se guarda uno en Tipo_D. Nutrición carga; catering + nutrición leen
 * (cualquiera con el Mapa de Camas). El front solo muestra la carga si el paciente cargado
 * coincide con el actual de la cama (evita dietas fantasma tras reasignar la cama).
 *
 * Setup: correr scripts/create-dietas-list.mts y setear DIETAS_LIST_ID (o hardcodear acá).
 */
import { graphFetch }  from './graph.js';
import { requireAuth } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = (process.env.DIETAS_LIST_ID ?? '891ddeb5-3610-4a25-b6c0-512eb8e1648b').trim(); // 15.CargaComandas (hardcodeado como limpiezas)

const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();

const esc = (s: unknown) => String(s ?? '').replace(/'/g, "''");
const COMIDAS = ['ALMUERZO', 'CENA'];
const TIPOS   = ['MENU', 'OPCION', 'OTROS'];

// Día calendario en hora Argentina (ART, UTC-3). Las comandas se planifican día a día:
// el GET devuelve sólo las de hoy, así la de ayer no queda visible. 'en-CA' → 'YYYY-MM-DD'.
const ART_TZ = 'America/Argentina/Buenos_Aires';
const artDay = (iso: unknown): string => {
  const d = new Date(String(iso));
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: ART_TZ });
};

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });
  if (!LIST_ID) {
    // La lista todavía no se aprovisionó: el front trata esto como "sin cargas".
    if (req.method === 'GET') return res.status(200).json({ meals: [] });
    return res.status(503).json({ error: 'DIETAS_LIST_ID not configured — run scripts/create-dietas-list.mts' });
  }

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

  // ── GET histórico — comandas cargadas en un rango de fechas (FechaCarga_D) ──
  if (req.method === 'GET' && String(req.query?.history ?? '') === '1') {
    const from = String(req.query?.from ?? '');
    const to   = String(req.query?.to ?? '');
    try {
      const filter = encodeURIComponent(`fields/Entorno_D eq '${ENTORNO}'`);
      // Paginamos siguiendo @odata.nextLink (el $top es tamaño de página, NO tope) para no
      // cortar las filas más nuevas cuando la lista crece. Sin $orderby (OData sobre DateTime
      // no-indexado es frágil): filtramos por día ART en JS abajo. MAX 20k = backstop.
      const rows: Record<string, unknown>[] = [];
      let next: string | null = `${basePath}?$expand=fields&$filter=${filter}&$top=500`;
      while (next && rows.length < 20000) {
        const page = await graphFetch(next, { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
        if (!page.ok) { console.error('[dietas] GET history failed:', page.status); break; }
        const pageData = (await page.json()) as { value?: Record<string, unknown>[]; '@odata.nextLink'?: string };
        for (const it of pageData.value ?? []) rows.push(it);
        const raw = pageData['@odata.nextLink'];
        next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
      }
      const all = rows.map((item: any) => {
        const f = item.fields as Record<string, unknown>;
        return {
          spItemId:      String(item.id),
          bedLabel:      String(f.CamaLabel_D ?? ''),
          area:          String(f.Area_D ?? ''),
          patientName:   String(f.PacienteNombre_D ?? ''),
          patientCode:   String(f.PacienteCodigo_D ?? ''),
          comida:        String(f.Comida_D ?? ''),
          tipo:          String(f.Tipo_D ?? ''),
          detalle:       String(f.Detalle_D ?? ''),
          observaciones: String(f.Observaciones_D ?? ''),
          by:            String(f.NutricionistaNombre_D ?? ''),
          at:            String(f.FechaCarga_D ?? ''),
          status:        String(f.Status_D ?? ''),
        };
      });
      // Filtro por DÍA ART de FechaCarga en JS (el filtro OData sobre DateTime es frágil).
      const inRange = all
        .filter((m) => { const day = artDay(m.at); return day && (!from || day >= from) && (!to || day <= to); })
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return res.status(200).json({ meals: inRange });
    } catch (err: any) {
      console.error('[dietas] GET history error:', err);
      return res.status(200).json({ meals: [] });
    }
  }

  // ── GET — comandas de HOY (ART) ───────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const filter = encodeURIComponent(`fields/Status_D eq 'Activo' and fields/Entorno_D eq '${ENTORNO}'`);
      const spRes = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=1000`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (!spRes.ok) { console.error('[dietas] GET failed:', spRes.status); return res.status(200).json({ meals: [] }); }
      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const meals = (data.value ?? []).map((item: any) => {
        const f = item.fields as Record<string, unknown>;
        return {
          spItemId:      String(item.id),
          bedLabel:      String(f.CamaLabel_D ?? ''),
          bedCode:       String(f.CamaCodigo_D ?? ''),
          roomCode:      String(f.Habitacion_D ?? ''),
          area:          String(f.Area_D ?? ''),
          patientName:   String(f.PacienteNombre_D ?? ''),
          patientCode:   String(f.PacienteCodigo_D ?? ''),
          comida:        String(f.Comida_D ?? ''),
          tipo:          String(f.Tipo_D ?? ''),
          detalle:       String(f.Detalle_D ?? ''),
          observaciones: String(f.Observaciones_D ?? ''),
          by:            String(f.NutricionistaNombre_D ?? ''),
          byId:          String(f.NutricionistaID_D ?? ''),
          at:            String(f.FechaCarga_D ?? ''),
        };
      });
      // Sólo las cargadas HOY (ART): la de ayer no se muestra hasta que carguen la de hoy.
      // Filtramos en JS a propósito (el filtro OData sobre DateTime es frágil).
      const todayArt = artDay(new Date().toISOString());
      const todays = meals.filter((m) => artDay(m.at) === todayArt);
      return res.status(200).json({ meals: todays });
    } catch (err: any) {
      console.error('[dietas] GET error:', err);
      return res.status(200).json({ meals: [] });
    }
  }

  // ── POST — cargar/actualizar menú (upsert por cama + comida + entorno) ─────
  if (req.method === 'POST') {
    const { bedLabel, bedCode, roomCode, area, patientName, patientCode,
            comida, tipo, detalle, observaciones, userId, userName } = req.body ?? {};
    if (!bedLabel) return res.status(400).json({ error: 'bedLabel is required' });
    const comidaVal = COMIDAS.includes(String(comida)) ? String(comida) : '';
    const tipoVal   = TIPOS.includes(String(tipo))     ? String(tipo)   : '';
    if (!comidaVal) return res.status(400).json({ error: 'comida must be ALMUERZO or CENA' });
    if (!tipoVal)   return res.status(400).json({ error: 'tipo must be MENU, OPCION or OTROS' });
    const nowIso = new Date().toISOString();
    const obs = String(observaciones ?? '').slice(0, 500);
    const det = String(detalle ?? '').slice(0, 500);
    // Backstop server-side de la regla de la UI: una comanda "Otros" (dieta terapéutica) sin la
    // comida escrita no tiene sentido. La tarjeta ya lo bloquea; esto respalda cualquier caller.
    if (tipoVal === 'OTROS' && det.trim() === '') return res.status(400).json({ error: 'detalle is required for tipo OTROS' });
    // NutricionistaID_D es columna Número en SP (nombre interno con ID mayúscula). El user.id
    // es el item-id de SP (numérico), así que lo escribimos como número; si no es numérico
    // (edge), omitimos el campo para no romper el POST (una columna Número rechaza strings).
    const nutriIdNum = Number(userId);
    const nutriIdField = String(userId ?? '').trim() !== '' && Number.isFinite(nutriIdNum) ? { NutricionistaID_D: nutriIdNum } : {};

    try {
      // ¿Ya hay carga activa para esta cama+comida en este entorno? → actualizar.
      const filter = encodeURIComponent(
        `fields/CamaLabel_D eq '${esc(bedLabel)}' and fields/Comida_D eq '${comidaVal}' and fields/Status_D eq 'Activo' and fields/Entorno_D eq '${ENTORNO}'`,
      );
      const existing = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=1`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (existing.ok) {
        const data = (await existing.json()) as { value: Record<string, unknown>[] };
        if (data.value?.length > 0) {
          const itemId = String(data.value[0].id);
          await graphFetch(`${basePath}/${itemId}/fields`, {
            method: 'PATCH',
            body: JSON.stringify({
              Tipo_D: tipoVal, Detalle_D: det, Observaciones_D: obs,
              PacienteNombre_D: String(patientName ?? ''), PacienteCodigo_D: String(patientCode ?? ''),
              NutricionistaNombre_D: String(userName ?? ''), ...nutriIdField,
              FechaCarga_D: nowIso,
            }),
          });
          return res.status(200).json({ ok: true, spItemId: itemId });
        }
      }

      const spRes = await graphFetch(basePath, {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            Title: '[sumar]',
            CamaLabel_D: String(bedLabel),
            CamaCodigo_D: String(bedCode ?? ''),
            Habitacion_D: String(roomCode ?? ''),
            Area_D: String(area ?? ''),
            PacienteNombre_D: String(patientName ?? ''),
            PacienteCodigo_D: String(patientCode ?? ''),
            Comida_D: comidaVal,
            Tipo_D: tipoVal,
            Detalle_D: det,
            Observaciones_D: obs,
            Status_D: 'Activo',
            NutricionistaNombre_D: String(userName ?? ''),
            ...nutriIdField,
            FechaCarga_D: nowIso,
            Entorno_D: ENTORNO,
          },
        }),
      });
      if (!spRes.ok) {
        const errText = await spRes.text();
        console.error('[dietas] POST failed:', spRes.status, errText);
        return res.status(500).json({ error: 'Failed to save meal load' });
      }
      const created = (await spRes.json()) as { id: string };
      console.log(`[dietas] ${comidaVal} "${tipoVal}" cargado en "${bedLabel}" por ${userName ?? userId}`);
      return res.status(200).json({ ok: true, spItemId: String(created.id) });
    } catch (err: any) {
      console.error('[dietas] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — quitar una carga (soft-delete) ────────────────────────────────
  if (req.method === 'PATCH') {
    const { spItemId, bedLabel, comida } = req.body ?? {};
    const nowIso = new Date().toISOString();

    try {
      let itemId = spItemId ? String(spItemId) : '';
      if (!itemId) {
        const comidaVal = COMIDAS.includes(String(comida)) ? String(comida) : '';
        if (!bedLabel || !comidaVal) return res.status(400).json({ error: 'spItemId or (bedLabel + comida) required' });
        const filter = encodeURIComponent(
          `fields/CamaLabel_D eq '${esc(bedLabel)}' and fields/Comida_D eq '${comidaVal}' and fields/Status_D eq 'Activo' and fields/Entorno_D eq '${ENTORNO}'`,
        );
        const existing = await graphFetch(
          `${basePath}?$expand=fields&$filter=${filter}&$top=1`,
          { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
        );
        if (existing.ok) {
          const data = (await existing.json()) as { value: Record<string, unknown>[] };
          if (data.value?.length > 0) itemId = String(data.value[0].id);
        }
      }
      if (!itemId) return res.status(200).json({ ok: true, message: 'No active meal load found' });

      await graphFetch(`${basePath}/${itemId}/fields`, {
        method: 'PATCH',
        body: JSON.stringify({ Status_D: 'Inactivo', FechaCierre_D: nowIso }),
      });
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('[dietas] PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
