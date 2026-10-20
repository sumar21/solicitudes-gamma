/**
 * Choque con "una operatoria VIVA por cama" (índice cirugia_viva_uidx) al dar de alta "Listo para cirugía".
 *
 * Antes, cualquier choque se trataba como un reintento idempotente: se devolvía 200 con el id de la
 * operatoria viva de esa cama, aunque fuera de OTRO paciente. Caso real 20/10/2026: la operatoria del
 * paciente anterior de la cama quedó en "Regreso de cirugía" toda la noche; Enfermería tocaba "Listo
 * para cirugía" para el paciente nuevo, la API contestaba ok, el panel se cerraba y no pasaba nada (la
 * pill Cx sigue al paciente, así que tampoco se veía la operatoria ajena).
 *
 * Ahora el candado es POR PACIENTE (migración 20261020140000): un paciente no puede tener dos operatorias
 * en curso; la cama no importa y "Regreso de cirugía" no cuenta. Choque con el mismo paciente → idempotente
 * (200). Si la base todavía tuviera los índices viejos por cama, un choque con OTRO paciente da 409 con un
 * mensaje que dice qué operatoria toma la cama y qué hacer. Puro (sin imports) para testearlo:
 * npx tsx scripts/check-cirugia-conflict.mts
 */

export interface LiveCirugiaRow {
  id: string;
  paciente_codigo?: string | null;
  paciente_nombre?: string | null;
  estado: string;
  cama_origen?: string | null;
  cama_destino?: string | null;
  updated_at?: string | null;
}

// Mismos textos que CIRUGIA_ESTADO_LABEL (lib/constants.ts); api/ no importa de lib/.
const ESTADO_LABEL: Record<string, string> = {
  LISTO_PARA_CIRUGIA: 'Listo para cirugía',
  VAN_A_BUSCAR: 'Búsqueda para cirugía',
  EN_TRASLADO: 'En traslado a cirugía',
  EN_CIRUGIA: 'En cirugía',
  EN_DEVOLUCION: 'Regreso de cirugía',
};

const norm = (s: string | null | undefined) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** ¿La operatoria viva es del mismo paciente que el alta? Por código; si falta en un lado, por nombre.
 *  Sin datos para comparar → true (se conserva el comportamiento idempotente de siempre). */
export function isSameCirugiaPatient(
  live: Pick<LiveCirugiaRow, 'paciente_codigo' | 'paciente_nombre'>,
  req: { pacienteCodigo?: unknown; pacienteNombre?: unknown },
): boolean {
  const lc = String(live.paciente_codigo ?? '').trim();
  const rc = String(req.pacienteCodigo ?? '').trim();
  if (lc && rc) return lc === rc;
  const ln = norm(live.paciente_nombre);
  const rn = norm(req.pacienteNombre as string | undefined);
  if (ln && rn) return ln === rn;
  return true;
}

// "Habitacion 825 HPR - Cama 01" → "825 - 01" (mismo criterio que formatBedName de lib/utils).
function bedShort(label: string | null | undefined): string {
  const s = String(label ?? '');
  const m = s.match(/Habitaci[oó]n\s+([A-Za-z0-9]+)(?:\s+HPR)?\s*-\s*Cama\s*([A-Za-z0-9]+)/i);
  return m ? `${m[1]} - ${m[2]}` : s;
}

function fechaAR(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const p = (t: string) => parts.find(x => x.type === t)?.value ?? '';
  return `${p('day')}/${p('month')} ${p('hour')}:${p('minute')}`; // p. ej. "19/10 21:33"
}

/** Mensaje del 409: quién tiene la cirugía abierta en la cama, en qué estado y desde cuándo, y qué hacer. */
export function cirugiaBedBusyMessage(live: LiveCirugiaRow, camaOrigen: string): string {
  const quien = live.paciente_nombre?.trim() || 'otro paciente';
  const estado = ESTADO_LABEL[live.estado] ?? live.estado;
  const desde = fechaAR(live.updated_at);
  const volvio = live.estado === 'EN_DEVOLUCION' && live.cama_destino && live.cama_destino !== live.cama_origen
    ? `, volvió a la ${bedShort(live.cama_destino)}` : '';
  const queHacer = live.estado === 'EN_DEVOLUCION'
    ? 'Cerrala con "Iniciar dieta" en la cama donde está ese paciente'
    : 'Terminala o cancelala desde Operativa → Cirugías';
  return `La ${bedShort(camaOrigen)} tiene una cirugía abierta de ${quien} (${estado}${desde ? ` desde el ${desde}` : ''}${volvio}). `
    + `${queHacer} y después volvé a marcar a este paciente.`;
}

export type AltaChoque =
  | { kind: 'ninguno' }
  | { kind: 'idempotente'; id: string }
  | { kind: 'conflicto'; live: LiveCirugiaRow };

/**
 * Qué hacer cuando el INSERT chocó contra cirugia_viva_uidx. `rows` = las operatorias vivas de esa cama.
 * La que choca es la que está EN CURSO (el índice nuevo no cuenta "Regreso de cirugía"). Si solo hay
 * operatorias en "Regreso", la base todavía tiene el índice viejo: se informa el choque (409) en vez de
 * devolver un ok que no creó nada. Solo es reintento idempotente si la EN CURSO es del mismo paciente.
 */
export function resolveAltaChoque(
  rows: LiveCirugiaRow[],
  req: { pacienteCodigo?: unknown; pacienteNombre?: unknown },
): AltaChoque {
  if (!rows.length) return { kind: 'ninguno' };
  const enCurso = rows.filter(r => r.estado !== 'EN_DEVOLUCION');
  // El MISMO paciente ya tiene una en curso → es esa (doble tap, dos dispositivos, o ya estaba marcado):
  // idempotente. Con el candado por paciente (migración 20261020140000) es el único choque posible.
  const propia = enCurso.find(r => isSameCirugiaPatient(r, req));
  if (propia) return { kind: 'idempotente', id: String(propia.id) };
  // Índices viejos por cama todavía aplicados: la cama está tomada por OTRO paciente → 409 con el motivo.
  return { kind: 'conflicto', live: enCurso[0] ?? rows[0] };
}
