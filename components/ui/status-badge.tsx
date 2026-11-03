import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export type Tono = "neutro" | "info" | "exito" | "aviso" | "peligro" | "marca"

// Un tono por etapa del circuito (DESIGN §1.1 y §2). Cada app mapea sus estados a
// tonos en src/lib/estados.ts. Texto = el color; superficie = el color al 10 %.
const TONOS: Record<Tono, string> = {
  neutro: "bg-muted text-muted-foreground",
  info: "bg-info/10 text-info",
  exito: "bg-success/10 text-success",
  aviso: "bg-warning/10 text-warning",
  peligro: "bg-destructive/10 text-destructive",
  marca: "bg-brand/10 text-brand",
}

/** Punto del color de un tono (chips de filtro, leyendas): mismo color que el texto del badge. */
export const PUNTO_TONO: Record<Tono, string> = {
  neutro: "bg-muted-foreground",
  info: "bg-info",
  exito: "bg-success",
  aviso: "bg-warning",
  peligro: "bg-destructive",
  marca: "bg-brand",
}

export function StatusBadge({ tono, children, className }: { tono: Tono; children: ReactNode; className?: string }) {
  return (
    <span
      data-slot="status-badge"
      data-tono={tono}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold tracking-wide whitespace-nowrap uppercase",
        TONOS[tono],
        className
      )}
    >
      {children}
    </span>
  )
}
