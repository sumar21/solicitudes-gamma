import type { LucideIcon } from "lucide-react";
import { Activity, ShieldAlert, ShieldX, SprayCan, Utensils, UtensilsCrossed } from "lucide-react";
import { PUNTO_TONO, type Tono } from "@/components/ui/status-badge";
import { BedStatus } from "../types";

/**
 * Estados de una cama (Mapa de Camas) y su tono en el StatusBadge (DESIGN.md §3.11). Mismo eje que
 * lib/estados.ts: un tono por etapa, con los significados del mapa canónico del kit.
 *   exito    → Disponible: lista para recibir un paciente
 *   aviso    → En preparación: falta algo (limpieza / consolidar en PROGAL)
 *   info     → Ocupada: comprometida ("azul = comprometido" del kit). NO es rojo: rojo es peligro
 *              (cancelado / error) y casi todas las camas están ocupadas → el mapa se leía en alarma.
 *   violeta  → Asignada: reservada por un traslado en curso (el "otro camino" de una cama libre)
 *   neutro   → Inhabilitada: fuera de servicio
 * Separación de matiz entre los que conviven en la grilla (§3.11 regla 2): ámbar ~38°, esmeralda
 * ~160°, azul ~217°, violeta ~263° → el par más cercano (azul–violeta) está a 46°. Índigo NO: con el
 * azul de Ocupada quedaba a ~15° y en celdas vecinas se leían igual.
 *
 * Lo usan la grilla (BedsView) y la leyenda del mapa (App.tsx): cambiar un tono acá lo cambia en los dos.
 * El PDF dibuja con sus propios colores (jsPDF) y no pasa por acá.
 */
export interface InfoEstadoCama {
  /** Label completo (filtros, leyenda, modal). */
  label: string;
  /** Label corto para el pill de la card (las cards de la grilla son angostas). */
  corto: string;
  tono: Tono;
  /** Qué significa para quien mira el mapa (leyenda). */
  descripcion: string;
}

export const ESTADOS_CAMA: Record<BedStatus, InfoEstadoCama> = {
  [BedStatus.AVAILABLE]: { label: "Disponible", corto: "Disponible", tono: "exito", descripcion: "Lista para recibir un paciente" },
  [BedStatus.PREPARATION]: { label: "En preparación", corto: "En prep.", tono: "aviso", descripcion: "Liberada, falta limpiarla o consolidarla" },
  [BedStatus.OCCUPIED]: { label: "Ocupada", corto: "Ocupada", tono: "info", descripcion: "Con un paciente internado" },
  [BedStatus.ASSIGNED]: { label: "Asignada", corto: "Asignada", tono: "violeta", descripcion: "Reservada por un traslado en curso" },
  [BedStatus.DISABLED]: { label: "Inhabilitada", corto: "Inhabilit.", tono: "neutro", descripcion: "Fuera de servicio" },
};

/** Orden de lectura (filtros, resumen y leyenda): de lo libre a lo que no se puede usar. */
export const ORDEN_ESTADOS_CAMA: BedStatus[] = [
  BedStatus.AVAILABLE,
  BedStatus.PREPARATION,
  BedStatus.OCCUPIED,
  BedStatus.ASSIGNED,
  BedStatus.DISABLED,
];

/** Estado de una cama → label + tono. Lo desconocido sale tal cual, en neutro. */
export const estadoCama = (status: BedStatus | string): InfoEstadoCama =>
  ESTADOS_CAMA[status as BedStatus] ?? { label: String(status || "—"), corto: String(status || "—"), tono: "neutro", descripcion: "" };

/** Punto del color del estado (resumen de conteos, leyenda, opciones de filtro). */
export const puntoEstadoCama = (status: BedStatus | string): string => PUNTO_TONO[estadoCama(status).tono];

/**
 * Acento fino del estado en el borde izquierdo de la card (§7.9: el estado se lee de un vistazo sin
 * pintar bloques saturados). Literales completos para que Tailwind los genere.
 */
const ACENTO_TONO: Record<Tono, string> = {
  neutro: "border-l-muted-foreground/40",
  aviso: "border-l-amber-500",
  exito: "border-l-emerald-500",
  info: "border-l-blue-500",
  cielo: "border-l-sky-500",
  indigo: "border-l-indigo-500",
  violeta: "border-l-violet-500",
  peligro: "border-l-red-500",
  marca: "border-l-brand",
};
export const acentoEstadoCama = (status: BedStatus | string): string => ACENTO_TONO[estadoCama(status).tono];

