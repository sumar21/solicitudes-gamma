/**
 * Mapa PARCIAL de Gamma por sector faltante (27/10/2026). Puro para testearlo: npx tsx scripts/check-beds-sectores.mts
 *
 * Sectores que SIEMPRE vienen en el mapa (relevados de 30 días de traslados). El control por tamaño de
 * api/beds.ts necesita un mapa anterior en memoria, que una instancia nueva de Vercel no tiene: así llegó a un
 * celular un mapa sin UCO ni 6° piso y una azafata del 5° vio y marcó un traslado UCO → 623. Si falta un sector
 * entero el mapa es parcial: api/beds.ts sirve el cache si hay; si no, el mapa marcado `partial` (el cliente no
 * lo toma como bueno).
 */
export const SECTORES_BASE = [
  'Internacion 4° Piso HPR', 'Internacion 5° Piso HPR', 'Internacion 6° Piso HPR', 'Internacion 7° Piso HPR',
  'Internacion 8° Piso HPR', 'Internación Transitoria HPR', 'Unidad Coronaria HPR', 'Unidad de Terapia Intensiva HPR',
  'Recepción Admision y Altas de Internacion HPR',
];
export const sectoresFaltantes = (beds: { area?: string }[]): string[] => {
  const presentes = new Set(beds.map(b => b.area));
  return SECTORES_BASE.filter(s => !presentes.has(s));
};
