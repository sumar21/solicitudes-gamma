import * as React from "react"
import { MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * MediFlow no tiene router: la vista actual vive en useHospitalState (`currentView`). Por eso el
 * ítem lleva un `id` en vez de `to`, y el shell recibe `activo` y `onNavegar`.
 */
export interface ItemNav {
  id: string
  label: string
  icon: LucideIcon
  grupo?: string
  badge?: number
  /** Va anclado al pie de la sidebar, arriba de las acciones de sesión (Configuración, DESIGN §8.5). */
  abajo?: boolean
}

export interface AppShellProps {
  nav: ItemNav[]
  marca: React.ReactNode
  /** Logo solo (sin nombre) para la sidebar colapsada. Si no viene, colapsada no muestra logo. */
  marcaCompacta?: React.ReactNode
  usuario?: React.ReactNode
  /** Avatar solo (con su menú) para la sidebar colapsada. Si no viene, colapsada no muestra usuario. */
  usuarioCompacto?: React.ReactNode
  acciones?: React.ReactNode
  /** Dónde está el usuario: breadcrumb "Sede / Vista" + ayuda, a la izquierda del header desktop (DESIGN §8.6). */
  ubicacion?: React.ReactNode
  /** Nombre del módulo en el header mobile (DESIGN §5.10: `truncate text-lg font-bold`). */
  tituloMobile?: React.ReactNode
  /** Avisos de toda la app (sesión por vencer, notificaciones), a lo ancho debajo del header. */
  avisos?: React.ReactNode
  /** Columna derecha opcional (el celular del portal). Se muestra desde xl. */
  lateral?: React.ReactNode
  /** id del ítem activo y qué hacer al elegir uno. */
  activo: string
  onNavegar: (id: string) => void
  /** false = el contenido va sin márgenes ni ancho máximo (las vistas ponen el suyo). */
  relleno?: boolean
  children: React.ReactNode
}

const CLAVE_COLAPSADO = "sumar:sidebar-colapsado"

function leerColapsado() {
  try {
    return localStorage.getItem(CLAVE_COLAPSADO) === "1"
  } catch {
    return false
  }
}

/** Agrupa respetando el orden en que aparece cada grupo; los sin grupo van primero. */
function agrupar(nav: ItemNav[]) {
  const grupos = new Map<string, ItemNav[]>()
  for (const item of nav) {
    const g = item.grupo ?? ""
    if (!grupos.has(g)) grupos.set(g, [])
    grupos.get(g)!.push(item)
  }
  return [...grupos.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0))
}

const conteo = (n: number) => (n > 99 ? "99+" : String(n))

function ItemNavLink({ item, activo, colapsado, onNavegar }: { item: ItemNav; activo: boolean; colapsado: boolean; onNavegar: () => void }) {
  const Icono = item.icon
  const link = (
    <button
      type="button"
      onClick={onNavegar}
      aria-current={activo ? "page" : undefined}
      aria-label={colapsado ? (item.badge ? `${item.label} (${item.badge})` : item.label) : undefined}
      // `active` como lo pone NavLink en el kit, así las clases son las mismas.
      className={cn(
        activo && "active",
        "relative flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/70 ring-offset-sidebar transition-colors outline-hidden hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1",
        "[&.active]:bg-sidebar-accent [&.active]:font-medium [&.active]:text-sidebar-foreground",
        colapsado && "justify-center px-0"
      )}
    >
      <Icono className="size-4 shrink-0" aria-hidden="true" />
      {!colapsado && <span className="truncate">{item.label}</span>}
      {!!item.badge &&
        (colapsado ? (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-bold text-destructive-foreground tabular-nums ring-2 ring-sidebar">
            {conteo(item.badge)}
          </span>
        ) : (
          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] leading-none font-bold text-destructive-foreground tabular-nums">
            {conteo(item.badge)}
          </span>
        ))}
    </button>
  )

  if (!colapsado) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

