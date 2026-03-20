/**
 * POST /api/auth
 * Login contra la lista SharePoint "00.Usuarios".
 * Condiciones: Aplicacion_U = "Traslados" AND Status_U = "Activo"
 *
 * Body:    { username: string, password: string }
 * Returns: { user, token }  — token JWT con 8h de vida
 */

import { graphFetch } from './graph.js';
import { signToken }  from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = 'e623ad06-ff62-441f-b67d-666224af5805'; // 00.Usuarios

// Short codes → full Area names (same map as users.ts)
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
function decodeFloors(raw: string): string {
  if (!raw) return '';
  return raw.split(';').filter(Boolean).map(s => AREA_CODES[s.trim()] ?? s).join(';');
}

// Map SP Perfil_Usr → app Role enum
function mapRole(perfil: string): string {
  const p = perfil.toLowerCase().trim();
  if (p === 'admin')                        return 'ADMIN';
  if (p.includes('admisi'))                 return 'ADMISSION';
  if (p.includes('coordinad'))              return 'COORDINATOR';
  if (p.includes('azafata') || p === 'hostess') return 'HOSTESS';
  if (p.includes('housekeeping') || p.includes('mucam')) return 'HOUSEKEEPING';
  if (p.includes('enfermer') || p === 'nursing') return 'NURSING';
  return 'READ_ONLY';
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (!SITE_ID)                return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });

  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username y password requeridos' });
  }

  try {
    // Buscar usuario activo (internal field names from SP list)
    const filter = [
      `fields/Status_U eq 'Activo'`,
      `fields/UsuarioApp_Usr eq '${String(username).replace(/'/g, "''")}'`,
    ].join(' and ');

    const spRes = await graphFetch(
      `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$filter=${encodeURIComponent(filter)}&$top=1`,
      { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
    );

    if (!spRes.ok) {
      throw new Error(`SP query failed (${spRes.status}): ${await spRes.text()}`);
    }

    const data   = (await spRes.json()) as { value: Record<string, unknown>[] };
    const items  = data.value ?? [];

    if (items.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
    }

    const fields = items[0].fields as Record<string, unknown>;
    const spId   = String(items[0].id);

    // Verificar contraseña
    if (String(fields.Password_Usr ?? '') !== password) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Construir objeto User (internal SP field names)
    const user = {
      id:        spId,
      name:      String(fields.ConcatName_Usr ?? fields.Nombre_Usr ?? fields.Title ?? username),
      email:     String(fields.Mail_U     ?? ''),
      role:      mapRole(String(fields.Perfil_U ?? 'ADMISSION')),
      sede:      String(fields.Sede_U     ?? 'HPR'),
      avatar:         '',
      assignedFloors: decodeFloors(String(fields.PisosAzafata_u ?? '')),
      lastLogin:      new Date().toISOString(),
    };

    // Firmar JWT (8h)
    const token = await signToken({
      id:    user.id,
      name:  user.name,
      role:  user.role,
      sede:  user.sede,
      email: user.email,
    });

    return res.status(200).json({ user, token });
  } catch (err: any) {
    console.error('[api/auth]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}
