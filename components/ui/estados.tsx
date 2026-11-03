import type { ReactNode } from "react"
import { AlertCircleIcon, InboxIcon, RotateCwIcon, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Loader del kit (DESIGN §3.7): anillo que gira + halo que late + burbuja con
 * un punto de marca en el centro. Para la carga de una página o lista.
 */
export function Cargando({ texto = "Cargando…", className }: { texto?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="cargando"
      className={cn("flex flex-col items-center justify-center py-16 text-center animate-in fade-in duration-500", className)}
    >
      <div className="relative size-14">
        <span className="absolute inset-0 rounded-full bg-primary/10 animate-ping motion-reduce:animate-none" />
        <span className="absolute inset-0 rounded-full border-2 border-primary/15 border-t-primary animate-spin motion-reduce:animate-none" />
        <span className="absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full border border-primary/10 bg-background shadow-xs">
          <span className="size-2.5 rounded-full bg-brand animate-pulse motion-reduce:animate-none" />
        </span>
      </div>
      <p className="mt-4 text-sm font-medium text-muted-foreground">{texto}</p>
    </div>
  )
}

/** Estado vacío canónico (DESIGN §3.7): borde punteado + ícono en círculo. */
export function Vacio({
  icono: Icono = InboxIcon,
  titulo,
  descripcion,
  accion,
  className,
}: {
  icono?: LucideIcon
  titulo: string
  descripcion?: ReactNode
  accion?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="vacio"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/20 px-6 py-12 text-center",
        className
      )}
    >
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
        <Icono className="size-8 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold">{titulo}</p>
      {descripcion && <div className="mt-1 max-w-sm text-sm text-balance text-muted-foreground">{descripcion}</div>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  )
}

/** Error de carga: círculo rojo con el ícono y un "Reintentar". */
export function ErrorEstado({
  titulo = "No pudimos cargar los datos",
  descripcion = "Revisá tu conexión y probá de nuevo.",
  onReintentar,
  className,
}: {
  titulo?: string
  descripcion?: ReactNode
  onReintentar: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      data-slot="error-estado"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center animate-in fade-in slide-in-from-top-2",
        className
      )}
    >
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircleIcon className="size-8 text-destructive" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold">{titulo}</p>
      {descripcion && <div className="mt-1 max-w-sm text-sm text-balance text-muted-foreground">{descripcion}</div>}
      <Button variant="outline" className="mt-4" onClick={onReintentar}>
        <RotateCwIcon />
        Reintentar
      </Button>
    </div>
  )
}
