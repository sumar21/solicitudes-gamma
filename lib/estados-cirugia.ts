import type { Tono } from "@/components/ui/status-badge";
import type { CirugiaEstado } from "../types";
import { CIRUGIA_ESTADO_LABEL, CIRUGIA_ESTADO_SHORT } from "./constants";

/**
 * Estados de la cirugía (Operativa → Cirugías) y su tono en el StatusBadge (DESIGN.md §3.11). Un tono
 * por ETAPA del circuito, no uno por estado (§3.11 regla 1): los que significan "falta lo mismo"
 * comparten tono y los distingue el texto.
 *   aviso   → pendiente: marcado listo, falta que lo vayan a buscar
 *   info    → en camino al quirófano (búsqueda + traslado: el paciente se está moviendo)
 *   violeta → en cirugía
 *   exito   → la cirugía terminó y vuelve al piso (falta iniciar la dieta, que cierra la operatoria)
 *   neutro  → cerrada (dieta iniciada)
 *   peligro → cancelada
 * Separación de matiz entre los que conviven en la grilla de activas (§3.11 regla 2): ámbar ~38°,
 * esmeralda ~160°, azul ~217°, violeta ~263° → el par más cercano (azul–violeta) está a 46°.
 * El label es el corto (sin el prefijo "Cx": acá ya estamos en la solapa Cirugías); el largo va en
 * `titulo` para el tooltip.
 */
interface InfoEstadoCirugia {
  label: string;
  titulo: string;
  tono: Tono;
}

const TONO: Record<CirugiaEstado, Tono> = {
  LISTO_PARA_CIRUGIA: "aviso",
  VAN_A_BUSCAR: "info",
  EN_TRASLADO: "info",
  EN_CIRUGIA: "violeta",
  EN_DEVOLUCION: "exito",
  TOLERANCIA_EVALUADA: "neutro",
  CANCELADO: "peligro",
};

export const ESTADOS_CIRUGIA = Object.fromEntries(
  (Object.keys(TONO) as CirugiaEstado[]).map((e) => [
    e,
    { label: CIRUGIA_ESTADO_SHORT[e], titulo: CIRUGIA_ESTADO_LABEL[e], tono: TONO[e] },
  ]),
) as Record<CirugiaEstado, InfoEstadoCirugia>;

// En el HISTÓRICO toda fila es terminal. Ahí "Dieta" se leería como "sigue en tolerancia" → se muestra
// el resultado del ticket: Cerrada / Cancelada.
const LABEL_HISTORICO: Partial<Record<CirugiaEstado, string>> = {
  TOLERANCIA_EVALUADA: "Cerrada",
  CANCELADO: "Cancelada",
};

/** Estado de una cirugía para el StatusBadge; `historico` usa los labels de cierre. */
export function estadoCirugia(estado: CirugiaEstado, historico = false): InfoEstadoCirugia {
  const info = ESTADOS_CIRUGIA[estado] ?? { label: String(estado), titulo: String(estado), tono: "neutro" as Tono };
  const label = historico ? LABEL_HISTORICO[estado] ?? info.label : info.label;
  return { ...info, label };
}

/** Pasos del circuito en orden (el indicador de pasos de la grilla de activas). */
export const PASOS_CIRUGIA: CirugiaEstado[] = [
  "LISTO_PARA_CIRUGIA",
  "VAN_A_BUSCAR",
  "EN_TRASLADO",
  "EN_CIRUGIA",
  "EN_DEVOLUCION",
];
