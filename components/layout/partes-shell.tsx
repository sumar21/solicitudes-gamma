import * as React from "react"
import { Download, LogOut, RefreshCw, UserRound } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { APP_VERSION } from "@/lib/version"
import { cn } from "@/lib/utils"

const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

/**
 * Menú del usuario al pie de la sidebar (DESIGN §4.1): avatar + nombre + sede (u operador) y las
 * acciones de sesión. `compacto` = solo el avatar, para la sidebar colapsada.
 */
export function MenuUsuario({
  compacto,
  nombre,
  detalle,
  sincronizando,
  onActualizarAccesos,
  onCambioTurno,
  onInstalar,
  onSalir,
}: {
  compacto: boolean
  nombre: string
  detalle: string
  sincronizando: boolean
  onActualizarAccesos: () => void
  onCambioTurno?: () => void
  onInstalar?: () => void
  onSalir: () => void
}) {
  const avatar = (
    <Avatar className="size-8">
      <AvatarFallback className="bg-sidebar-accent text-xs text-sidebar-accent-foreground">{iniciales(nombre)}</AvatarFallback>
    </Avatar>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Menú de usuario: ${nombre}`}
          className={cn(
            "rounded-md text-left outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            compacto ? "rounded-full" : "flex w-full min-w-0 items-center gap-2 p-1 hover:bg-sidebar-accent"
          )}
        >
          {avatar}
          {!compacto && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium">{nombre}</div>
              <div className="truncate text-xs text-sidebar-foreground/70">{detalle}</div>
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compacto ? "end" : "start"} side={compacto ? "right" : "top"} className="w-60">
        <DropdownMenuLabel className="font-normal tracking-normal normal-case">
          <div className="truncate text-sm font-medium">{nombre}</div>
          <div className="truncate text-xs text-muted-foreground">{detalle}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {onCambioTurno && (
          <DropdownMenuItem onSelect={onCambioTurno}>
            <UserRound /> Cambio de turno
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={sincronizando} onSelect={(e) => { e.preventDefault(); onActualizarAccesos() }}>
          <RefreshCw className={cn(sincronizando && "animate-spin")} /> Actualizar accesos
        </DropdownMenuItem>
        {onInstalar && (
          <DropdownMenuItem onSelect={onInstalar}>
            <Download /> Instalar app
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onSalir}>
          <LogOut /> Salir
        </DropdownMenuItem>
        <div className="px-2 pt-1 pb-0.5 font-mono text-[10px] text-muted-foreground select-all" title="Versión del cliente">
          {APP_VERSION}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const TONOS_AVISO = {
  peligro: "border-destructive/20 bg-destructive/10 text-destructive",
  aviso: "border-warning/20 bg-warning/10 text-warning",
} as const

/** Franja de aviso de toda la app, debajo del header (sesión por vencer, notificaciones). */
export function Aviso({ tono, accion, children }: { tono: keyof typeof TONOS_AVISO; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="status" className={cn("flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 md:px-6", TONOS_AVISO[tono])}>
      <p className="flex min-w-0 items-center gap-2 text-xs font-medium">
        <span className="size-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
        <span className="min-w-0">{children}</span>
      </p>
      {accion && <div className="shrink-0">{accion}</div>}
    </div>
  )
}

/**
 * Pastilla "Entorno de prueba" del header. Va en el color de la sidebar, que en TESTING es gris
 * pizarra: así la pastilla y la sidebar dicen lo mismo.
 */
export function EntornoDePrueba() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sidebar px-2 py-0.5 text-[10px] font-semibold tracking-wide text-sidebar-foreground uppercase">
      <span className="size-1.5 animate-pulse rounded-full bg-sidebar-primary motion-reduce:animate-none" aria-hidden="true" />
      <span className="hidden xs:inline">Entorno de prueba</span>
      <span className="xs:hidden">Test</span>
    </span>
  )
}
