import type { Tono } from "@/components/ui/status-badge";
import { COMANDA_STATUS, type ComandaStatus, type MealSlot } from "../types";

/**
 * Comandas (Gestión de Comandas) → tonos del StatusBadge (DESIGN.md §3.11). Mismo eje que
 * lib/estados.ts: un tono por etapa, no uno por estado.
 *
 * Estado de la bandeja (conviven en la columna Estado: ámbar ~38°, esmeralda ~160°, gris):
 *   aviso   → Pendiente: cocina todavía la tiene que sacar
 *   exito   → Entregado
 *   neutro  → Anulada (auditoría: se pidió y se canceló)
 *
 * Tipo de comanda: los mismos colores que el mapa de camas (comandaTipoPill de BedsView), que es
 * donde Nutrición las carga. Conviven en la columna Tipo: esmeralda ~160°, ámbar ~38°, índigo ~239°.
 *   exito   → Menú
 *   aviso   → Opción
 *   indigo  → Otros (texto libre)
 *
 * Los labels son los MISMOS que antes (el buscador y el Excel/PDF los usan): cambiar uno acá cambia
 * qué encuentra el buscador y qué sale en el papel.
 */
interface InfoEstado {
  label: string;
  tono: Tono;
}

export const ESTADOS_COMANDA: Record<ComandaStatus, InfoEstado> = {
  [COMANDA_STATUS.PENDIENTE]: { label: "Pendiente", tono: "aviso" },
  [COMANDA_STATUS.ENTREGADO]: { label: "Entregado", tono: "exito" },
  [COMANDA_STATUS.ANULADA]: { label: "Anulada", tono: "neutro" },
};

/** Estado → label + tono. Un status inesperado se lee como Pendiente (del lado seguro, como antes). */
export const estadoComanda = (s: ComandaStatus): InfoEstado =>
  ESTADOS_COMANDA[s] ?? ESTADOS_COMANDA[COMANDA_STATUS.PENDIENTE];

/** Tipo de comanda → label + tono. Vacío o desconocido = "Otros" (igual que comandaTipoPill). */
export const tipoComanda = (t?: string): InfoEstado =>
  t === "MENU"
    ? { label: "Menú", tono: "exito" }
    : t === "OPCION"
      ? { label: "Opción", tono: "aviso" }
      : { label: "Otros", tono: "indigo" };

/**
 * Punto de color del turno (no es un estado: es la hora del día, así que va como punto + texto y no
 * como pill). Progresión amanecer → mediodía → tarde → noche, con los matices del PDF y de la
 * planificación (naranja/sky/rosa/violeta) llevados a la paleta del §1.4: ámbar ~38°, sky ~199°,
 * rojo ~0°, violeta ~258° — todos a ≥ 25° entre sí. Es un `Record<MealSlot, …>` a propósito: si se
 * suma un turno al catálogo de types.ts, `tsc` obliga a darle color acá.
 */
export const PUNTO_TURNO: Record<MealSlot, string> = {
  desayuno: "bg-amber-500",
  almuerzo: "bg-sky-500",
  merienda: "bg-red-400",
  cena: "bg-violet-500",
};
