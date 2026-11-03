import type { ReactNode } from "react"
import { InfoIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { numero } from "@/lib/formato"
import { cn } from "@/lib/utils"

/** Grilla de 3–6 KPIs: 2 columnas en mobile y se acomoda sola hacia arriba. */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="kpi-grid"
      className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3 md:gap-4", className)}
    >
      {children}
    </div>
  )
}

export interface KpiProps {
  etiqueta: string
  valor: ReactNode
  /** `valor` en la unidad de `sufijo` (por defecto " %"). `invertido`: bajar es bueno. */
  delta?: { valor: number; sufijo?: string; invertido?: boolean }
  ayuda?: string
  className?: string
}

/**
 * Tarjeta de métrica (KpiCard del kit, DESIGN §2 y §3.4): micro-label arriba, valor
 * grande, y al pie el delta como chip verde/rojo según si el cambio es bueno.
 */
export function Kpi({ etiqueta, valor, delta, ayuda, className }: KpiProps) {
  const bueno = delta ? (delta.invertido ? delta.valor <= 0 : delta.valor >= 0) : true
  const sube = (delta?.valor ?? 0) >= 0
  const Flecha = sube ? TrendingUpIcon : TrendingDownIcon

  return (
    <div
      data-slot="kpi"
      className={cn("@container min-w-0 rounded-lg border bg-card p-4 text-card-foreground shadow-xs", className)}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="truncate text-[11px] font-semibold tracking-wider uppercase">{etiqueta}</span>
        {ayuda && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Qué es ${etiqueta}`}
                className="-m-1 shrink-0 rounded-sm p-1 outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <InfoIcon className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{ayuda}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {/* Nunca se trunca: si no entra, achica (container query) y en último caso corta línea. */}
      <div className="mt-1.5 text-lg leading-tight font-bold tracking-tight wrap-break-word @[13rem]:text-2xl">{valor}</div>
      {delta && (
        <div className="mt-3 flex items-center gap-2 border-t pt-2.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
              bueno ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            )}
          >
            <Flecha className="size-3.5" aria-hidden="true" />
            {sube ? "+" : "−"}
            {numero(Math.abs(delta.valor), { decimales: 1 })}
            {delta.sufijo ?? " %"}
          </span>
          <span className="sr-only">{bueno ? "(mejora)" : "(empeora)"}</span>
        </div>
      )}
    </div>
  )
}
