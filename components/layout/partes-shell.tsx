import * as React from "react"
import { Download, LogOut, Monitor, Moon, RefreshCw, Sun, UserRound, type LucideIcon } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTema, type Tema } from "@/lib/tema"
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
 * Bloque de usuario del header desktop (DESIGN §8.6): nombre + sede (u operador) a la derecha, con
 * borde a la izquierda, y el avatar. En mobile queda solo el avatar.
 */
export function BloqueUsuario({ nombre, detalle }: { nombre: string; detalle: string }) {
  return (
    <div className="flex items-center gap-3 md:border-l md:pl-4">
      <div className="hidden text-right leading-tight lg:block">
        <div className="text-sm font-medium">{nombre}</div>
        <div className="text-xs text-muted-foreground">{detalle}</div>
      </div>
      <Avatar className="size-9">
        <AvatarFallback className="bg-brand/10 text-xs font-semibold text-brand">{iniciales(nombre)}</AvatarFallback>
      </Avatar>
    </div>
  )
}

const OPCIONES_TEMA: { valor: Tema; label: string; icono: LucideIcon }[] = [
  { valor: "claro", label: "Claro", icono: Sun },
  { valor: "oscuro", label: "Oscuro", icono: Moon },
  { valor: "sistema", label: "Según el sistema", icono: Monitor },
]

/** Selector de tema del header (DESIGN §5): claro / oscuro / según el sistema, con useTema(). */
export function SelectorTema() {
  const { tema, resuelto, setTema } = useTema()
  const Icono = resuelto === "oscuro" ? Moon : Sun
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" aria-label="Tema">
              <Icono className="size-5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Tema</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={tema} onValueChange={(v) => setTema(v as Tema)}>
          {OPCIONES_TEMA.map(({ valor, label, icono: I }) => (
            <DropdownMenuRadioItem key={valor} value={valor}>
              <I className="size-4 text-muted-foreground" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AccionPie({
  icono: Icono,
  label,
  compacto,
  peligro,
  girando,
  ...props
}: React.ComponentProps<"button"> & { icono: LucideIcon; label: string; compacto: boolean; peligro?: boolean; girando?: boolean }) {
  const boton = (
    <Button
      type="button"
      variant="ghost"
      aria-label={compacto ? label : undefined}
      className={cn(
        "h-9 w-full gap-3 px-3 text-sm font-normal",
        compacto ? "justify-center px-0" : "justify-start",
        // Sidebar oscura (verde / pizarra): el rojo de `destructive` da 2,6:1 encima; el 300 pasa 5:1 en las dos.
        peligro
          ? "text-red-300 hover:bg-sidebar-accent"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      )}
      {...props}
    >
      <Icono className={cn("size-4 shrink-0", girando && "animate-spin")} aria-hidden="true" />
      {!compacto && <span className="truncate">{label}</span>}
    </Button>
  )
  if (!compacto) return boton
  return (
    <Tooltip>
      <TooltipTrigger asChild>{boton}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Pie de la sidebar (DESIGN §8.5): las acciones de sesión como botones directos —cambio de turno,
 * actualizar accesos, instalar, salir en `text-destructive`— y la versión. Colapsada: solo íconos.
 */
export function PieSesion({
  compacto,
  operador,
  sincronizando,
  onActualizarAccesos,
  onCambioTurno,
  onInstalar,
  onSalir,
}: {
  compacto: boolean
  operador?: string | null
  sincronizando: boolean
  onActualizarAccesos: () => void
  onCambioTurno?: () => void
  onInstalar?: () => void
  onSalir: () => void
}) {
  return (
    <div className="flex w-full flex-col gap-0.5">
      {onCambioTurno && (
        <AccionPie
          icono={UserRound}
          label={operador ? `Cambio de turno · ${operador}` : "Cambio de turno"}
          compacto={compacto}
          onClick={onCambioTurno}
        />
      )}
      <AccionPie icono={RefreshCw} label="Actualizar accesos" compacto={compacto} girando={sincronizando} disabled={sincronizando} onClick={onActualizarAccesos} />
      {onInstalar && <AccionPie icono={Download} label="Instalar app" compacto={compacto} onClick={onInstalar} />}
      <AccionPie icono={LogOut} label="Salir" compacto={compacto} peligro onClick={onSalir} />
      {!compacto && (
        <div className="px-3 pt-1 font-mono text-[10px] text-sidebar-foreground/50 select-all" title="Versión del cliente">
          {APP_VERSION}
        </div>
      )}
    </div>
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
