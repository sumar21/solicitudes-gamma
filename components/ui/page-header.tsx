import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface PageHeaderProps {
  titulo: string
  descripcion?: ReactNode
  acciones?: ReactNode
  className?: string
}

/**
 * Título de la página (va adentro de la página, no en el AppShell).
 * Mobile: título arriba y acciones abajo a lo ancho; sm+: acciones a la derecha.
 */
export function PageHeader({ titulo, descripcion, acciones, className }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-balance sm:text-2xl">{titulo}</h1>
        {descripcion && <div className="mt-1 text-sm text-muted-foreground">{descripcion}</div>}
      </div>
      {acciones && (
        <div className="flex flex-wrap items-center gap-2 *:max-sm:flex-1 sm:shrink-0">{acciones}</div>
      )}
    </header>
  )
}
