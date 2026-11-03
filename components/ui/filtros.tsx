import * as React from "react"
import { ChevronDown, ChevronUp, SlidersHorizontal, X, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Filtros (DESIGN.md §4.7, patrón C): un filtro NO es un modal. Botón "Filtros" en el header de la
 * página (con el conteo de activos) que muestra u oculta una barra inline con los campos. La vista
 * decide si la barra se ve (`useState`) y tiene el estado de los filtros.
 *
 *   <BotonFiltros abierto={ver} activos={n} onClick={() => setVer(v => !v)} />
 *   {ver && (
 *     <BarraFiltros activos={n} onLimpiar={limpiar}>
 *       <CampoFiltro icono={CircleDot} label="Estado"><MultiCombobox … /></CampoFiltro>
 *     </BarraFiltros>
 *   )}
 */

// Toggle: abierto `border-brand/30 bg-brand/[0.06] text-brand`; conteo `rounded-full bg-brand`.
export function BotonFiltros({
  abierto,
  activos,
  className,
  ...props
}: React.ComponentProps<"button"> & { abierto: boolean; activos: number }) {
  return (
    <button
      type="button"
      aria-expanded={abierto}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        abierto ? "border-brand/30 bg-brand/[0.06] text-brand" : "bg-background text-muted-foreground hover:text-foreground",
        className
      )}
      {...props}
    >
      <SlidersHorizontal className="size-4 text-brand" aria-hidden="true" />
      <span className="hidden sm:inline">Filtros</span>
      {activos > 0 && (
        <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] leading-none font-bold text-brand-foreground tabular-nums">
          {activos}
        </span>
      )}
      {abierto ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
    </button>
  )
}

// Barra: panel inline `rounded-xl border bg-muted/20 p-3`, campos en `flex flex-wrap items-end gap-3`.
export function BarraFiltros({
  activos,
  onLimpiar,
  className,
  children,
}: {
  activos: number
  onLimpiar: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("rounded-xl border bg-muted/20 p-3 animate-in fade-in slide-in-from-top-1", className)}>
      <div className="flex flex-wrap items-end gap-3">
        {children}
        {activos > 0 && (
          <button
            type="button"
            onClick={onLimpiar}
            className="flex h-10 items-center gap-1 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" /> Limpiar
          </button>
        )}
      </div>
    </div>
  )
}

// Campo: label micro con ícono de marca; ancho fijo en desktop y a lo ancho en mobile (se apilan solos).
export function CampoFiltro({
  icono: Icono,
  label,
  className,
  children,
}: {
  icono: LucideIcon
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("w-full sm:w-48", className)}>
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        <Icono className="size-3.5 text-brand" aria-hidden="true" />
        {label}
      </span>
      {children}
    </div>
  )
}
