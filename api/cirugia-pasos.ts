/**
 * "Volver un paso" en cirugía (20/10/2026). Puro (sin imports) para testearlo:
 * npx tsx scripts/check-cirugia-retroceso.mts
 *
 * Corrige un paso marcado por error (p. ej. "En traslado a cirugía" que al final no salió). El retroceso
 * queda en la auditoría como evento RETROCESO con { de, a }: así se mide cuántas veces se marca un paso
 * por error. No dispara push (notify-change solo avisa los pasos de su lista).
 */

// Paso ANTERIOR de cada estado en curso. LISTO no tiene anterior (se cancela) y las terminales no vuelven.
// Mismo mapa que CIRUGIA_ANTERIOR (lib/constants.ts); api/ no importa de lib/.
export const ANTERIOR: Record<string, string> = {
  VAN_A_BUSCAR:  'LISTO_PARA_CIRUGIA',
  EN_TRASLADO:   'VAN_A_BUSCAR',
  EN_CIRUGIA:    'EN_TRASLADO',
  EN_DEVOLUCION: 'EN_CIRUGIA',
};

/**
 * Hora de cada paso de UNA operatoria a partir de sus eventos (en orden cronológico), para las columnas
 * de hora de la grilla. Con retrocesos un paso puede repetirse: vale la ÚLTIMA vez, y un RETROCESO borra
 * la hora del paso que se deshizo (si no, la grilla mostraría "Retirado 10:00" de un traslado que no fue).
 */
export function pasosDesdeEventos(
  evs: { tipo?: unknown; meta?: { de?: unknown } | null; created_at?: unknown }[],
): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const e of evs) {
    const tipo = String(e.tipo ?? '');
    if (!tipo) continue;
    if (tipo === 'RETROCESO') { const de = String(e.meta?.de ?? ''); if (de) delete rec[de]; }
    else rec[tipo] = String(e.created_at ?? '');
  }
  return rec;
}
