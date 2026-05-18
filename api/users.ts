/**
 * Vercel serverless function — CRUD for the "00.Usuarios" SharePoint List.
 *
 * GET    /api/users          → all active users with Aplicacion_U = 'Traslados'
 * POST   /api/users          → create user (defaults: Aplicacion_U='Traslados', Status_U='Activo')
 * PATCH  /api/users          → update user fields  { spItemId, ...fields }
 * DELETE /api/users          → soft-delete user     { spItemId } → Status_U = 'Inactivo'
 */

import { graphFetch }  from './graph.js';
import { requireAuth } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = 'e623ad06-ff62-441f-b67d-666224af5805'; // 00.Usuarios

// Short codes ↔ full Area names for PisosAzafata_u (SP field is 255-char max)
const AREA_CODES: Record<string, string> = {
  'P4':  'Internacion 4° Piso HPR',
  'P5':  'Internacion 5° Piso HPR',
  'P6':  'Internacion 6° Piso HPR',
  'P7':  'Internacion 7° Piso HPR',
  'P8':  'Internacion 8° Piso HPR',
  'HIT': 'Internación Transitoria HPR',
  'HSS': 'Servicio de Neurofisiologia (Sueño) HPR',
  'HUC': 'Unidad Coronaria HPR',
  'HUQ': 'Unidad Recuperaciòn Postquirùrgica',
  'HUT': 'Unidad de Terapia Intensiva HPR',
};
const AREA_TO_CODE = Object.fromEntries(Object.entries(AREA_CODES).map(([k, v]) => [v, k]));

/** Convert stored SP value → full area names (handles both old full-name format and new codes) */
function decodeFloors(raw: string): string {
  if (!raw) return '';
  return raw.split(';').filter(Boolean).map(s => AREA_CODES[s.trim()] ?? s).join(';');
}

/** Convert full area names → short codes for SP storage */
function encodeFloors(raw: string): string {
  if (!raw) return '';
  return raw.split(';').filter(Boolean).map(s => AREA_TO_CODE[s.trim()] ?? s).join(';');
}

// ── SP item → User ──────────────────────────────────────────────────────────
interface User {
  id:       string;
  name:     string;
  email:    string;
  role:     string;
  sede:     string;
  username:       string;
  status:         string;
  assignedFloors: string;
}

function spToUser(item: Record<string, unknown>): User {
  const f = item.fields as Record<string, unknown>;
  return {
    id:       String(item.id),
    name:     String(f.ConcatName_Usr ?? f.Nombre_Usr ?? ''),
    email:    String(f.Mail_U ?? ''),
    role:     String(f.Perfil_U ?? ''),
    sede:     String(f.Sede_U ?? ''),
    username:       String(f.UsuarioApp_Usr ?? ''),
    status:         String(f.Status_U ?? ''),
    assignedFloors: decodeFloors(String(f.PisosAzafata_u ?? '')),
  };
}

// ── Partial user input → SP fields ──────────────────────────────────────────
interface UserInput {
  name?:     string;
  firstName?: string;
  email?:    string;
  role?:     string;
  sede?:     string;
  username?: string;
  password?:       string;
  status?:         string;
  assignedFloors?: string;
}

function userToFields(u: UserInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  if (u.name      !== undefined) fields.ConcatName_Usr  = u.name;
  if (u.firstName !== undefined) fields.Nombre_Usr      = u.firstName;
  if (u.email     !== undefined) fields.Mail_U          = u.email;
  if (u.role      !== undefined) fields.Perfil_U        = u.role;
  if (u.sede      !== undefined) fields.Sede_U          = u.sede;
  if (u.username  !== undefined) fields.UsuarioApp_Usr  = u.username;
  if (u.password  !== undefined) fields.Password_Usr    = u.password;
  if (u.status         !== undefined) fields.Status_U        = u.status;
  if (u.assignedFloors !== undefined) fields.PisosAzafata_u  = encodeFloors(u.assignedFloors);

  fields.Title = '[sumar]';

  return fields;
}

// ── Handler ─────────────────────────────────────────────────────────────────
async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SITE_ID) {
    return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });
  }

  try {
    // ── GET ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const filter = encodeURIComponent(
        "fields/Aplicacion_U eq 'Traslados' and fields/Status_U eq 'Activo'",
      );

      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$top=500&$filter=${filter}`,
        { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
      );

      if (!spRes.ok) throw new Error(`SP GET failed (${spRes.status}): ${await spRes.text()}`);

      const data  = (await spRes.json()) as { value: Record<string, unknown>[] };
      const users = (data.value ?? []).map(spToUser);

      return res.status(200).json({ users });
    }

    // ── POST ─────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const input = req.body as UserInput;

      if (!input.username || !input.password || !input.name) {
        return res.status(400).json({ error: 'username, password and name are required' });
      }

      const fields = userToFields(input);
      fields.Aplicacion_U = 'Traslados';
      fields.Status_U     = 'Activo';

      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items`,
        {
          method: 'POST',
          body:   JSON.stringify({ fields }),
        },
      );

      if (!spRes.ok) throw new Error(`SP POST failed (${spRes.status}): ${await spRes.text()}`);

      const data = (await spRes.json()) as { id: string };
      return res.status(201).json({ id: data.id });
    }

    // ── PATCH ────────────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { spItemId, ...updates } = req.body as UserInput & { spItemId: string };
      if (!spItemId) return res.status(400).json({ error: 'spItemId required' });

      const fields = userToFields(updates);
      // Remove fields that are calculated or read-only
      delete fields.ConcatName_Usr;
      delete fields.Title;
      console.log('[api/users] PATCH spItemId:', spItemId, 'fields:', JSON.stringify(fields));

      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items/${spItemId}/fields`,
        {
          method: 'PATCH',
          body:   JSON.stringify(fields),
        },
      );

      if (!spRes.ok) throw new Error(`SP PATCH failed (${spRes.status}): ${await spRes.text()}`);

      return res.status(200).json({ ok: true });
    }

    // ── DELETE (soft-delete → set Status_U = 'Inactivo') ─────────────────
    if (req.method === 'DELETE') {
      const { spItemId } = req.body as { spItemId: string };
      if (!spItemId) return res.status(400).json({ error: 'spItemId required' });

      const spRes = await graphFetch(
        `/sites/${SITE_ID}/lists/${LIST_ID}/items/${spItemId}/fields`,
        {
          method: 'PATCH',
          body:   JSON.stringify({ Status_U: 'Inactivo' }),
        },
      );

      if (!spRes.ok) throw new Error(`SP DELETE failed (${spRes.status}): ${await spRes.text()}`);

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[api/users]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

export default requireAuth(handler);