/**
 * Marcas que se suman al estado en la card (y en la leyenda). Cada una lleva ícono + texto: el color
 * solo no alcanza para distinguirlas (regla de dataviz: más de ~7 colores no cargan significado solos).
 */
export interface InfoMarcaCama {
  label: string;
  tono: Tono;
  icono: LucideIcon;
  descripcion: string;
}

export const MARCAS_CAMA = {
  /** Cama libre en una habitación con un aislamiento duro: no se asigna. */
  bloqueada: { label: "Bloqueada", tono: "peligro", icono: ShieldX, descripcion: "Paciente aislado en la habitación: no se asigna" },
  /** Cama libre junto a un "Contacto preventivo": se puede usar, con precaución. */
  preventivo: { label: "Contacto prev.", tono: "cielo", icono: ShieldAlert, descripcion: "Contacto preventivo en la habitación: habilitada, con precaución" },
  /** Paciente quirúrgico (PROGAL) pendiente de su cirugía en esta internación. */
  quirurgico: { label: "Q", tono: "aviso", icono: Activity, descripcion: "Paciente quirúrgico pendiente de su cirugía" },
  /** Admisión habilitó una cirugía (clínico → quirúrgico, o nueva cirugía de un quirúrgico). */
  vaCirugia: { label: "C→Q", tono: "neutro", icono: Activity, descripcion: "Admisión lo habilitó para cirugía" },
  ayuno: { label: "Ayuno", tono: "aviso", icono: UtensilsCrossed, descripcion: "Ayuno programado vigente" },
  comandaPendiente: { label: "Comanda", tono: "info", icono: Utensils, descripcion: "Comanda pendiente de entregar" },
  comandaEntregada: { label: "Entregada", tono: "neutro", icono: Utensils, descripcion: "Comanda cargada y ya entregada" },
  rutina: { label: "Limpieza", tono: "cielo", icono: SprayCan, descripcion: "Limpieza de rutina en curso" },
} satisfies Record<string, InfoMarcaCama>;

/**
 * Aislamientos. El nombre canónico y la clave de color los define el back (api/isolations-summary.ts);
 * el color es el de la CARTELERÍA de la puerta (dato del hospital, no un tono del kit), por eso va solo
 * en un punto chico al lado del nombre — nunca color solo, ni de fondo de la card. Con 9+ tipos el
 * color no alcanza para distinguirlos: el que manda es el nombre.
 * Literales completos para que Tailwind los genere.
 */
export const ICONO_AISLAMIENTO: LucideIcon = ShieldAlert;

const PUNTO_AISLAMIENTO: Record<string, string> = {
  pink: "bg-pink-500",
  slate: "bg-muted-foreground", // Trasplante: cartel gris
  green: "bg-green-500",
  blue: "bg-blue-500",
  yellow: "bg-yellow-500",
  orange: "bg-orange-500",
  teal: "bg-teal-500",
  amber: "bg-amber-800", // C. Difficile: marrón
  fuchsia: "bg-fuchsia-500",
  violet: "bg-violet-500", // tipo que el back no reconoce
  // Verde inglés — Quemado (Q) y Diálisis peritoneal (DP), alta 16/09/2026. Más oscuro que `green`
  // (Respiratorio) para no confundirlos.
  englishGreen: "bg-emerald-800",
};

/** Punto de la cartelería de un aislamiento según su clave de color (violeta si no se conoce). */
export const puntoAislamiento = (color?: string): string => (color && PUNTO_AISLAMIENTO[color]) || PUNTO_AISLAMIENTO.violet;

export interface InfoAislamiento {
  nombre: string;
  /** Clave de color del back (api/isolations-summary.ts). */
  color: string;
  /** Sigla de la cartelería, si tiene (lib/isolations.ts). */
  sigla?: string;
}

/** Catálogo para la leyenda: mismos nombres y claves que api/isolations-summary.ts. */
export const AISLAMIENTOS: InfoAislamiento[] = [
  { nombre: "Respiratorio", color: "green" },
  { nombre: "Neutropénico", color: "pink" },
  { nombre: "Trasplante", color: "slate" },
  { nombre: "Por Gotas", color: "blue" },
  { nombre: "Contacto", color: "orange" },
  { nombre: "Contacto preventivo", color: "teal" },
  { nombre: "C. Difficile", color: "amber" },
  { nombre: "Entomológico/Dengue", color: "fuchsia" },
  { nombre: "Covid", color: "yellow" },
  { nombre: "Quemado", color: "englishGreen", sigla: "Q" },
  { nombre: "Diálisis peritoneal", color: "englishGreen", sigla: "DP" },
];
