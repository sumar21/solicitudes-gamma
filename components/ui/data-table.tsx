import * as React from "react"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { numero } from "@/lib/formato"
import { cn } from "@/lib/utils"

export interface Columna<T> {
  id: string
  titulo: string
  celda(f: T): React.ReactNode
  alinear?: "izq" | "der"
  /** Columna secundaria: "md" se oculta en tablet (aparece desde lg); "lg" aparece recién desde xl. */
  ocultarEn?: "md" | "lg"
  /** Si está, la columna se puede ordenar por este valor. */
  ordenar?(f: T): string | number
}

// El tipo de fila se infiere solo de `filas` (NoInfer en el resto), así
// `onFila={setSeleccionado}` no ensucia la inferencia.
export interface DataTableProps<T> {
  filas: T[]
  columnas: Columna<NoInfer<T>>[]
  clave(f: NoInfer<T>): string
  /** Tarjeta para mobile (< md). Sin esto se arma una automática con las columnas. */
  tarjeta?(f: NoInfer<T>): React.ReactNode
  onFila?(f: NoInfer<T>): void
  porPagina?: number
  vacio?: React.ReactNode
  cargando?: boolean
  /** Si la carga falló: muestra ErrorEstado con "Reintentar". */
  error?: { mensaje?: string; onReintentar(): void }
  className?: string
}

type Orden = { id: string; dir: "asc" | "desc" } | null

const OCULTAR: Record<NonNullable<Columna<unknown>["ocultarEn"]>, string> = {
  md: "hidden lg:table-cell",
  lg: "hidden xl:table-cell",
}

const comparador = new Intl.Collator("es", { numeric: true, sensitivity: "base" })

function comparar(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") return a - b
  return comparador.compare(String(a), String(b))
}

/** Enter o espacio sobre una fila/tarjeta clickeable = click. */
function alTeclado(accion: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      accion()
    }
  }
}

/**
 * Tabla de listado del kit. Desktop (md+): tabla densa en una card, con orden
 * por columna (`aria-sort`) y paginación client-side. Mobile: lista de tarjetas
 * (las de `tarjeta` o una automática con todas las columnas).
 */
export function DataTable<T>({
  filas,
  columnas,
  clave,
  tarjeta,
  onFila,
  porPagina = 20,
  vacio,
  cargando = false,
  error,
  className,
}: DataTableProps<T>) {
  const [orden, setOrden] = React.useState<Orden>(null)
  const [pagina, setPagina] = React.useState(0)

  const ordenadas = React.useMemo(() => {
    const col = orden && columnas.find((c) => c.id === orden.id)
    if (!col?.ordenar || !orden) return filas
    const valor = col.ordenar
    const signo = orden.dir === "asc" ? 1 : -1
    return [...filas].sort((a, b) => signo * comparar(valor(a), valor(b)))
  }, [filas, columnas, orden])

  const total = ordenadas.length
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  // Si cambian los filtros y quedan menos filas, no nos quedamos en una página vacía.
  const actual = Math.min(pagina, paginas - 1)
  const desde = actual * porPagina
  const visibles = ordenadas.slice(desde, desde + porPagina)

  const cambiarOrden = (id: string) => {
    setPagina(0)
    setOrden((o) => (o?.id !== id ? { id, dir: "asc" } : o.dir === "asc" ? { id, dir: "desc" } : null))
  }

  if (cargando) return <Cargando className={className} />
  if (error) return <ErrorEstado className={className} descripcion={error.mensaje} onReintentar={error.onReintentar} />
  if (total === 0) return <div className={className}>{vacio ?? <Vacio titulo="Sin resultados" />}</div>

  return (
    <div data-slot="data-table" className={cn("flex flex-col gap-3", className)}>
      {/* Mobile: tarjetas */}
      <ul className="flex flex-col gap-2 md:hidden">
        {visibles.map((f) => {
          const contenido = tarjeta ? tarjeta(f) : <TarjetaAuto fila={f} columnas={columnas} />
          return (
            <li key={clave(f)}>
              {onFila ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onFila(f)}
                  onKeyDown={alTeclado(() => onFila(f))}
                  className="block w-full rounded-lg border bg-card p-3 text-left text-card-foreground shadow-xs ring-offset-background transition-all outline-hidden active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {contenido}
                </div>
              ) : (
                <div className="rounded-lg border bg-card p-3 text-card-foreground shadow-xs">{contenido}</div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Desktop: tabla */}
      <div className="hidden overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columnas.map((c) => {
                const activo = orden?.id === c.id ? orden.dir : null
                return (
                  <TableHead
                    key={c.id}
                    aria-sort={c.ordenar ? (activo === "asc" ? "ascending" : activo === "desc" ? "descending" : "none") : undefined}
                    className={cn(der(c) && "text-right", c.ocultarEn && OCULTAR[c.ocultarEn])}
                  >
                    {c.ordenar ? (
                      <button
                        type="button"
                        onClick={() => cambiarOrden(c.id)}
                        className={cn(
                          "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 uppercase outline-hidden transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                          der(c) && "flex-row-reverse",
                          activo && "text-foreground"
                        )}
                      >
                        {c.titulo}
                        {activo === "asc" ? (
                          <ArrowUpIcon className="size-3" aria-hidden="true" />
                        ) : activo === "desc" ? (
                          <ArrowDownIcon className="size-3" aria-hidden="true" />
                        ) : (
                          <ArrowUpDownIcon className="size-3 opacity-40" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      c.titulo
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map((f) => (
              <TableRow
                key={clave(f)}
                tabIndex={onFila ? 0 : undefined}
                onClick={onFila ? () => onFila(f) : undefined}
                onKeyDown={onFila ? alTeclado(() => onFila(f)) : undefined}
                className={cn(
                  onFila &&
                    "cursor-pointer outline-hidden focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                )}
              >
                {columnas.map((c) => (
                  <TableCell
                    key={c.id}
                    className={cn(der(c) && "text-right tabular-nums", c.ocultarEn && OCULTAR[c.ocultarEn])}
                  >
                    {c.celda(f)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Paginación */}
      <nav aria-label="Paginación" className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <p aria-live="polite" className="tabular-nums">
          {numero(desde + 1)}–{numero(desde + visibles.length)} de {numero(total)}
        </p>
        {paginas > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={actual === 0} onClick={() => setPagina(actual - 1)}>
              <ChevronLeftIcon />
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={actual >= paginas - 1} onClick={() => setPagina(actual + 1)}>
              Siguiente
              <ChevronRightIcon />
            </Button>
          </div>
        )}
      </nav>
    </div>
  )
}

/** Tarjeta automática: la primera columna es el título; el resto, pares etiqueta–valor. */
function TarjetaAuto<T>({ fila, columnas }: { fila: T; columnas: Columna<T>[] }) {
  const [primera, ...resto] = columnas
  return (
    <div className="flex flex-col gap-2">
      {primera && <div className="text-sm font-medium">{primera.celda(fila)}</div>}
      {resto.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          {resto.map((c) => (
            <React.Fragment key={c.id}>
              <dt className="self-center text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {c.titulo}
              </dt>
              <dd className={cn("min-w-0 text-right", der(c) && "tabular-nums")}>{c.celda(fila)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  )
}

function der<T>(c: Columna<T>) {
  return c.alinear === "der"
}