function Navegacion({
  nav,
  activo,
  colapsado = false,
  onNavegar,
}: {
  nav: ItemNav[]
  activo: string
  colapsado?: boolean
  onNavegar: (id: string) => void
}) {
  return (
    <nav aria-label="Principal" className="flex flex-col gap-4">
      {agrupar(nav).map(([grupo, items]) => (
        <div key={grupo || "_"} className="flex flex-col gap-0.5">
          {grupo &&
            (colapsado ? (
              <div role="separator" className="mx-2 mb-1 h-px bg-sidebar-border" />
            ) : (
              <p className="px-3 pb-1 text-[10px] font-semibold tracking-wider text-sidebar-foreground/70 uppercase">{grupo}</p>
            ))}
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.id}>
                <ItemNavLink item={item} activo={item.id === activo} colapsado={colapsado} onNavegar={() => onNavegar(item.id)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/**
 * Esqueleto de la app del Estilo 1 (copia del kit, sin router: ver ItemNav).
 * - Desktop (md+): sidebar fija de 240px (colapsable a riel de íconos con tooltip),
 *   header delgado con las acciones a la derecha y el contenido con scroll propio.
 *   Colapsada (64px, DESIGN §4.1): arriba `marcaCompacta` (el isotipo); al pie, el
 *   botón de expandir y `usuarioCompacto` (el avatar). Sin `marcaCompacta`, el botón
 *   queda arriba como siempre.
 * - Mobile: header con menú (Sheet izquierdo con la navegación), marca y acciones.
 * - xl+: `lateral` como columna derecha (abajo de xl no se muestra: la app lo dibuja flotante).
 */
export function AppShell({
  nav,
  marca,
  marcaCompacta,
  usuario,
  usuarioCompacto,
  acciones,
  ubicacion,
  tituloMobile,
  avisos,
  lateral,
  activo,
  onNavegar,
  relleno = true,
  children,
}: AppShellProps) {
  const [colapsado, setColapsado] = React.useState(leerColapsado)
  const navArriba = nav.filter((i) => !i.abajo)
  const navAbajo = nav.filter((i) => i.abajo)
  const [menuAbierto, setMenuAbierto] = React.useState(false)
  const contenido = React.useRef<HTMLElement>(null)

  // Cada pantalla arranca arriba (el scroll es del <main>, no de la ventana).
  React.useEffect(() => {
    contenido.current?.scrollTo({ top: 0 })
  }, [activo])

  const alternar = () => {
    setColapsado((c) => {
      try {
        localStorage.setItem(CLAVE_COLAPSADO, c ? "0" : "1")
      } catch {
        /* sin storage: no pasa nada */
      }
      return !c
    })
  }

  const botonColapsar = (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={alternar}
      aria-label={colapsado ? "Expandir menú" : "Colapsar menú"}
      className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-sidebar-ring"
    >
      {colapsado ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
    </Button>
  )

  return (
    <div data-slot="app-shell" className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* Sidebar desktop */}
      <aside
        data-colapsado={colapsado}
        className={cn(
          "z-nav hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-in-out motion-reduce:transition-none md:flex",
          colapsado ? "w-16" : "w-64"
        )}
      >
        <div className={cn("flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border", colapsado ? "justify-center px-2" : "px-4")}>
          {colapsado ? (
            (marcaCompacta ?? botonColapsar)
          ) : (
            <>
              <div className="min-w-0 flex-1 truncate">{marca}</div>
              {botonColapsar}
            </>
          )}
        </div>
        <div className={cn("flex-1 overflow-x-hidden overflow-y-auto py-4", colapsado ? "px-2" : "px-3")}>
          <Navegacion nav={navArriba} activo={activo} colapsado={colapsado} onNavegar={onNavegar} />
        </div>
        {navAbajo.length > 0 && (
          <div className={cn("shrink-0 border-t border-sidebar-border py-3", colapsado ? "px-2" : "px-3")}>
            <Navegacion nav={navAbajo} activo={activo} colapsado={colapsado} onNavegar={onNavegar} />
          </div>
        )}
        {colapsado
          ? (marcaCompacta || usuarioCompacto) && (
              <div className="flex shrink-0 flex-col items-center gap-2 border-t border-sidebar-border p-3">
                {marcaCompacta && (
                  <Tooltip>
                    <TooltipTrigger asChild>{botonColapsar}</TooltipTrigger>
                    <TooltipContent side="right">Expandir menú</TooltipContent>
                  </Tooltip>
                )}
                {usuarioCompacto}
              </div>
            )
          : usuario && <div className="shrink-0 border-t border-sidebar-border p-3">{usuario}</div>}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header mobile */}
        <header className="z-header flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMenuAbierto(true)} aria-label="Abrir menú" className="-ml-2">
            <MenuIcon className="size-6" />
          </Button>
          <div className="min-w-0 flex-1 truncate">{tituloMobile ?? ubicacion ?? marca}</div>
          {acciones && <div className="flex shrink-0 items-center gap-1">{acciones}</div>}
        </header>

        {/* Header desktop: ubicación a la izquierda, acciones a la derecha */}
        {(ubicacion || acciones) && (
          <header className="z-nav hidden h-16 shrink-0 items-center justify-between gap-4 border-b bg-background px-6 md:flex">
            <div className="min-w-0 flex-1">{ubicacion}</div>
            {acciones && <div className="flex shrink-0 items-center gap-2">{acciones}</div>}
          </header>
        )}

        {avisos}

        <div className="flex min-h-0 flex-1">
          <main ref={contenido} id="contenido" className="relative min-w-0 flex-1 overscroll-y-contain overflow-y-auto bg-secondary/30">
            {relleno ? <div className="mx-auto w-full max-w-7xl px-4 py-5 md:px-8 md:py-8">{children}</div> : children}
          </main>
          {lateral && (
            <aside aria-label="Panel lateral" className="hidden w-[420px] shrink-0 overflow-y-auto border-l bg-muted/30 xl:block">
              {lateral}
            </aside>
          )}
        </div>
      </div>

      {/* Navegación mobile: drawer izquierdo */}
      <Sheet open={menuAbierto} onOpenChange={setMenuAbierto}>
        <SheetContent
          side="left"
          // La cruz del Sheet viene en muted-foreground; sobre la sidebar va con sus tokens (puede ser de color).
          className="gap-0 bg-sidebar p-0 text-sidebar-foreground md:hidden [&>[data-slot=sheet-close]]:text-sidebar-foreground/70 [&>[data-slot=sheet-close]]:hover:bg-sidebar-accent [&>[data-slot=sheet-close]]:hover:text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Menú</SheetTitle>
          <SheetDescription className="sr-only">Navegación principal</SheetDescription>
          <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-4 pr-12">
            <div className="min-w-0 truncate">{marca}</div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <Navegacion
              nav={navArriba}
              activo={activo}
              onNavegar={(id) => {
                onNavegar(id)
                setMenuAbierto(false)
              }}
            />
          </div>
          {navAbajo.length > 0 && (
            <div className="shrink-0 border-t border-sidebar-border px-3 py-3">
              <Navegacion
                nav={navAbajo}
                activo={activo}
                onNavegar={(id) => {
                  onNavegar(id)
                  setMenuAbierto(false)
                }}
              />
            </div>
          )}
          {usuario && <div className="shrink-0 border-t border-sidebar-border p-3">{usuario}</div>}
        </SheetContent>
      </Sheet>
    </div>
  )
}
