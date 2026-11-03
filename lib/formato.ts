/**
 * Formato es-AR para toda la app (BASE §4 y §7). Nunca `toFixed` ni `toLocaleString()` sueltos.
 *
 *   dinero(1234.5)        → "$ 1.234,50"
 *   numero(1234)          → "1.234"
 *   porcentaje(0.125)     → "12,5 %"   (recibe una fracción, como Intl)
 *   fecha(hoy)            → "2 nov 2026"
 *   fechaHora(hoy)        → "2 nov 2026, 14:35"
 *   relativo(hace5min)    → "hace 5 min"
 *   parseDinero("1.234,5") → 1234.5
 */

import { format } from "date-fns";
import { es } from "date-fns/locale";

const LOCALE = "es-AR";

export type Fecha = Date | string | number;
const aDate = (d: Fecha) => (d instanceof Date ? d : new Date(d));

const cache = new Map<string, Intl.NumberFormat>();
function nf(clave: string, opciones: Intl.NumberFormatOptions) {
  let f = cache.get(clave);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, opciones);
    cache.set(clave, f);
  }
  return f;
}

/** Moneda ARS. `decimales` por defecto 2 (usá 0 para montos grandes en KPIs). */
export function dinero(n: number, { decimales = 2 }: { decimales?: number } = {}) {
  return nf(`d${decimales}`, {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(n);
}

/** Número con separador de miles. Sin `decimales`, muestra hasta 2 si los tiene. */
export function numero(n: number, { decimales }: { decimales?: number } = {}) {
  return decimales == null
    ? nf("n", { maximumFractionDigits: 2 }).format(n)
    : nf(`n${decimales}`, { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(n);
}

/** Porcentaje a partir de una fracción: 0.125 → "12,5 %". */
export function porcentaje(n: number, { decimales }: { decimales?: number } = {}) {
  return nf(`p${decimales ?? "a"}`, {
    style: "percent",
    minimumFractionDigits: decimales ?? 0,
    maximumFractionDigits: decimales ?? 1,
  }).format(n);
}

/** "2 nov 2026". */
export function fecha(d: Fecha) {
  return format(aDate(d), "d MMM yyyy", { locale: es });
}

/** "2 nov 2026, 14:35" (24 h). */
export function fechaHora(d: Fecha) {
  return format(aDate(d), "d MMM yyyy, HH:mm", { locale: es });
}

/** "14:35" (24 h). */
export function hora(d: Fecha) {
  return format(aDate(d), "HH:mm", { locale: es });
}

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto", style: "short" });
const UNIDADES: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "hace 5 min", "en 2 días", "ayer", "mañana", "ahora". */
export function relativo(d: Fecha, ahora: Date = new Date()) {
  const seg = (aDate(d).getTime() - ahora.getTime()) / 1000;
  if (Math.abs(seg) < 45) return "ahora";
  // Días por calendario (no por horas) para que "ayer" sea ayer aunque hayan pasado 15 h.
  if (Math.abs(seg) >= 20 * 3600 && Math.abs(seg) < 7 * 24 * 3600) {
    const a = aDate(d);
    const dias = Math.round(
      (Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) -
        Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())) /
        86_400_000,
    );
    if (dias !== 0) return rtf.format(dias, "day");
  }
  for (const [unidad, s] of UNIDADES) {
    if (Math.abs(seg) >= s) return rtf.format(Math.round(seg / s), unidad);
  }
  return rtf.format(Math.round(seg / 60), "minute");
}

/** Lee un monto escrito a la argentina ("$ 1.234,56", "1234,5", "1.234") → número o null. */
export function parseDinero(texto: string): number | null {
  const limpio = texto.replace(/[^\d,.-]/g, "");
  if (!limpio || limpio === "-" || limpio === ",") return null;
  // El punto es separador de miles; la coma, de decimales.
  const n = Number(limpio.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const fLarga = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long" });
const fDiaMes = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "numeric" });

/** "Lunes, 2 de noviembre" (encabezados). */
export function fechaLarga(d: Fecha) {
  const s = fLarga.format(aDate(d));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2/11" (ejes de gráficos). */
export function diaMes(d: Fecha) {
  return fDiaMes.format(aDate(d));
}
