import type { Tono } from "@/components/ui/status-badge";

/**
 * Estados de las limpiezas (Operativa → Limpiezas) y su tono en el StatusBadge (DESIGN.md §3.11).
 * Mismo eje que lib/estados.ts: un tono por etapa, no uno por estado.
 *
 * Limpieza de rutina (cama ocupada, reporte del día):
 *   info    → en curso (se inició y no se terminó)
 *   exito   → finalizada
 *   neutro  → anulada (cancelada con observación)
 *
 * Motivo de cierre de una limpieza (histórico). Conviven en la misma columna, así que los matices
 * están separados ≥ 25°: esmeralda ~160°, azul ~225°, violeta ~263°, ámbar ~38°, rojo ~0°.
 *   exito    → CONSOLIDADO: Admisión la consolidó en PROGAL (el cierre "bueno")
 *   info     → TICKET: un traslado de la app tomó la cama
 *   violeta  → GAMMA: PROGAL avanzó la cama por fuera de la app ("el otro camino")
 *   aviso    → SUCIA: se había pasado a limpia y estaba sucia (volvió a preparación)
 *   neutro   → ANULADA: la marca de limpia se deshizo
 *   peligro  → CANCELADA: se canceló con observación (estaba marcada limpia por error)
 */
interface InfoEstado {
  label: string;
  tono: Tono;
}

export const ESTADOS_RUTINA: Record<string, InfoEstado> = {
  INICIADA: { label: "En curso", tono: "info" },
  FINALIZADA: { label: "Finalizada", tono: "exito" },
  ANULADA: { label: "Anulada", tono: "neutro" },
};

/** Estado de una limpieza de rutina → label + tono. Lo desconocido sale tal cual, en neutro. */
export const estadoRutina = (estado: string): InfoEstado =>
  ESTADOS_RUTINA[estado] ?? { label: estado || "—", tono: "neutro" };

export const MOTIVOS_CIERRE: Record<string, InfoEstado> = {
  CONSOLIDADO: { label: "Consolidado", tono: "exito" },
  TICKET: { label: "Traslado", tono: "info" },
  GAMMA: { label: "PROGAL", tono: "violeta" },
  SUCIA: { label: "Volvió a preparación", tono: "aviso" },
  ANULADA: { label: "Anulada", tono: "neutro" },
};

/** "CANCELADA: <observación> — <quién>": el texto viaja en el mismo motivo_cierre (30/10/2026). */
export const esCancelada = (motivo: string) => motivo.startsWith("CANCELADA");

/** Motivo de cierre → label + tono. Lo desconocido sale tal cual, en neutro. */
export const motivoCierre = (motivo: string): InfoEstado =>
  esCancelada(motivo)
    ? { label: "Cancelada", tono: "peligro" }
    : (MOTIVOS_CIERRE[motivo] ?? { label: motivo || "—", tono: "neutro" });
