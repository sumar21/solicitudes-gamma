/**
 * Vercel serverless — CRUD for "08.Aislamientos" SharePoint list.
 *
 * GET    /api/isolations          → all active isolations
 * POST   /api/isolations          → create/activate { patientCode, patientName }
 * DELETE /api/isolations          → deactivate       { patientCode }
 */

import { graphFetch }  from './graph.js';
import { requireAuth } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '0a36e3e2-1ca2-4951-86f9-afd288465022'; // 08.Aislamientos

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });

  const basePath = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;

  // ── GET — fetch active isolations ─────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const filter = encodeURIComponent("fields/Status_A eq 'Activo'");
      const spRes = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=500`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );
      if (!spRes.ok) {
        console.error('[isolations] GET failed:', spRes.status);
        return res.status(200).json({ isolations: [] });
      }
      const data = (await spRes.json()) as { value: Record<string, unknown>[] };
      const isolations = (data.value ?? []).map((item: any) => {
        const f = item.fields as Record<string, unknown>;
        return {
          spItemId: String(item.id),
          patientCode: String(f.CodigoPaciente_A ?? ''),
          patientName: String(f.NombrePaciente_A ?? ''),
          tipo: String(f.Tipo_A ?? ''),
          createdBy: String(f.Usuario_A ?? ''),
          createdAt: String(f.Fecha_A ?? ''),
        };
      });
      return res.status(200).json({ isolations });
    } catch (err: any) {
      console.error('[isolations] GET error:', err);
      return res.status(200).json({ isolations: [] });
    }
  }

  // ── POST — create or reactivate isolation ─────────────────────────────────
  if (req.method === 'POST') {
    const { patientCode, patientName, userName, tipo } = req.body ?? {};
    if (!patientCode) return res.status(400).json({ error: 'patientCode is required' });

    try {
      // Check if there's already a record for this patient
      const filter = encodeURIComponent(`fields/CodigoPaciente_A eq '${String(patientCode).replace(/'/g, "''")}'`);
      const existing = await graphFetch(
        `${basePath}?$expand=fields&$filter=${filter}&$top=1`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );

      if (existing.ok) {
        const data = (await existing.json()) as { value: Record<string, unknown>[] };
        if (data.value?.length > 0) {
          // Reactivate existing record
          const itemId = String(data.value[0].id);
          await graphFetch(`${basePath}/${itemId}/fields`, {
            method: 'PATCH',
            body: JSON.stringify({
              Status_A: 'Activo',
              Usuario_A: userName || '',
              Fecha_A: new Date().toISOString(),
              NombrePaciente_A: patientName || '',
              Tipo_A: tipo || '',
            }),
          });
          console.log(`[isolations] Reactivated isolation for patient ${patientCode}`);
          return res.status(200).json({ ok: true, spItemId: itemId });
        }
      }

      // Create new record
      const spRes = await graphFetch(basePath, {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            CodigoPaciente_A: String(patientCode).trim(),
            NombrePaciente_A: String(patientName || ''),
            Status_A: 'Activo',
            Usuario_A: String(userName || ''),
            Fecha_A: new Date().toISOString(),
            Tipo_A: String(tipo || ''),
          },
        }),
      });

      if (!spRes.ok) {
        const errText = await spRes.text();
        console.error('[isolations] POST failed:', spRes.status, errText);
        return res.status(500).json({ error: 'Failed to create isolation' });
      }

      const created = (await spRes.json()) as { id: string };
      console.log(`[isolations] Created isolation for patient ${patientCode}`);
      return res.status(200).json({ ok: true, spItemId: String(created.id) });
    } catch (err: any) {
      console.error('[isolations] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE — deactivate isolation ─────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { patientCode } = req.body ?? {};
    if (!patientCode) return res.status(400).json({ error: 'patientCode is required' });

    try {
      const filter = encodeURIComponent(
        `fields/CodigoPaciente_A eq '${String(patientCode).replace(/'/g, "''")}' and fields/Status_A eq 'Activo'`
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
            body: JSON.stringify({ Status_A: 'Inactivo' }),
          });
          console.log(`[isolations] Deactivated isolation for patient ${patientCode}`);
          return res.status(200).json({ ok: true });
        }
      }

      return res.status(200).json({ ok: true, message: 'No active isolation found' });
    } catch (err: any) {
      console.error('[isolations] DELETE error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireAuth(handler);
