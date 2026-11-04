import type { LucideIcon } from "lucide-react";
import { Activity, ShieldAlert, ShieldX, SprayCan, Utensils, UtensilsCrossed } from "lucide-react";
import { PUNTO_TONO, type Tono } from "@/components/ui/status-badge";
import { BedStatus } from "../types";

/**
 * Estados de una cama (Mapa de Camas) y su tono en el StatusBadge (DESIGN.md §3.11).
 *
 * LOS COLORES ESTÁN ACORDADOS CON EL HOSPITAL y documentados (docs/qa/casos-de-uso.md, Mapa de
 * Camas): enfermería, azafatas y catering leen el mapa por color. NO se cambian por una regla del
 * kit — el rediseño (nov-2026) los había pasado a azul / violeta y se restauraron:
 *   verde    (exito)   → Disponible
 *   ámbar    (aviso)   → En preparación
 *   rojo     (peligro) → Ocupada
 *   índigo   (indigo)  → Asignada (traslado en curso)
 *   gris     (neutro)  → Inhabilitada
 * Marcas de aislamiento sobre camas LIBRES (docs/arquitectura/decisiones.md): violeta = bloqueada,
 * cian = contigua a un Contacto preventivo (color propio, que no usa ningún estado).
 * Índigo (Asignada) y violeta (Bloqueada) están cerca de matiz: la bloqueada se distingue además por
 * el ícono + texto de su marca, como antes.
 *
 * Lo usan la grilla (BedsView) y la leyenda del mapa (App.tsx): cambiar un tono acá lo cambia en los
 * dos. El PDF dibuja con sus propios colores (jsPDF, los mismos: rojo / índigo / verde / ámbar / gris)
 * y no pasa por acá.
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
  [BedStatus.OCCUPIED]: { label: "Ocupada", corto: "Ocupada", tono: "peligro", descripcion: "Con un paciente internado" },
  [BedStatus.ASSIGNED]: { label: "Asignada", corto: "Asignada", tono: "indigo", descripcion: "Reservada por un traslado en curso" },
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
 * Celda de la grilla pintada con el color del estado: tinte de fondo (100) + borde (200). La celda es
 * compacta y NO lleva pill de estado (que entren la mayor cantidad de camas por pantalla): el estado
 * ES el color, como antes del rediseño; el label va en el tooltip, la leyenda y el detalle. Sin bloques
 * saturados (§7.9): de noche el 100 / 200 son el 500 translúcido (index.css), no un pastel.
 * Literales completos para que Tailwind los genere.
 */
const CARD_TONO: Record<Tono, string> = {
  neutro: "border-border bg-muted text-muted-foreground",
  aviso: "border-amber-200 bg-amber-100",
  exito: "border-emerald-200 bg-emerald-100",
  info: "border-blue-200 bg-blue-100",
  cielo: "border-sky-200 bg-sky-100",
  indigo: "border-indigo-200 bg-indigo-100",
  violeta: "border-violet-200 bg-violet-100",
  peligro: "border-red-200 bg-red-100",
  marca: "border-brand/20 bg-brand/10",
  cian: "border-cyan-200 bg-cyan-100",
  naranja: "border-orange-200 bg-orange-100",
  amarillo: "border-yellow-200 bg-yellow-100",
};
/** Clases de la celda de una cama. Bloqueada / contigua a preventivo pintan la celda con su marca (violeta /
 *  cian) en vez del estado, como antes; el estado real se lee en el tooltip y en el detalle. */
export const cardEstadoCama = (status: BedStatus | string, marca?: "bloqueada" | "preventivo"): string =>
  CARD_TONO[marca ? MARCAS_CAMA[marca].tono : estadoCama(status).tono];

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
  bloqueada: { label: "Bloqueada", tono: "violeta", icono: ShieldX, descripcion: "Paciente aislado en la habitación: no se asigna" },
  /** Cama libre junto a un "Contacto preventivo": se puede usar, con precaución. */
  preventivo: { label: "Contacto prev.", tono: "cian", icono: ShieldAlert, descripcion: "Contacto preventivo en la habitación: habilitada, con precaución" },
  /** Paciente quirúrgico (PROGAL) pendiente de su cirugía en esta internación. */
  quirurgico: { label: "Q", tono: "aviso", icono: Activity, descripcion: "Paciente quirúrgico pendiente de su cirugía" },
  /** Admisión habilitó una cirugía (clínico → quirúrgico, o nueva cirugía de un quirúrgico). */
  vaCirugia: { label: "C→Q", tono: "violeta", icono: Activity, descripcion: "Admisión lo habilitó para cirugía" },
  ayuno: { label: "Ayuno", tono: "aviso", icono: UtensilsCrossed, descripcion: "Ayuno programado vigente" },
  comandaPendiente: { label: "Comanda", tono: "indigo", icono: Utensils, descripcion: "Comanda pendiente de entregar" },
  comandaEntregada: { label: "Entregada", tono: "exito", icono: Utensils, descripcion: "Comanda cargada y ya entregada" },
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

/** Anillo de la card de una cama aislada, del color de la cartelería del PRIMER aislamiento (como antes
 *  del rediseño: el aislamiento se ve de lejos; el nombre va en el chip de adentro). */
const ANILLO_AISLAMIENTO: Record<string, string> = {
  pink: "ring-pink-400",
  slate: "ring-muted-foreground",
  green: "ring-green-400",
  blue: "ring-blue-400",
  yellow: "ring-yellow-400",
  orange: "ring-orange-400",
  teal: "ring-teal-400",
  amber: "ring-amber-700",
  fuchsia: "ring-fuchsia-400",
  violet: "ring-violet-400",
  englishGreen: "ring-emerald-800",
};
export const anilloAislamiento = (color?: string): string =>
  `ring-2 ring-offset-1 ring-offset-background ${(color && ANILLO_AISLAMIENTO[color]) || ANILLO_AISLAMIENTO.violet}`;

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
