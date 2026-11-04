import type { Tono } from "@/components/ui/status-badge";
import type { CirugiaEstado } from "../types";
import { CIRUGIA_ESTADO_LABEL, CIRUGIA_ESTADO_SHORT } from "./constants";

/**
 * Estados de la cirugía (Operativa → Cirugías y pill "Cx" del Mapa de Camas) y su tono en el
 * StatusBadge (DESIGN.md §3.11).
 *
 * LOS COLORES SON LOS ACORDADOS en el plan (docs/planes/plan-traslados-cirugia.html) y los que ya
 * conocían en el hospital: uno por estado, porque enfermería sigue al paciente por el color de la
 * pill en el mapa. El rediseño (nov-2026) los había agrupado por etapa (azul / violeta / verde) y se
 * restauraron:
 *   aviso    (ámbar)    → Listo para cirugía
 *   naranja             → Búsqueda para cirugía
 *   amarillo            → En traslado a cirugía
 *   cian                → En cirugía
 *   violeta             → Regreso de cirugía
 *   exito    (verde)    → Iniciar dieta / Cerrada
 *   peligro  (rojo)     → Cancelada
 * Ámbar, naranja y amarillo están cerca de matiz: siempre van con su texto (la pill dice el estado).
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
  VAN_A_BUSCAR: "naranja",
  EN_TRASLADO: "amarillo",
  EN_CIRUGIA: "cian",
  EN_DEVOLUCION: "violeta",
  TOLERANCIA_EVALUADA: "exito",
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
