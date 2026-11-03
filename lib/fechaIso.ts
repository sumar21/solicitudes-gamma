/**
 * Puente entre las fechas "YYYY-MM-DD" que usan los filtros de la app y el Calendar del kit
 * (react-day-picker, trabaja con Date). Fecha local, sin pasar por UTC: new Date("2026-11-03")
 * sería las 21 h del día anterior en Argentina.
 */
export function aIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function deIso(s?: string | null): Date | undefined {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}
