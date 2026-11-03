import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Tonos de estado (DESIGN.md §3.11 y §1.4 "Paleta semántica completa"). Un tono por etapa del
 * circuito; cada app mapea sus estados a tonos en lib/estados.ts. Los tonos que conviven en una
 * columna tienen que separarse ≥ 25° de matiz (índigo y violeta NO: 15°).
 */
export type Tono =
  | "neutro" // cerrado / anulado
  | "aviso" // ámbar: pendiente, falta algo
  | "exito" // esmeralda: listo / resuelto
  | "info" // azul: comprometido / en curso
  | "cielo" // sky: pospuesto / todavía no empezó
  | "indigo" // en proceso
  | "violeta" // despachado / el otro signo
  | "peligro" // rojo: cancelado / error
  | "marca" // etiqueta propia del cliente (no estado)

const TONOS: Record<Tono, string> = {
  neutro: "bg-muted text-muted-foreground",
  aviso: "bg-amber-100 text-amber-700",
  exito: "bg-emerald-100 text-emerald-700",
  info: "bg-blue-100 text-blue-700",
  cielo: "bg-sky-100 text-sky-700",
  indigo: "bg-indigo-100 text-indigo-700",
  violeta: "bg-violet-100 text-violet-700",
  peligro: "bg-red-100 text-red-700",
  marca: "bg-brand/10 text-brand",
}

/** Punto del color de un tono (opciones de filtro, leyendas). */
export const PUNTO_TONO: Record<Tono, string> = {
  neutro: "bg-muted-foreground",
  aviso: "bg-amber-500",
  exito: "bg-emerald-500",
  info: "bg-blue-500",
  cielo: "bg-sky-500",
  indigo: "bg-indigo-500",
  violeta: "bg-violet-500",
  peligro: "bg-red-500",
  marca: "bg-brand",
}

// Pill de estado (§3.11): rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide.
export function StatusBadge({ tono, children, className }: { tono: Tono; children: ReactNode; className?: string }) {
  return (
    <span
      data-slot="status-badge"
      data-tono={tono}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap uppercase",
        TONOS[tono],
        className
      )}
    >
      {children}
    </span>
  )
}
