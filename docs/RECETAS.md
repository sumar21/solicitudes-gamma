<!-- sumar:estilo=01-minimal-zinc -->
# Estilo 1 · Minimalista zinc — Recetas recuperadas del DESIGN.md original

Recetas de composición del **DESIGN.md original del Sumar UI Kit** que no entraron (o entraron recortadas) en el `DESIGN.md` de este estilo, **adaptadas al kit**: componentes de `src/components/ui/` con la API de BASE §4, tokens de BASE §2, Tailwind 4, sin `dark:`, sin grises crudos ni hex.

- **Los números de sección son los del DESIGN.md original** (`§4.7`, `§7.2`, `§12.1`…), porque el código de los rediseños los cita así. No coinciden con los del `DESIGN.md` del estilo.
- **Ante un conflicto manda `DESIGN.md` del estilo + `BASE.md`.** Esto es el *cómo se arma*; las clases y reglas de fondo están allá.
- Lo que el kit ya tiene completo no se repite: queda una línea con `→` a dónde leerlo. Lo obsoleto está al final, en "Lo que no se trajo y por qué".
- Cuando el original usaba un componente propio que el kit no trae, acá va armado con primitivas del kit y dice **"el kit no lo trae"**. Si una app lo usa en más de una pantalla, va a `src/components/ui/` con ese nombre (no se duplica por vista).
- Caso real donde están aplicadas: MediFlow · Grupo Gamma (`solicitudes-gamma`, `views/RequestsView.tsx`, `components/ui/filtros.tsx`, `App.tsx`).

## Índice

| § original | Qué | Dónde |
|---|---|---|
| 0 · R | Arranque y refactor de un repo | `scripts/armar.mjs` · `REDISENO.md` |
| 1 | Fundaciones (stack, tokens, tipografía, radios, sombras, z-index) | `DESIGN.md` §1 · BASE §1–§2 |
| 2 | `cn`, animación de modal, cierre por fondo | BASE §4 (`cn`); el resto lo hace Radix (ver al final) |
| 3.1–3.10 | Card, Button, Input, Badge, Table, Avatar, Tabs, StatCard, Select, MoneyInput | `DESIGN.md` §2 (componentes del starter) |
| **3.11** | **StatusBadge: de la paleta vieja a los tonos** | **acá** |
| **3.12** | **Loader** | **acá** (corto) |
| 3.13 · 3.14 | Toast · Tooltip global | `DESIGN.md` §2 (`sonner`, `tooltip`) |
| **3.15** | **SuccessCard (confirmación transaccional)** | **acá** + `EJEMPLOS.md` §5 |
| 3.16 · 3.18 | Combobox / MultiCombobox · DatePicker | BASE §4 · `DESIGN.md` §2 |
| **3.17** | **CategoryMultiSelect (filtro de una dimensión)** | **acá** |
| **4.1** | **Modal de formulario canónico** | **acá** |
| 4.2 | Modal de confirmación | `DESIGN.md` §3.6 (`useConfirm`) |
| **4.3** | **Sheet de drill-down** | **acá** |
| **4.4** | **Página estándar** | **acá** |
| 4.5 | Sidebar / Layout | `DESIGN.md` §4 (`AppShell`) + §8.5 de acá |
| 4.6 · 10 | Dashboard y catálogo de gráficos | `DATAVIZ.md` (+ skills `business-intelligence` y `dataviz`) |
| **4.7** | **Filtros: botón y barra** | **acá** |
| 4.8 | Maestro → detalle | `EJEMPLOS.md` §1 |
| **5.1** | **Breakpoints por zona** | **acá** |
| **5.2** | **Toolbar responsive** | **acá** |
| **5.3** | **Grillas canónicas** | **acá** |
| **5.4** | **Columnas progresivas y tarjeta mobile** | **acá** |
| 5.5 | Modales en mobile | `DESIGN.md` §3.3 |
| 5.6 | Bottom-sheet | `EJEMPLOS.md` §4 |
| **5.7** | **Barra de acción fija** | **acá** |
| 5.8 · 5.9 · 5.10 | `dvh` · `md:contents` · nav mobile | `DESIGN.md` §4.3 · §3.1 · §4.2 |
| **5.11** | **Mostrar / ocultar por viewport** | **acá** |
| 5.12 · 5.13 | Texto responsive · targets táctiles | `DESIGN.md` §4.3 · §1.6 |
| **6.1–6.9** | **Formularios: campos, errores, textarea, opción-card, segmented, stepper, contraseña, archivos** | **acá** |
| 6.10 | Campos calculados y bloqueados | `DESIGN.md` §3.3 |
| **6.11** | **Edición inline en tablas** | **acá** |
| **6.12** | **Renglones editables** | **acá** |
| 6.13 | Importes que se calculan solos | `EJEMPLOS.md` §3 |
| 7.1 · 7.3 · 7.4 · 7.5 | Tabla estándar · totales · paginación · orden | `DESIGN.md` §3.9 (`DataTable`) |
| **7.2** | **Celdas de dos líneas y columnas agrupadas** | **acá** |
| **7.6** | **Acciones de fila** | **acá** |
| **7.7** | **Selección de filas y acción masiva** | **acá** |
| **7.8** | **Filas agrupadas y expandibles** | **acá** + `EJEMPLOS.md` §2 |
| **7.9** | **Cards de datos** | **acá** |
| **7.10** | **Grilla densa y exportar** | **acá** + `EJEMPLOS.md` §11 |
| 7.11 | KPI cards | `DESIGN.md` §3.4 (`Kpi`) |
| 8.1 · 8.2 · 8.4 | Familias de overlay · z-index · popovers | `DESIGN.md` §1.3 · BASE §2 · Radix |
| **8.3** | **Variantes de modal** | **acá** |
| **8.5** | **Sidebar: lo que el `AppShell` no trae** | **acá** |
| **8.6** | **Header: ubicación, breadcrumb, idioma** | **acá** |
| **8.7** | **Sub-navegación en pastillas** | **acá** |
| **8.8** | **navigationGuard (cambios sin guardar)** | **acá** + `EJEMPLOS.md` §11 |
| 9.1 · 9.3 · 9.4 · 9.5 · 9.6 | Carga · vacíos · banners · éxito · motion | `DESIGN.md` §3.7 · §1.1 · §1.9 |
| **9.2** | **Barras de progreso** | **acá** |
| 11 | Widgets de dominio | `EJEMPLOS.md` §4, §9, §10 |
| **12.1** | **Login split-screen** | **acá** |
| 12.2 · 12.3 | Bloqueo por intentos · recuperar contraseña | `EJEMPLOS.md` §8 |
| 13 | Emails | `EJEMPLOS.md` §6 |
| 14 | Control de acceso por rol | `EJEMPLOS.md` §7 |
| 15 | Reglas de oro | `DESIGN.md` §6 + BASE §8 |

---

## 3.11 StatusBadge: de la paleta vieja a los tonos

**Para qué:** al rediseñar una app que pintaba estados con colores crudos (el kit viejo y casi todos los repos), traducir cada color a uno de los seis tonos de `StatusBadge` (BASE §4) sin perder información. Las reglas de fondo (un tono por etapa, estado de lectura, ≥ 25° de matiz) están en `DESIGN.md` §1.1; acá va la tabla de traducción y el archivo.

| Color viejo | Qué significaba | Tono del kit |
|---|---|---|
| ámbar (`amber-100/700`) | Pendiente, falta algo | `aviso` |
| índigo (`indigo-100/700`) · violeta (`violet-100/700`) | En proceso · despachado | `info` los dos: es la misma etapa ("en curso, no me toca"); los distingue el texto. Índigo y violeta estaban a 15° y no se distinguían igual. |
| celeste (`sky-100/700`) | Pospuesto, fuera de temporada | `neutro` (o `info` si en esa columna no hay nada "en curso") |
| esmeralda (`emerald-100/700`) | Listo, resuelto | `exito` |
| pizarra (`slate-100/600`) | Anulado, cerrado | `neutro` |
| rojo (`red-100/700`) | Vencido, rechazado, error | `peligro` |
| violeta como "el otro signo" (nota de crédito) | Un **tipo** de documento, no un estado | `marca` si convive con estados en la columna (BASE §3), si no `neutro` |

El mapa vive en `src/lib/estados.ts`, nunca en la pantalla:

```ts
// src/lib/estados.ts
import type { Tono } from "@/components/ui/status-badge"

export type EstadoTicket = "pendiente" | "en_proceso" | "despachado" | "pospuesto" | "resuelto" | "anulado"

export const ESTADOS_TICKET: Record<EstadoTicket, { label: string; tono: Tono }> = {
  pendiente: { label: "Pendiente", tono: "aviso" },
  en_proceso: { label: "En proceso", tono: "info" },
  despachado: { label: "Despachado", tono: "info" },
  pospuesto: { label: "Pospuesto", tono: "neutro" },
  resuelto: { label: "Resuelto", tono: "exito" },
  anulado: { label: "Anulado", tono: "neutro" },
}
```

```tsx
<StatusBadge tono={ESTADOS_TICKET[t.estado].tono}>{ESTADOS_TICKET[t.estado].label}</StatusBadge>

{/* Etiqueta que no es un estado pero acompaña (aislamiento, habitación compartida): mismo componente, ícono size-3 */}
<StatusBadge tono="aviso"><ShieldAlert className="size-3" aria-hidden="true" /> Contacto</StatusBadge>
```

- **Una sola excepción al 10 %:** la marca que tiene que saltar en toda la fila (una urgencia) puede ir llena: `inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-destructive-foreground`. Una por fila, como mucho.
- Un `title` sobre el badge no reemplaza al texto: si el estado necesita explicación, va como ayuda en la celda (§7.2).
- No hacer: un `<span>` de estado con clases a mano; `statusColor(string)` que adivina por el texto traducido; mapear a `marca` un estado.

## 3.12 Loader

**Para qué:** la carga de una página o una lista. El loader del original (anillo que gira + halo + burbuja) **es** el `Cargando` del kit (BASE §4, `DESIGN.md` §3.7): no se reimplementa.

```tsx
<Cargando texto="Cargando traslados…" />
```

- El kit no trae `size` ni `subtext`. El contexto (sucursal, período) va en el mismo `texto`: `texto="Cargando pedidos de Sucursal Centro…"`.
- El centro de la burbuja es un punto de marca, no el isotipo del cliente. **El kit no trae** la variante con isotipo; si el cliente la pide, se agrega como prop de `Cargando` en `estados.tsx` (no un loader aparte).
- Spinner de botón: `Loader2` con `animate-spin` + `disabled` (`DESIGN.md` §2, `button`). Guardar algo largo: overlay de `DESIGN.md` §3.7.

## 3.15 SuccessCard (confirmación transaccional)

**Para qué y cuándo:** operaciones en serie donde el operador sigue en la misma pantalla (cobrar, cargar un movimiento): un toast es poco y navegar es mucho. Las reglas están en `EJEMPLOS.md` §5; **el kit no lo trae**, así se arma la variante "sobre todo" con `Dialog`:

```tsx
// src/components/ui/confirmacion.tsx
import { useEffect, useRef, useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export function Confirmacion({ abierta, titulo, detalle, accion, onCerrar, ms = 5000 }: {
  abierta: boolean; titulo: string; detalle?: string; accion: string; onCerrar(): void; ms?: number
}) {
  const [corriendo, setCorriendo] = useState(false)
  const cerrar = useRef(onCerrar)
  cerrar.current = onCerrar

  useEffect(() => {
    if (!abierta) return setCorriendo(false)
    const raf = requestAnimationFrame(() => setCorriendo(true)) // arranca la barra un frame después
    const t = setTimeout(() => cerrar.current(), ms)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [abierta, ms])

  return (
    <Dialog open={abierta} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-sm">
        <div className="flex flex-col items-center p-8 text-center">
          <div className="relative mb-5">
            <span className="absolute inset-0 rounded-full bg-success/20 animate-ping motion-reduce:hidden" />
            <div className="relative flex size-16 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="size-9" aria-hidden="true" />
            </div>
          </div>
          <DialogTitle className="text-xl">{titulo}</DialogTitle>
          {detalle && <DialogDescription className="mt-1.5">{detalle}</DialogDescription>}
          <Button className="mt-6 h-11 w-full" onClick={onCerrar}>{accion}</Button>
        </div>
        <div className="h-1.5 bg-success/20">
          <div
            className={cn("h-full origin-left bg-success transition-transform ease-linear motion-reduce:hidden", corriendo ? "scale-x-0" : "scale-x-100")}
            style={{ transitionDuration: `${ms}ms` }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

Uso: `<Confirmacion abierta={hecho} titulo="Venta confirmada" detalle={`N° 1234 · ${dinero(total)}`} accion="Nueva venta" onCerrar={() => setHecho(false)} />`.

- El botón es `default` (`primary`), no verde: el verde es el estado, no la acción.
- Variante "dentro de un panel" (el carrito): mismo contenido en un overlay `absolute inset-0 z-nav flex flex-col items-center justify-center bg-popover/95 backdrop-blur-xs` (`EJEMPLOS.md` §5).
- No navega. Click afuera o Escape cierran (lo da Radix).

## 3.17 CategoryMultiSelect (filtro de una dimensión)

**Para qué:** filtrar una tabla por una sola dimensión con **pocas opciones fijas** (≤ ~10: categorías, tipos), desde la toolbar, ocupando el ancho de un botón. Con muchas opciones o con búsqueda, `MultiCombobox` (`DESIGN.md` §3.8). **El kit no lo trae**; se arma con `DropdownMenu` (accesible por teclado, no se cierra al marcar):

```tsx
// src/components/ui/filtro-categoria.tsx
import { ChevronDown, ListFilter } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export function FiltroCategoria({ label, opciones, value, onChange, className }: {
  label: string; opciones: { value: string; label: string }[]; value: string[]; onChange(v: string[]): void; className?: string
}) {
  const n = value.length
  const alternar = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label={n ? `${label} (${n} elegidas)` : label}
          className={cn("relative gap-2 px-3 md:h-9", n > 0 && "border-primary/40 bg-primary/5", className)}
        >
          <ListFilter className="size-3.5" />
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-auto size-3.5 opacity-60" />
          {n > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-bold text-primary-foreground tabular-nums">
              {n}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-56 overflow-y-auto">
        {opciones.map((o) => (
          <DropdownMenuCheckboxItem key={o.value} checked={value.includes(o.value)} onCheckedChange={() => alternar(o.value)} onSelect={(e) => e.preventDefault()}>
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
        {n > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])} className="text-xs text-muted-foreground">Limpiar</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- Con selección, el botón va en `primary` (la selección es `primary`, `DESIGN.md` §1.1), no en marca: la marca es para filtros de **dashboard** (§4.7).
- Sin opciones marcadas se ve todo. "Limpiar" vacía de una vez.
- No hacer: un panel portaleado a mano con `getBoundingClientRect`; un `z-*` propio (lo pone el `DropdownMenuContent`, `z-overlay`).

---

## 4.1 Modal de formulario canónico

**Para qué:** todo formulario de alta o edición corto (hasta ~10 campos). Clases, anchos y mobile: `DESIGN.md` §3.3; esto es el esqueleto completo.

```tsx
import { AlertCircle, Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

<Dialog open={abierto} onOpenChange={(o) => !guardando && setAbierto(o)}>
  <DialogContent className="sm:max-w-2xl">
    <form onSubmit={guardar} noValidate className="contents">
      <DialogHeader>
        <DialogTitle>Editar traslado</DialogTitle>
        <DialogDescription>
          Paciente <span className="font-medium text-foreground">{paciente.nombre}</span> · {paciente.codigo}
        </DialogDescription>
      </DialogHeader>

      <DialogBody>
        {errorGeneral && (
          <div role="alert" className="mb-5 flex items-center gap-2 rounded-r-md border-l-4 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive animate-in fade-in-0 slide-in-from-top-2">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" /> {errorGeneral}
          </div>
        )}
        <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errores.nombre || undefined}>
            <FieldLabel htmlFor="t-nombre">Nombre <span className="text-destructive">*</span></FieldLabel>
            <Input id="t-nombre" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} aria-invalid={!!errores.nombre || undefined} />
            {errores.nombre && <FieldError>{errores.nombre}</FieldError>}
          </Field>
          {/* … más campos cortos … */}
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="t-notas">Observaciones</FieldLabel>
            <Textarea id="t-notas" rows={3} maxLength={1000} value={notas} onChange={(e) => setNotas(e.target.value)} />
          </Field>
        </FieldGroup>
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</Button>
        <Button type="submit" disabled={guardando || !!motivo} className="sm:min-w-36">
          {guardando ? <Loader2 className="animate-spin" /> : <Save />} {guardando ? "Guardando…" : "Guardar"}
        </Button>
        {motivo && (
          <span className="flex items-center gap-1.5 text-xs text-warning sm:order-first sm:mr-auto">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" /> {motivo}
          </span>
        )}
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
```

- **Las bandas las pone el `dialog.tsx` del kit** al ver un `DialogBody` adentro (BASE §4): header `bg-secondary/20` con línea, cuerpo `p-6` que scrollea, pie `bg-muted/20` con línea; en mobile, header y pie quedan fijos y scrollea el medio. Sin `DialogBody`, el modal es el compacto. Las pantallas no agregan radio, sombra, borde ni alto al panel: solo el ancho.
- `<form className="contents">` deja que header, cuerpo y pie sigan siendo hijos directos del panel; el submit es el botón `type="submit"` y Enter guarda.
- **Mientras guarda no se cierra**: `onOpenChange` ignora el cierre si `guardando`; los dos botones deshabilitados.
- `motivo` = por qué no se puede guardar, una sola razón (`DESIGN.md` §3.3). El `span` va último en el DOM: en mobile (pie invertido) queda arriba de los botones; desde `sm`, `order-first` + `mr-auto` lo manda a la izquierda.
- **Interruptor** dentro del formulario: `Switch` del kit, no un botón con una bolita.

  ```tsx
  <Field orientation="horizontal">
    <Switch id="t-activo" checked={activo} onCheckedChange={setActivo} />
    <FieldLabel htmlFor="t-activo">Activo</FieldLabel>
  </Field>
  ```
- No hacer: `createPortal` propio, `fixed inset-0` a mano, un `z-*` propio, `max-h-[90vh]` (lo resuelve el componente con `dvh`), cerrar con un `<button>` suelto (la cruz la pone `DialogContent`).

## 4.3 Sheet de drill-down

**Para qué:** abrir "el detalle de este número" desde un KPI, una tarjeta del inicio o una fila, sin salir de la pantalla: una lista de lo que suma ese número, cargada al abrir, y un botón para ir al módulo. Para el detalle de **una entidad** (clave-valor, acciones), `DESIGN.md` §3.2; para el drill-down de un **gráfico**, `Dialog` `sm:max-w-6xl` (`DATAVIZ.md` §4.10). **El kit no trae** el drawer genérico; se arma con `Sheet` + `DataTable`:

```tsx
import { ArrowRight, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable, type Columna } from "@/components/ui/data-table"
import { Vacio } from "@/components/ui/estados"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"

export function DetalleNumero<T>({ abierto, onCerrar, icono: Icono, titulo, subtitulo, columnas, clave, cargar, nota, irA }: {
  abierto: boolean; onCerrar(): void; icono: LucideIcon; titulo: string; subtitulo?: string
  columnas: Columna<T>[]; clave(f: T): string; cargar(): Promise<T[]>; nota?: string
  irA?: { label: string; onClick(): void }
}) {
  const [filas, setFilas] = useState<T[]>([])
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando")
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    setEstado("cargando")
    cargar().then((f) => { if (vigente) { setFilas(f); setEstado("listo") } }).catch(() => vigente && setEstado("error"))
    return () => { vigente = false }
  }, [abierto, intento]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="ficha size-9 bg-brand/10 text-brand"><Icono className="size-4" aria-hidden="true" /></div>
            <div className="min-w-0">
              <SheetTitle>{titulo}</SheetTitle>
              {subtitulo && <SheetDescription>{subtitulo}</SheetDescription>}
            </div>
          </div>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 sm:px-6">
          <DataTable
            filas={filas}
            columnas={columnas}
            clave={clave}
            porPagina={Infinity}
            cargando={estado === "cargando"}
            error={estado === "error" ? { onReintentar: () => setIntento((i) => i + 1) } : undefined}
            vacio={<Vacio icono={Icono} titulo="No hay nada para mostrar" className="border-0 py-12" />}
          />
          {nota && <p className="mt-3 text-[11px] text-muted-foreground">{nota}</p>}
        </div>
        {irA && (
          <SheetFooter>
            <Button onClick={() => { onCerrar(); irA.onClick() }}>{irA.label} <ArrowRight /></Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
```

- Carga **al abrir**, con los tres estados (`Cargando` / `ErrorEstado` / `Vacio`) que ya resuelve `DataTable`; nunca un cero o una lista vacía que en realidad es "no cargó".
- Agrupar por algo (sucursal, día): `DataTable` no agrupa. O se ordena por el grupo y la primera columna lo muestra, o van varias `DataTable` seguidas con un título `micro text-muted-foreground mb-2` por grupo (respetando el orden de primera aparición).
- El botón del pie es `default` (`primary`), no de marca.

## 4.4 Página estándar

**Para qué:** toda vista de listado. Qué lleva: BASE §6.1; cómo se ve: `DESIGN.md` §3.1. Este es el esqueleto completo, tomado de la vista de referencia de MediFlow:

```tsx
export default function Traslados() {
  const [q, setQ] = useState("")
  const [verFiltros, setVerFiltros] = useState(() => window.matchMedia("(min-width: 768px)").matches)
  // … filtros (§4.7), datos, orden …

  const vacio = !cargado
    ? null
    : todos.length === 0 && !q && filtrosActivos === 0
      ? <Vacio icono={BedDouble} titulo="No hay traslados activos" accion={<Button variant="outline" onClick={nuevo}><Plus /> Nueva solicitud</Button>} />
      : <Vacio icono={SearchX} titulo="Sin resultados" descripcion="Probá con otra búsqueda o limpiá los filtros." />

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Traslados"
        descripcion={<><span className="cifra text-foreground">{numero(todos.length)}</span> activos · espera media <span className="cifra text-foreground">{espera}</span></>}
        acciones={<Toolbar q={q} setQ={setQ} verFiltros={verFiltros} setVerFiltros={setVerFiltros} activos={filtrosActivos} />}
      />

      {verFiltros && <BarraFiltros activos={filtrosActivos} onLimpiar={limpiar}>{/* §4.7 */}</BarraFiltros>}

      {/* Falló una RECARGA (ya había datos): aviso arriba, la tabla queda con lo último que llegó. */}
      {errorRecarga && cargado && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span><span className="font-semibold">No pudimos actualizar los traslados.</span> Lo que ves puede estar desactualizado.</span>
        </div>
      )}

      <div className={cn("transition-opacity duration-300", recargando && "opacity-60")}>
        <DataTable
          filas={filas}
          columnas={columnas}         /* §7.2 */
          clave={(t) => t.id}
          tarjeta={tarjeta}           /* §5.4 */
          cargando={!cargado && !errorCarga}
          error={!cargado && errorCarga ? { onReintentar: recargar } : undefined}
          vacio={vacio}
        />
      </div>
    </div>
  )
}
```

- **Un solo array** para tabla y tarjetas: `DataTable` dibuja las dos; nunca dos bloques `md:hidden` / `hidden md:block` a mano.
- **El vacío dice por qué**: "no hay nada todavía" (con la acción de crear) no es lo mismo que "sin resultados" (con la pista de limpiar). Y "cargando" no se muestra cuando lo que pasa es que no hay nada.
- **Error de la primera carga** → `ErrorEstado` en lugar de la tabla. **Error de una recarga** → banner arriba y la tabla con los últimos datos; no se vacía la pantalla.
- Recarga por filtro: `opacity-60` sin desmontar (`DESIGN.md` §3.1).
- El nombre de la pantalla en mobile lo pone el header (`AppShell.ubicacion`, `DESIGN.md` §4.2); el `PageHeader` es para desktop.

## 4.7 Filtros: botón y barra

**Lo primero:** un filtro **no es un modal**. Los tres casos (una dimensión, lista larga, varias dimensiones) y los chips de estado están en `DESIGN.md` §3.8. Esto es el **patrón C**, la barra colapsable. Sus tres piezas las trae el kit en `src/components/ui/filtros.tsx` (BASE §4): `BotonFiltros` (abierto o con activos, en marca; en mobile queda el ícono y el nombre accesible lleva el conteo; `aria-controls` a la barra), `BarraFiltros` (inline, `role="group"`, con "Limpiar") y `CampoFiltro` (micro-etiqueta con ícono de marca, atada al control con `htmlFor`). No se copian a mano.

En la vista:

```tsx
const [verFiltros, setVerFiltros] = useState(() => window.matchMedia("(min-width: 768px)").matches) // abierta desde tablet, cerrada en el celular
const [estados, setEstados] = useState<string[]>([])
const [sucursales, setSucursales] = useState<string[]>([])
const [rango, setRango] = useState<DateRange>()
const activos = estados.length + sucursales.length + (rango ? 1 : 0)
const limpiar = () => { setEstados([]); setSucursales([]); setRango(undefined) }

<PageHeader titulo="Traslados" acciones={<BotonFiltros abierto={verFiltros} activos={activos} onClick={() => setVerFiltros((v) => !v)} />} />
{verFiltros && (
  <BarraFiltros activos={activos} onLimpiar={limpiar}>
    <CampoFiltro icono={CalendarRange} label="Período" htmlFor="f-periodo">
      <DateRangePicker id="f-periodo" value={rango} onChange={setRango} placeholder="Todo" />
    </CampoFiltro>
    <CampoFiltro icono={CircleDot} label="Estado" htmlFor="f-estado" className="sm:w-64">
      <MultiCombobox
        id="f-estado"
        opciones={LISTA_ESTADOS.map((e) => ({ value: e, label: `${ESTADOS[e].label} (${conteo[e] ?? 0})` }))}
        value={estados}
        onChange={setEstados}
        placeholder={`Todos (${numero(total)})`}
        buscar="Buscar estado…"
      />
    </CampoFiltro>
    <CampoFiltro icono={MapPin} label="Sucursal" htmlFor="f-sucursal">
      <MultiCombobox id="f-sucursal" opciones={opcionesSucursal} value={sucursales} onChange={setSucursales} placeholder="Todas" />
    </CampoFiltro>
  </BarraFiltros>
)}
```

**Estado compartido** (un dashboard con tabs que leen los mismos filtros): un contexto chico en vez de pasar props por cada tab. `clave` sirve de dependencia para volver a pedir datos.

```tsx
// src/components/dashboard/filtros-contexto.tsx
export interface Filtros { sucursales: string[]; estados: string[]; rango?: DateRange }
const VACIOS: Filtros = { sucursales: [], estados: [] }
const Ctx = createContext<{ filtros: Filtros; set(p: Partial<Filtros>): void; limpiar(): void; activos: number; clave: string } | null>(null)

export function FiltrosProvider({ children }: { children: React.ReactNode }) {
  const [filtros, setFiltros] = useState<Filtros>(VACIOS)
  const valor = useMemo(() => ({
    filtros,
    set: (p: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...p })),
    limpiar: () => setFiltros(VACIOS),
    activos: filtros.sucursales.length + filtros.estados.length + (filtros.rango ? 1 : 0),
    clave: JSON.stringify(filtros),
  }), [filtros])
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}
export const useFiltros = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error("useFiltros va adentro de <FiltrosProvider>")
  return c
}
```

Reglas:

1. **No es modal ni overlay.** En mobile los campos se apilan (`w-full`); no se abre nada encima.
2. **El conteo** de activos va en el botón **y** habilita "Limpiar" adentro de la barra. "Limpiar" resetea todo de una vez.
3. **La barra no se auto-oculta**: la muestra o la esconde la vista con `useState`. Abierta de entrada desde tablet (el conteo por estado se ve sin un clic), cerrada en el celular para no empujar la tabla.
4. **Orden de los campos**: período primero (`DateRangePicker`), después los `MultiCombobox`. Los controles miden `h-10`; "Limpiar" también (`items-end` los alinea por abajo).
5. Los filtros de una **sesión de pantalla** no se persisten: un filtro de ayer escondiendo filas hoy parece "no hay nada". Si hace falta compartir el link, van en la URL (`useSearchParams`), no en `localStorage`.
6. Un control que no es un filtro pero cambia la vista ("Ver como", modo) puede vivir en la barra como segmented (§6.6) dentro de un `CampoFiltro`.
7. Un filtro adentro de una card de gráfico, nunca (`DATAVIZ.md` §2).

---

## 5.1 Breakpoints por zona

**Para qué:** elegir el corte según el tipo de pantalla, no `md` para todo. Los de la base (`md` tabla ↔ tarjetas y sidebar, `lg` columnas secundarias, `xl` celular) están en BASE §6.

| Zona | Corta en | Qué cambia |
|---|---|---|
| Vistas de negocio (listados, formularios) | `md` | Tabla ↔ tarjetas (`DataTable`), header mobile ↔ sidebar, toolbar en fila. |
| Dashboards | `sm` y `lg` | Header y toolbar de columna a fila en `sm`; grillas de gráficos de 1 a 2–3 columnas en `lg` (`DESIGN.md` §3.4). |
| Carrito, catálogo, bottom-sheet | `lg` | El sheet sigue siendo sheet en tablet; panel lateral recién en desktop (`EJEMPLOS.md` §4). |
| Columnas de tabla | `lg` · `xl` | `ocultarEn: "md"` aparece en `lg`; `"lg"` aparece en `xl` (§5.4). |

Regla corta: **`sm:` reordena** (columna → fila, botones a lo ancho → a su ancho) · **`md:` cambia de bloque** (tarjetas → tabla) · **`lg:` agrega** (columnas, paneles laterales). `2xl:` no se usa.

## 5.2 Toolbar responsive

**Para qué:** la fila de búsqueda + filtros + acciones de un listado. Clases: `DESIGN.md` §3.1.

```tsx
function Toolbar({ q, setQ, verFiltros, setVerFiltros, activos }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
      <InputGroup className="min-w-28 flex-1 sm:w-56 sm:flex-none md:h-9">
        <InputGroupAddon><Search className="size-3.5" /></InputGroupAddon>
        <InputGroupInput type="search" placeholder="Paciente o ID…" aria-label="Buscar por paciente o ID" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="Limpiar búsqueda" onClick={() => setQ("")}><X /></InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      {/* Hasta tres filtros simples en la misma fila: dos columnas en mobile, en línea desde md con el mismo markup */}
      <div className="grid w-full grid-cols-2 gap-2 sm:w-auto md:contents">
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="md:h-9 md:w-40" aria-label="Tipo"><SelectValue /></SelectTrigger>
          <SelectContent>{/* … */}</SelectContent>
        </Select>
        <FiltroCategoria label="Categoría" opciones={categorias} value={cats} onChange={setCats} />
      </div>

      {/* Más de tres, o filtros de dashboard: la barra (§4.7) */}
      <BotonFiltros abierto={verFiltros} activos={activos} onClick={() => setVerFiltros((v) => !v)} />

      <Button variant="outline" className="gap-1.5 px-3 md:h-9" aria-label="Nuevo pre-ticket">
        <ClipboardPlus className="size-3.5" /><span className="hidden sm:inline">Pre-ticket</span>
      </Button>
      <Button className="gap-1.5 px-3 md:h-9" aria-label="Nueva solicitud">
        <Plus className="size-3.5" /><span className="hidden sm:inline">Solicitud</span>
      </Button>
    </div>
  )
}
```

- Contenedor: `flex flex-wrap items-center gap-2 lg:justify-end`.
- Búsqueda: `min-w-28 flex-1 sm:w-56 sm:flex-none` (llena la fila en mobile, ancho fijo después), con la cruz para limpiar cuando hay texto.
- **Botón que en mobile queda solo con ícono**: label en `<span className="hidden sm:inline">` y `aria-label` con el texto completo (el nombre accesible incluye la palabra visible).
- Todo lo de la fila mide igual: `h-10` en mobile (táctil), `md:h-9` en desktop. Un control que se queda en `h-10` al lado de otros `h-9` se ve desalineado (`DESIGN.md` §1.6).
- La acción principal (`default`) va última, a la derecha.

## 5.3 Grillas canónicas

| Uso | Clases |
|---|---|
| KPIs | `KpiGrid` (resuelve 3, 4, 5 y 6; `DESIGN.md` §3.4) |
| Campos de formulario | `grid grid-cols-1 sm:grid-cols-2 gap-4`; campo ancho `sm:col-span-2` |
| Secciones anchas de un formulario en página | `grid grid-cols-1 md:grid-cols-2 gap-8` |
| Catálogo (POS) | `grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3` |
| Gráfico grande + chico · dos iguales | `DESIGN.md` §3.4 |
| Lista fija + edición (configuración: roles, plantillas) | `grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4`. **No** para entidades con movimientos: eso son dos pantallas (`EJEMPLOS.md` §1). |
| Clave-valor de un detalle | `grid grid-cols-[auto_1fr] gap-x-6 gap-y-2` (`DESIGN.md` §3.2) |

## 5.4 Columnas progresivas y tarjeta mobile

**Para qué:** que una tabla ancha entre en 1024 y 1280 sin scroll horizontal, sin perder el dato. Cuanto menos importa una columna, más tarde aparece; mientras no está, **su dato se pliega** como subtítulo en una columna que sí está.

```tsx
const columnas: Columna<Ticket>[] = [
  {
    id: "estado",
    titulo: "Estado",
    ordenar: (t) => t.estado,
    clase: "whitespace-nowrap",
    celda: (t) => (
      <div className="flex flex-col items-start gap-1">
        <StatusBadge tono={ESTADOS_TICKET[t.estado].tono}>{ESTADOS_TICKET[t.estado].label}</StatusBadge>
        <span className="text-[10px] text-muted-foreground tabular-nums">{fechaHora(t.creado)}</span>
        {/* La columna "Tarea" no está antes de lg: su dato va acá y se oculta cuando aparece */}
        <span className="max-w-40 text-[10px] leading-snug whitespace-normal text-muted-foreground lg:hidden">{ayuda(t)}</span>
      </div>
    ),
  },
  // …
  { id: "tarea", titulo: "Tarea y observaciones", ocultarEn: "md", celda: (t) => <Tarea t={t} /> },
]
```

| `ocultarEn` | La columna aparece en | Su dato plegado lleva |
|---|---|---|
| `"md"` | `lg` (1024) | `lg:hidden` |
| `"lg"` | `xl` (1280) | `xl:hidden` |

**Tarjeta mobile** (`tarjeta` de `DataTable`; el contenedor `rounded-lg border bg-card p-3` lo pone el componente):

```tsx
const tarjeta = (t: Ticket) => (
  <div className="flex flex-col gap-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-medium">{t.paciente}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{t.id} · {TIPO_CORTO[t.tipo]}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge tono={ESTADOS_TICKET[t.estado].tono}>{ESTADOS_TICKET[t.estado].label}</StatusBadge>
        <span className="text-[10px] text-muted-foreground tabular-nums">{fechaHora(t.creado)}</span>
      </div>
    </div>

    {/* Un "de → a": dos columnas con flecha, sobre superficie sutil */}
    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 rounded-md bg-muted/40 p-2.5">
      <div className="min-w-0"><p className="micro text-[10px] text-muted-foreground">Origen</p><p className="text-[13px] font-medium wrap-break-word">{t.origen}</p></div>
      <ArrowRight className="mt-4 size-4 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 text-right"><p className="micro text-[10px] text-muted-foreground">Destino</p><p className="text-[13px] font-medium wrap-break-word">{t.destino ?? "Pendiente"}</p></div>
    </div>

    {/* Acciones al pie, a lo ancho y con texto (§7.6) */}
    <div className="flex flex-col gap-2 border-t pt-3">{acciones(t, { mobile: true })}</div>
  </div>
)
```

- Arriba identidad + estado, en el medio el dato que decide, al pie las acciones. Métricas en `grid grid-cols-3 gap-2` con `tabular-nums` cuando son totales (`EJEMPLOS.md` §1).
- En la tarjeta va **todo** lo que la tabla muestra en desktop, incluidas las columnas ocultas; lo que en desktop está en un tooltip, en mobile va escrito (no hay hover).
- No hacer: `hidden sm:table-cell` a mano en una `DataTable` (usá `ocultarEn`); columnas con `min-w` que empujan "Acciones" fuera de la pantalla a 1280 (se mide con sidebar abierta).

## 5.7 Barra de acción fija

**Para qué:** formularios en página más altos que la pantalla y selección masiva: el resumen y el botón siempre a la vista. Clases: `DESIGN.md` §4.3.

```tsx
<div className="barra-inferior sticky bottom-0 z-nav p-3 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] md:p-4">
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <p className="text-sm text-muted-foreground">Total <span className="cifra text-lg text-foreground">{dinero(total)}</span></p>
    <div className="flex flex-col-reverse gap-2 sm:flex-row">
      <Button variant="outline" onClick={cancelar}>Cancelar</Button>
      <Button onClick={confirmar} disabled={guardando}>Confirmar</Button>
    </div>
  </div>
</div>
```

- `sticky bottom-0` adentro del contenido: no tapa nada y no hace falta reservar lugar. Si por layout tiene que ser `fixed` o `absolute`, el contenido reserva su alto con `pb-28 md:pb-24`.
- PWA en iOS: `pb-[env(safe-area-inset-bottom)]` además del padding.

## 5.11 Mostrar / ocultar por viewport

| Clase | Para qué |
|---|---|
| `hidden sm:inline` | Label de botón: en mobile queda el ícono (§5.2). |
| `lg:hidden` · `xl:hidden` | Dato plegado de una columna con `ocultarEn` (§5.4). |
| `md:hidden` · `hidden md:flex` | Bloques que solo existen en mobile o en desktop **fuera** de `DataTable` y `AppShell` (que ya lo resuelven). |
| `lg:hidden` | Fondo y barra de asomo del bottom-sheet (`EJEMPLOS.md` §4). |
| `hidden xl:flex` | Columna lateral del celular de la demo (lo hace `AppShell.lateral`). |

No hay `useMediaQuery` para mostrar u ocultar: es CSS. El único uso de `matchMedia` es elegir un **estado inicial** (la barra de filtros abierta desde tablet, §4.7).

---

## 6.1–6.2 Campos, secciones, requerido y errores

**Para qué:** cualquier formulario (modal o página). Las clases de cada pieza están en `DESIGN.md` §3.3; esto es cómo se escriben con `Field`.

```tsx
<FieldGroup>
  {/* Sección dentro del cuerpo */}
  <h3 className="titulo flex items-center gap-2"><Tag className="size-4" aria-hidden="true" /> Datos básicos</h3>

  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <Field data-invalid={!!errores.categoria || undefined}>
      <FieldLabel htmlFor="p-categoria">Categoría <span className="text-destructive">*</span></FieldLabel>
      <Combobox id="p-categoria" obligatorio opciones={categorias} value={categoria} onChange={setCategoria} aria-invalid={!!errores.categoria || undefined} />
      {errores.categoria ? <FieldError>{errores.categoria}</FieldError> : <FieldDescription>La que ve el cliente.</FieldDescription>}
    </Field>
    <Field>
      <FieldLabel htmlFor="p-precio">Precio</FieldLabel>
      <MoneyInput id="p-precio" value={precio} onValueChange={setPrecio} />
    </Field>
  </div>

  {/* Caja de agrupación: campos que van juntos (dirección, datos fiscales) */}
  <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-secondary/20 p-4">
    <p className="micro text-muted-foreground">Facturación</p>
    {/* … */}
  </div>
</FieldGroup>
```

- **Requerido**: `*` en `text-destructive` dentro del `FieldLabel`. **Error de campo**: `Field data-invalid` (el label se pone en rojo) + `aria-invalid` en el control + `FieldError` (ya trae `role="alert"`). Error y ayuda no van juntos: el error reemplaza a la ayuda.
- **Error del formulario** (el server rechazó): banner con acento arriba del cuerpo (§4.1).
- **Validar al guardar**, no en cada tecla; después del primer intento, el error de un campo se va cuando se corrige.
- Variante de caja punteada (opcional, "agregá si querés"): `flex flex-col gap-2 rounded-md border border-dashed bg-muted/20 p-3`.
- Alturas de una fila: se miden (`REDISENO.md` §R.6).

## 6.3 Textarea con contador

```tsx
<Field data-invalid={!!error || undefined}>
  <FieldLabel htmlFor="obs">Nueva observación</FieldLabel>
  <Textarea id="obs" rows={3} maxLength={500} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: familiar ausente, faltan prendas" aria-invalid={!!error || undefined} />
  <div className="flex items-center justify-between gap-2">
    {error ? <FieldError>{error}</FieldError> : <span />}
    <span className="text-[11px] text-muted-foreground tabular-nums">{texto.length}/500</span>
  </div>
</Field>
```

`maxLength`: 500 para notas cortas, 1000 para observaciones. El `Textarea` del kit crece con el contenido (`field-sizing-content`); `resize-none` solo si el diseño necesita alto fijo.

## 6.5 Opción-card y pastillas seleccionables

**Opción-card** (elegir uno, con descripción: método de pago, tipo de envío). Las clases las pone `FieldLabel` cuando envuelve un `Field` (`DESIGN.md` §2):

```tsx
<RadioGroup value={metodo} onValueChange={setMetodo} className="grid gap-3 sm:grid-cols-3">
  {METODOS.map((m) => (
    <FieldLabel key={m.id} htmlFor={`m-${m.id}`}>
      <Field orientation="horizontal">
        <RadioGroupItem id={`m-${m.id}`} value={m.id} />
        <FieldContent>
          <FieldTitle>{m.nombre}</FieldTitle>
          <FieldDescription>{m.detalle}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  ))}
</RadioGroup>
```

**Pastillas** (chips de tipo o categoría, selección múltiple o única corta):

```tsx
<div role="group" aria-label="Tipo" className="flex flex-wrap gap-2">
  {TIPOS.map((t) => {
    const activo = tipos.includes(t.id)
    return (
      <button
        key={t.id}
        type="button"
        aria-pressed={activo}
        onClick={() => alternar(t.id)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          activo ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        {t.nombre}
      </button>
    )
  })}
</div>
```

Selección = `primary`, nunca marca. Checkbox suelto: `Checkbox` del kit, nunca `<input type="checkbox">`.

## 6.6 Segmented (modos de una vista)

**Para qué:** cambiar un modo o una vista sin navegar ("Ver como: Admin / Admisión / Azafata", "Lista / Calendario", "Gasto / Ingreso").

- Si cada opción muestra **otro contenido** debajo: `Tabs` con `TabsList` default (`DESIGN.md` §2), que ya es un segmented.
- Si es **un modo** que cambia lo que se filtra o qué acciones aparecen: botones con `aria-pressed`.

```tsx
<div role="group" aria-label="Ver como" className="inline-flex h-10 items-center rounded-md bg-muted p-1">
  {MODOS.map((m) => (
    <button
      key={m.id}
      type="button"
      aria-pressed={modo === m.id}
      onClick={() => setModo(m.id)}
      className={cn(
        "h-full flex-1 rounded-sm px-3 text-sm font-medium transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:flex-none",
        modo === m.id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {m.label}
    </button>
  ))}
</div>
```

- En mobile, a lo ancho (`w-full` en el contenedor, `flex-1` en cada botón); desde `sm`, a su ancho.
- Variante con signo (gasto / ingreso): la activa lleva el texto semántico sobre el fondo de siempre: `bg-background text-destructive shadow-xs` / `bg-background text-success shadow-xs`.
- Más de 4 opciones: no es un segmented, es un `Select`.

## 6.7 Cantidad (+/−)

```tsx
<div className="flex items-center gap-2">
  <Button variant="outline" size="icon" aria-label="Restar uno" onClick={() => setCant((c) => c - 1)} disabled={cant <= min}><Minus /></Button>
  <Input
    type="number"
    inputMode="numeric"
    aria-label="Cantidad"
    value={cant}
    onChange={(e) => setCant(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
    className="w-16 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
  />
  <Button variant="outline" size="icon" aria-label="Sumar uno" onClick={() => setCant((c) => c + 1)} disabled={cant >= max}><Plus /></Button>
</div>
```

Los tres miden `h-10`. En una fila densa (carrito) se baja todo junto a `h-8` (`size="icon-sm"` + `h-8` en el input), nunca uno solo. Montos, nunca así: `MoneyInput`. `type="number"` acá es correcto (el validador lo marca como aviso; va con `// sumar-validar-ignorar: numero-montos cantidad`).

## 6.8 Contraseña (mostrar / ocultar)

```tsx
<InputGroup className="h-11">
  <InputGroupAddon><Lock /></InputGroupAddon>
  <InputGroupInput id="clave" type={ver ? "text" : "password"} autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} aria-invalid={!!error || undefined} />
  <InputGroupAddon align="inline-end">
    <InputGroupButton size="icon-xs" aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setVer((v) => !v)}>
      {ver ? <EyeOff /> : <Eye />}
    </InputGroupButton>
  </InputGroupAddon>
</InputGroup>
```

## 6.9 Subir archivo (dropzone + vista previa)

Clases: `DESIGN.md` §3.3. Compresión antes de subir: `EJEMPLOS.md` §11. **El kit no trae** el componente:

```tsx
{!archivo ? (
  <label
    onDragOver={(e) => e.preventDefault()}
    onDrop={(e) => { e.preventDefault(); elegir(e.dataTransfer.files?.[0]) }}
    className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-input bg-muted/10 text-center transition-colors hover:border-primary/40 hover:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring"
  >
    <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = "" }} />
    <Upload className="size-5 text-muted-foreground/50" aria-hidden="true" />
    <span className="text-xs text-muted-foreground">Arrastrá o hacé click</span>
  </label>
) : (
  <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-2.5">
    <img src={vista} alt={archivo.name} className="size-12 shrink-0 rounded-md border object-cover" />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{archivo.name}</p>
      <p className="text-xs text-muted-foreground">{numero(archivo.size / 1024, { decimales: 0 })} KB</p>
    </div>
    <Button variant="ghost" size="icon-sm" aria-label="Quitar archivo" onClick={quitar} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 /></Button>
  </div>
)}
```

- El `input` va `sr-only` (no `hidden`): así el teclado llega y el foco se ve en la zona (`has-focus-visible:`).
- Imagen remota que puede fallar: `onError` que esconde la miniatura y deja el nombre del archivo.

## 6.11 Edición inline en tablas

**Para qué:** corregir un valor sin abrir un modal (conteo físico de stock, un precio). Dos modos:

**Guardar por fila** — el lápiz abre un input en la celda; Enter guarda, Escape cancela:

```tsx
{
  id: "conteo",
  titulo: "Conteo",
  alinear: "der",
  celda: (f) => editando === f.id ? (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        autoFocus
        type="number"
        inputMode="numeric"
        aria-label={`Conteo de ${f.nombre}`}
        value={borrador}
        onChange={(e) => setBorrador(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") guardarFila(f); if (e.key === "Escape") setEditando(null) }}
        className="h-8 w-20 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <Button variant="ghost" size="icon-sm" aria-label="Guardar" onClick={() => guardarFila(f)} className="text-success hover:bg-success/10 hover:text-success"><Check /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={() => setEditando(null)} className="text-muted-foreground"><X /></Button>
    </div>
  ) : (
    <div className="flex items-center justify-end gap-1">
      <span className="tabular-nums">{numero(f.conteo)}</span>
      <Button variant="ghost" size="icon-sm" aria-label={`Editar conteo de ${f.nombre}`} onClick={(e) => { e.stopPropagation(); setBorrador(String(f.conteo)); setEditando(f.id) }} className="text-muted-foreground"><Pencil /></Button>
    </div>
  ),
}
```

**Guardar todo junto** — cada fila tiene su input, un botón "Guardar cambios (N)" en las `acciones` del `PageHeader` persiste todo; las filas tocadas se marcan con `claseFila={(f) => cambios.has(f.id) ? "bg-primary/5" : undefined}`, y la pantalla registra la guardia de salida (§8.8).

- Input `h-8` porque convive con botones `icon-sm` (32 px): toda la celda mide igual. En la `tarjeta` mobile, los mismos controles a `h-10`.
- Una sola fila en edición por vez (modo 1). Guardando: spinner en el ✓ y el input deshabilitado; si falla, `toast.error` y la fila queda abierta con el valor tipeado.
- Montos: `MoneyInput` (`decimales` según el caso), no `type="number"`.

## 6.12 Renglones editables (líneas con total derivado)

**Para qué:** órdenes, recetas, facturas: una lista de líneas que se agregan y quitan, con subtotal por línea y total al pie. Va con `table.tsx` (no `DataTable`: las celdas son controles).

```tsx
<div className="hidden overflow-hidden rounded-lg border md:block">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead className="micro">Ítem</TableHead>
        <TableHead className="micro w-28 text-right">Cantidad</TableHead>
        <TableHead className="micro w-40 text-right">Precio</TableHead>
        <TableHead className="micro w-36 text-right">Subtotal</TableHead>
        <TableHead className="w-12"><span className="sr-only">Quitar</span></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {lineas.map((l, i) => (
        <TableRow key={l.id}>
          <TableCell><Combobox obligatorio aria-label={`Ítem de la línea ${i + 1}`} opciones={items} value={l.item} onChange={(v) => cambiar(l.id, { item: v })} /></TableCell>
          <TableCell><Input type="number" inputMode="numeric" aria-label={`Cantidad de la línea ${i + 1}`} value={l.cant} onChange={(e) => cambiar(l.id, { cant: Number(e.target.value) })} className="text-right tabular-nums" /></TableCell>
          <TableCell><MoneyInput aria-label={`Precio de la línea ${i + 1}`} value={l.precio} onValueChange={(v) => cambiar(l.id, { precio: v })} /></TableCell>
          <TableCell className="text-right font-mono tabular-nums">{l.precio != null ? dinero(l.cant * l.precio) : "—"}</TableCell>
          <TableCell><Button variant="ghost" size="icon" aria-label={`Quitar línea ${i + 1}`} onClick={() => quitar(l.id)} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 /></Button></TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</div>
{/* Mobile: una card por línea con los mismos controles apilados (md:hidden) */}
<Button variant="outline" size="sm" onClick={agregar}><Plus /> Agregar línea</Button>
```

- **Quitar mide `h-10`** (`size="icon"`), igual que los inputs de la fila: un `icon-sm` acá se ve desalineado (`DESIGN.md` §1.6).
- Total: fila de total de `DESIGN.md` §3.3, calculado con `useMemo` desde las líneas (nunca un estado aparte).
- Reparto de un total entre líneas (medios de pago): `EJEMPLOS.md` §3.

---

## 7.2 Celdas de dos líneas y columnas agrupadas

**Para qué:** que una tabla se lea por lo que significa, no por los campos de la base. Datos que se leen juntos van **en una celda**: valor arriba, metadato abajo.

| Celda | Cómo |
|---|---|
| Dos líneas | valor `font-medium` + metadato `text-[10px] text-muted-foreground` (código en `font-mono`, fecha en `tabular-nums`) |
| Identidad + etiquetas | nombre + `StatusBadge` chicos al lado en `flex flex-wrap items-center gap-1.5` |
| De → a | origen `font-medium`, debajo `ArrowRight size-3` + destino; "pendiente" en `text-muted-foreground` |
| Estado + cuándo | `StatusBadge` + `fechaHora()` debajo |
| Número / monto | `alinear: "der"`, `tabular-nums`; destacado `font-semibold`; el total que importa de la pantalla, `text-brand` (uno solo) |
| Con signo | `text-success` / `text-destructive` con `+` / `−`; `dinero()` ya pone el menos |
| Diferencia como chip | `DESIGN.md` §3.9 |
| Aviso dentro de la celda | `recuadro` con el color: `recuadro border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-tight text-destructive` |
| Observación | `flex max-w-64 items-start gap-1.5 rounded-md border border-warning/20 bg-warning/10 px-2 py-1.5 text-[11px] leading-tight text-warning` con `Info size-3` |

```tsx
{
  id: "paciente",
  titulo: "Paciente",
  ordenar: (t) => t.paciente,
  celda: (t) => (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{t.paciente}</span>
        {t.aislamientos.map((a) => <StatusBadge key={a} tono="aviso"><ShieldAlert className="size-3" aria-hidden="true" /> {a}</StatusBadge>)}
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">{t.id}</span>
    </div>
  ),
},
{
  id: "traslado",
  titulo: "Traslado",
  celda: (t) => (
    <div className="flex max-w-64 flex-col gap-0.5">
      <span className="leading-tight font-medium wrap-break-word">{t.origen}</span>
      <span className="flex items-start gap-1 leading-tight">
        <ArrowRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        {t.destino ? <span className="font-medium wrap-break-word">{t.destino}</span> : <span className="text-muted-foreground">Destino pendiente</span>}
      </span>
    </div>
  ),
},
```

- **Ancho**: los textos largos se acomodan (`max-w-64 wrap-break-word`), no `whitespace-nowrap` con `min-w` (eso empuja "Acciones" fuera de la pantalla a 1280).
- Una fila cancelada o destacada: `claseFila` de `DataTable` con un token (`bg-destructive/5`, `bg-muted`), no colores crudos.
- Columnas que se ocultan y su dato plegado: §5.4.

## 7.6 Acciones de fila

**Para qué:** las acciones sobre una fila sin abrirla. Clases: `DESIGN.md` §3.9. Lo que agrega el caso real: **el paso del circuito va con texto; lo secundario, en íconos**; y la misma acción se ve distinta en desktop y en la tarjeta mobile.

```tsx
// Paso principal en una fila de desktop: más bajo que sm para que no estire la fila (mide lo mismo que icon-sm).
const BOTON_FILA = "h-8 gap-1.5 px-3 text-xs"

/** Acción secundaria: en desktop, ícono con tooltip; en mobile, botón a lo ancho con texto. El kit no lo trae. */
function AccionFila({ icono: Icono, label, onClick, mobile, peligro, contador }: {
  icono: LucideIcon; label: string; onClick(): void; mobile?: boolean; peligro?: boolean; contador?: number
}) {
  const marca = contador ? (
    <span aria-hidden="true" className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-bold text-destructive-foreground tabular-nums ring-2 ring-card">
      {contador > 9 ? "9+" : contador}
    </span>
  ) : null
  const nombre = contador ? `${label} (${contador})` : label
  const alClic = (e: React.MouseEvent) => { e.stopPropagation(); onClick() }

  if (mobile) {
    return (
      <Button variant="outline" onClick={alClic} className={cn("relative w-full", peligro && "text-destructive hover:bg-destructive/10 hover:text-destructive")}>
        <Icono /> {nombre}{marca}
      </Button>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={nombre} onClick={alClic}
          className={cn("relative text-muted-foreground", peligro ? "hover:bg-destructive/10 hover:text-destructive" : "hover:text-foreground")}>
          <Icono />{marca}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{nombre}</TooltipContent>
    </Tooltip>
  )
}

// La columna
{
  id: "acciones",
  titulo: "Acciones",
  alinear: "der",
  celda: (t) => (
    <div className="flex items-center justify-end gap-1">
      {t.estado === "por_consolidar" && <Button size="sm" className={BOTON_FILA} onClick={(e) => { e.stopPropagation(); consolidar(t) }}><BedDouble /> Consolidar</Button>}
      <AccionFila icono={Pencil} label="Editar" onClick={() => editar(t)} />
      <AccionFila icono={MessageSquare} label="Observaciones" contador={obs[t.id]} onClick={() => verObs(t)} />
      <AccionFila icono={XCircle} label="Cancelar" peligro onClick={() => cancelar(t)} />
    </div>
  ),
}
```

- **Un solo botón con texto por fila** (el paso que le toca a quien mira, `default`); el resto, íconos `ghost` con `aria-label` + `Tooltip`. Si una fila necesita dos pasos con texto, van **en columna** (`flex flex-col items-end gap-1`), no en fila: tres botones con texto en fila miden ~400 px y sacan la columna de la pantalla.
- Cuando no hay acción para quien mira, un texto que dice qué se espera (`text-xs text-muted-foreground`: "Esperando inicio del traslado"), no la celda vacía.
- Colores: neutro `text-muted-foreground`; peligro solo en hover (`hover:bg-destructive/10 hover:text-destructive`); confirmar `hover:bg-success/10 hover:text-success`. Nada de `emerald-*`.
- `stopPropagation` siempre que la fila tenga `onFila`. Borrar o cancelar pasa por `useConfirm` con `peligro: true`.
- El contador rojo sobre un ícono: `ring-2 ring-card` para despegarlo del borde; más de 9, "9+".

## 7.7 Selección de filas y acción masiva

**Para qué:** anular, despachar o exportar varias filas de una vez. `DataTable` no trae selección (**el kit no lo trae**): se arma con una columna de `Checkbox` y la barra de §5.7.

```tsx
const [sel, setSel] = useState<Set<string>>(new Set())
const alternar = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
const todas = filas.length > 0 && filas.every((f) => sel.has(f.id))
const algunas = !todas && filas.some((f) => sel.has(f.id))

const columnas: Columna<Fila>[] = [
  {
    id: "sel",
    titulo: "Elegir",
    clase: "w-10",
    celda: (f) => <Checkbox checked={sel.has(f.id)} onCheckedChange={() => alternar(f.id)} onClick={(e) => e.stopPropagation()} aria-label={`Elegir ${f.nombre}`} />,
  },
  // …
]

{/* "Elegir todas" va en la toolbar: el encabezado de DataTable es texto */}
<Checkbox
  id="todas"
  checked={todas ? true : algunas ? "indeterminate" : false}
  onCheckedChange={() => setSel(todas ? new Set() : new Set(filas.map((f) => f.id)))}
/>
<Label htmlFor="todas" className="text-sm">Elegir las {numero(filas.length)}</Label>

<DataTable /* … */ claseFila={(f) => (sel.has(f.id) ? "bg-muted" : undefined)} />

{sel.size > 0 && (
  <div className="barra-inferior sticky bottom-0 z-nav flex items-center justify-between gap-3 p-3 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] md:p-4">
    <p className="text-sm"><span className="cifra">{numero(sel.size)}</span> elegidos</p>
    <div className="flex gap-2">
      <Button variant="ghost" onClick={() => setSel(new Set())}>Deshacer selección</Button>
      <Button variant="destructive" onClick={anular}>Anular {numero(sel.size)}</Button>
    </div>
  </div>
)}
```

- Fila elegida: `bg-muted` (`DESIGN.md` §3.9). La acción masiva destructiva es `destructive` y pasa por `useConfirm`; una positiva (despachar) es `default`.
- Al cambiar filtros o búsqueda, la selección se limpia (o se recorta a las filas visibles): nunca se anula algo que el usuario ya no ve.

## 7.8 Filas agrupadas y expandibles

**Para qué:** subgrupos (por sucursal, por día) y filas con detalle desplegable. Clases: `DESIGN.md` §3.9; el libro mayor agrupado por evento: `EJEMPLOS.md` §2. `DataTable` no agrupa ni expande (**el kit no lo trae**): se arma con `table.tsx` dentro de la card de la tabla.

```tsx
<div className="overflow-hidden rounded-lg border bg-card shadow-xs">
  <Table>
    <TableHeader>{/* … */}</TableHeader>
    <TableBody>
      {grupos.map((g) => (
        <Fragment key={g.clave}>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={COLS} className="micro bg-muted/50 py-2 text-muted-foreground">{g.clave}</TableCell>
          </TableRow>
          {g.filas.map((f) => {
            const abierta = abiertas.has(f.id)
            return (
              <Fragment key={f.id}>
                <TableRow className={cn("cursor-pointer", abierta && "bg-muted")} onClick={() => alternar(f.id)}>
                  <TableCell className="w-8">
                    <Button variant="ghost" size="icon-sm" aria-expanded={abierta} aria-label={abierta ? "Ocultar detalle" : "Ver detalle"}>
                      <ChevronDown className={cn("transition-transform duration-200", !abierta && "-rotate-90")} />
                    </Button>
                  </TableCell>
                  {/* … celdas … */}
                </TableRow>
                {abierta && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={COLS} className="p-0"><div className="bg-muted/10 p-4">{/* detalle */}</div></TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </Fragment>
      ))}
    </TableBody>
  </Table>
</div>
```

- Los grupos respetan el **orden de primera aparición** (agrupar con un `Map`, no ordenar alfabético por la clave).
- En mobile: el título del grupo como `micro` encima de sus tarjetas; el detalle desplegable, adentro de la tarjeta.

## 7.9 Cards de datos

**Card clickeable de un sector o módulo** (inicio: un número, su tendencia y a dónde lleva):

```tsx
<Card size="sm" className="relative transition-shadow hover:border-brand/30 hover:shadow-md">
  <CardContent className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <div className="ficha size-8 bg-brand/10 text-brand"><Wallet className="size-4" aria-hidden="true" /></div>
      {/* El botón cubre toda la card (after:inset-0): un solo elemento enfocable */}
      <button type="button" onClick={abrir} className="titulo text-left outline-hidden after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">
        Caja
      </button>
    </div>
    {/* Sparkline: DATAVIZ.md §4.9 (alto 52) */}
    <div className="flex items-center justify-between gap-2 border-t pt-2.5 text-xs text-muted-foreground">
      <span>Saldo</span><span className="cifra text-foreground">{dinero(saldo)}</span>
    </div>
  </CardContent>
</Card>
```

**Pastilla de métrica en la esquina** (un número que acompaña a un título): `inline-flex items-baseline gap-1 rounded-full bg-brand/10 px-2.5 py-1` con el valor `text-sm font-bold tabular-nums text-brand` y la etiqueta `text-[10px] uppercase`. Si pide atención, `bg-warning/10 text-warning`. Es un acento de dashboard (`DESIGN.md` §1.1), no un estado.

**Card de una nota en un hilo** (observaciones, comentarios): `rounded-lg border bg-card p-3 shadow-xs`, texto `text-sm leading-snug whitespace-pre-wrap wrap-break-word`, al pie `mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground` con autor `font-medium text-foreground` · `fechaHora()` · etapa en itálica. Lo más nuevo abajo, pegado al redactor; el hilo scrollea solo al final al cargar.

**Tarjeta de fila mobile**: §5.4. **KPI**: `Kpi`, nunca una card de métrica a mano.

## 7.10 Grilla densa y exportar

**Para qué:** planillas (grid views) que se leen con scroll en las dos direcciones en todos los tamaños: sin tarjetas mobile, encabezado fijo, alto hasta el fondo de la pantalla. El `<th>` y los montos: `DESIGN.md` §3.9; exportar a Excel: `EJEMPLOS.md` §11.

```tsx
/** Alto disponible desde el borde de arriba del elemento hasta el fondo del viewport (sin doble scroll). El kit no lo trae. */
export function useAlturaDisponible(reserva = 24) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [alto, setAlto] = useState<number>()
  useLayoutEffect(() => {
    if (!el) return
    const medir = () => setAlto(Math.max(220, Math.floor(window.innerHeight - el.getBoundingClientRect().top - reserva)))
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(document.body)
    window.addEventListener("resize", medir)
    return () => { ro.disconnect(); window.removeEventListener("resize", medir) }
  }, [el, reserva])
  return { ref: setEl, alto }
}

const { ref, alto } = useAlturaDisponible()
<div ref={ref} style={{ height: alto }} className="isolate overflow-auto rounded-lg border bg-card shadow-xs">
  <table className="w-full text-[13px]">
    <thead>
      <tr>{cols.map((c) => <th key={c.id} className="micro sticky top-0 z-10 bg-muted/60 px-3 py-2.5 text-left whitespace-nowrap text-muted-foreground backdrop-blur-sm">{c.titulo}</th>)}</tr>
    </thead>
    <tbody>
      {filas.map((f) => <tr key={f.id} className="border-b align-top last:border-0 hover:bg-muted/30">{/* celdas; montos font-mono tabular-nums text-right */}</tr>)}
    </tbody>
  </table>
</div>
```

- `isolate` en el contenedor permite el `z-10` local del encabezado (BASE §2).
- Arriba de la grilla, chips de totales de lo filtrado: cada uno `rounded-lg border bg-card px-3 py-1.5 text-xs` con la etiqueta `micro text-muted-foreground` y el valor `cifra`.

---

## 8.3 Variantes de modal

Además del formulario (§4.1), todas sobre `Dialog` (y su `DialogContent`, que pone fondo, capa y radio):

| Variante | Ancho | Qué la distingue |
|---|---|---|
| Vista previa de archivo (PDF, imagen) | `sm:max-w-5xl` + `h-[85dvh]` | Cuerpo con `<iframe>` o `<img className="size-full object-contain">`, sin pie; el fondo puede ir a `bg-black/80` (lightbox, `DESIGN.md` §1.3) con `DialogOverlay` |
| Checkout en dos columnas | `sm:max-w-4xl` | `EJEMPLOS.md` §4 |
| Formulario + contenido (resumen a un lado) | `sm:max-w-4xl` / `5xl` | Cuerpo `flex flex-col md:flex-row`: `md:w-1/3 md:border-r` (formulario) + `md:w-2/3` (contenido), cada uno con su scroll |
| Conciliación (cierre de caja) | `sm:max-w-md` | Recuadro de diferencia de `EJEMPLOS.md` §10 |
| Drill-down de un gráfico | `sm:max-w-6xl` | `DATAVIZ.md` §4.10 |
| Modal de caja (ingreso / egreso) | `sm:max-w-md` / `lg` | Header con tinte del signo: `bg-linear-to-br from-success/10 to-transparent` (ingreso) o `from-destructive/10` (egreso) + tile `size-10 rounded-lg bg-success/10 text-success` |
| Anidado (un modal que abre otro) | según el contenido | Otro `Dialog` adentro: Radix los apila y maneja el foco. No un overlay `absolute` a mano |

## 8.5 Sidebar: lo que el `AppShell` no trae

El sidebar está completo en `DESIGN.md` §4.1 (tokens `sidebar-*`, colapsado, grupos, contador, usuario al pie). Del original quedan tres piezas que **el `AppShell` del kit no trae** (candidatas):

- **Módulo "en desarrollo"**: el ítem se ve pero no navega. `aria-disabled="true"`, `pointer-events-none opacity-50` y una pastilla `ml-auto rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning` con "Pronto". Hoy hay que agregarle a `ItemNav` un `deshabilitado?: boolean` y un `etiqueta?: string`.
- **Grupo colapsado con menú flotante**: con la sidebar en riel, un grupo muestra su ícono y al pasar o enfocar abre un `DropdownMenu` (`side="right"`, `align="start"`) con los ítems; si algún hijo tiene contador, punto `size-2 rounded-full bg-destructive ring-2 ring-sidebar` sobre el ícono.
- **"Cerrar sesión" con cambios sin guardar**: el ítem del menú de usuario pasa por la guardia (§8.8) antes del `useConfirm`. Para que los ítems del nav también la respeten, el `AppShell` necesita un `antesDeNavegar?(seguir: () => void): boolean` (no lo trae).

## 8.6 Header: ubicación, breadcrumb e idioma

**Ubicación / breadcrumb** — va en `AppShell.ubicacion` (`DESIGN.md` §4.2): en desktop a la izquierda del header, en mobile en lugar de la marca.

```tsx
<nav aria-label="Ubicación" className="flex min-w-0 items-center gap-2 text-sm">
  <span className="truncate text-muted-foreground">{sucursal}</span>
  <span className="text-muted-foreground/50" aria-hidden="true">/</span>
  <span className="titulo truncate" aria-current="page">{pantalla}</span>
</nav>
```

Más de dos niveles, no: si hace falta, la pantalla tiene un "Volver" (`ghost`, `ArrowLeft`) en su `PageHeader` (`EJEMPLOS.md` §1).

**Selector de idioma** — en `AppShell.acciones`, al lado del selector de tema:

```tsx
<div role="group" aria-label="Idioma" className="flex items-center rounded-full border bg-muted/50 p-1">
  {IDIOMAS.map((i) => (
    <button key={i.id} type="button" aria-pressed={idioma === i.id} onClick={() => setIdioma(i.id)}
      className={cn("flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        idioma === i.id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
      <img src={i.bandera} alt="" className="h-3 w-4 rounded-sm" /> {i.corto}
    </button>
  ))}
</div>
```

**Usuario**: en el pie de la sidebar (`AppShell.usuario`), no en el header. El avatar usa el fallback de marca (`DESIGN.md` §2, `avatar`).

## 8.7 Sub-navegación en pastillas

Tabs de un dashboard: `TabsList variant="line"` (`DESIGN.md` §3.8). Una **segunda** fila de navegación adentro de un tab (sub-secciones) va en pastillas, para que no compita con la primera:

```tsx
<TabsList className="h-auto gap-1 rounded-xl border bg-muted/30 p-1">
  <TabsTrigger value="mes" className="data-active:text-brand">Por mes</TabsTrigger>
  <TabsTrigger value="sucursal" className="data-active:text-brand">Por sucursal</TabsTrigger>
</TabsList>
```

La activa en `text-brand` solo en dashboards (como el tab o filtro activo, `DESIGN.md` §1.1); en una vista operativa, el `TabsList` default sin agregados. El panel activo re-anima con `key={tab}` (`DATAVIZ.md` §5).

## 8.8 navigationGuard (cambios sin guardar)

**Para qué:** que salir de una pantalla con cambios sin guardar pida confirmación (nav, "Cerrar sesión", cerrar la pestaña). La regla está en `EJEMPLOS.md` §11; esto es el código.

**Con un router de datos** (`createBrowserRouter` / `createHashRouter`), `useBlocker`:

```tsx
const confirmar = useConfirm()
const bloqueo = useBlocker(hayCambios)
useEffect(() => {
  if (bloqueo.state !== "blocked") return
  confirmar({ titulo: "¿Descartar los cambios?", descripcion: "Hay cambios que no se guardaron.", accion: "Descartar cambios", peligro: true })
    .then((si) => (si ? bloqueo.proceed() : bloqueo.reset()))
}, [bloqueo, confirmar])
```

**Sin router de datos** (`HashRouter` de las demos, o apps sin router), un registro único:

```ts
// src/lib/salida.ts
type Guardia = (seguir: () => void) => void
let guardia: Guardia | null = null

export const setGuardia = (fn: Guardia) => { guardia = fn }
export const limpiarGuardia = () => { guardia = null }

/** true: se puede salir ya. false: la guardia preguntó y va a llamar a `seguir` si confirman. */
export function intentarSalir(seguir: () => void): boolean {
  if (!guardia) return true
  guardia(seguir)
  return false
}
```

```tsx
// En la pantalla con cambios
const confirmar = useConfirm()
useEffect(() => {
  if (!hayCambios) return
  setGuardia(async (seguir) => {
    if (await confirmar({ titulo: "¿Descartar los cambios?", descripcion: "Hay cambios que no se guardaron.", accion: "Descartar cambios", peligro: true })) seguir()
  })
  const alCerrarPestana = (e: BeforeUnloadEvent) => e.preventDefault()
  window.addEventListener("beforeunload", alCerrarPestana)
  return () => { limpiarGuardia(); window.removeEventListener("beforeunload", alCerrarPestana) }
}, [hayCambios, confirmar])

// En el nav o en "Cerrar sesión"
onClick={(e) => { if (!intentarSalir(() => navigate(to))) e.preventDefault() }}
```

- Una sola guardia por vez (la de la pantalla montada); se limpia al desmontar y al guardar.
- Nunca `window.confirm`: siempre `useConfirm` (el validador lo marca).

---

## 9.2 Barras de progreso

| Caso | Cómo |
|---|---|
| Determinada (%) | `Progress` del kit (`DESIGN.md` §2): `<Progress value={pct} aria-label="Importando" />` |
| Que se vacía (cierre automático) | §3.15 (`scale-x` con transición) |
| Indeterminada (subida sin %) | **El kit no la trae**: hace falta un keyframe en el `index.css` del proyecto (abajo) |

```css
/* src/index.css del proyecto, dentro de @theme */
--animate-indeterminado: indeterminado 1.5s ease-in-out infinite;
@keyframes indeterminado { from { transform: translateX(-100%); } to { transform: translateX(400%); } }
```

```tsx
<div role="progressbar" aria-label="Subiendo archivo" className="relative h-1 overflow-hidden rounded-full bg-muted">
  <div className="h-full w-1/4 rounded-full bg-primary animate-indeterminado motion-reduce:w-full motion-reduce:animate-pulse" />
</div>
```

---

## 12.1 Login split-screen

**Para qué:** la pantalla de ingreso propia. Clases: `DESIGN.md` §3.5; bloqueo por intentos y recuperar: `EJEMPLOS.md` §8. El esqueleto, como `PantallaAcceso` para reusarlo en otras pantallas públicas ("¿Quién sos?" de una cuenta compartida, cambio de contraseña):

```tsx
function PantallaAcceso({ titulo, bajada, children }: { titulo: string; bajada: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background animate-in fade-in-0 duration-500">
      {/* Panel de marca: solo desde md */}
      <div className="panel-marca relative hidden flex-col justify-between overflow-hidden p-12 md:flex md:w-1/2 lg:w-3/5">
        {/* Opcional, foto de fondo: el texto sigue en brand-foreground */}
        {FOTO && <img src={FOTO} alt="" className="absolute inset-0 size-full object-cover opacity-30 mix-blend-luminosity" />}
        {FOTO && <div className="absolute inset-0 bg-linear-to-t from-brand via-brand/40 to-transparent" />}
        <Logo className="relative h-10 w-auto" />
        <div className="relative">
          <h1 className="mb-6 text-4xl leading-tight font-bold tracking-tight lg:text-5xl">{NOMBRE_APP}</h1>
          <p className="max-w-md border-l-2 border-brand-foreground/30 pl-4 text-sm opacity-80">Una línea que dice para qué sirve la app.</p>
        </div>
        <p className="relative text-xs tracking-wider uppercase opacity-60">{CLIENTE}</p>
      </div>

      {/* Formulario */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Isotipo className="mb-6 size-12 md:hidden" />
          <h2 className="text-3xl font-bold tracking-tight">{titulo}</h2>
          <p className="mb-6 text-sm text-muted-foreground">{bajada}</p>
          {children}
        </div>
      </div>
    </div>
  )
}

<PantallaAcceso titulo="Bienvenido" bajada="Ingresá con tu usuario.">
  <form onSubmit={ingresar} noValidate className="flex flex-col gap-4">
    {error && (
      <div role="alert" className="flex items-start gap-2 rounded-r-md border-l-4 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive animate-in fade-in-0 slide-in-from-top-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> El email o la contraseña no coinciden.
      </div>
    )}
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor="login-usuario">Usuario o email</FieldLabel>
      <InputGroup className="h-11">
        <InputGroupAddon><Mail /></InputGroupAddon>
        <InputGroupInput id="login-usuario" autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} aria-invalid={!!error || undefined} />
      </InputGroup>
    </Field>
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor="login-clave">Contraseña</FieldLabel>
      {/* §6.8, con h-11 */}
    </Field>
    <Button type="submit" disabled={entrando || bloqueado} className="mt-2 h-11 w-full">
      {entrando ? <><Loader2 className="animate-spin" /> Verificando…</> : <>Ingresar <ArrowRight /></>}
    </Button>
  </form>
  <p className="mt-6 text-center font-mono text-xs text-muted-foreground/70">{VERSION}</p>
</PantallaAcceso>
```

- **Panel de marca con `panel-marca`** (tokens `brand` / `brand-foreground`): sin `text-white`, sin degradés negros. Una marca de agua del logo, si se quiere, va `absolute -right-32 -bottom-40 opacity-5 pointer-events-none`.
- **Campos y botón `h-11`** (`DESIGN.md` §3.5), botón `default` a lo ancho; nada de `text-base`, sombras de color ni `hover:scale`.
- El error **no revela si el usuario existe** y aparece arriba del formulario; los dos campos quedan `aria-invalid`.
- En mobile solo el formulario, con el isotipo arriba. Nada de `min-h-screen`: `min-h-dvh`.
- Lo que no es del login (diagnóstico de IP, aviso de entorno de prueba) va debajo, separado con `mt-6 border-t pt-4`, en `text-xs text-muted-foreground`.

---

## Lo que no se trajo y por qué

| § original | Qué | Por qué |
|---|---|---|
| 0 · R | Arranque a mano (postcss, `index.html`, cableado) y prompts de refactor | Lo hace `scripts/armar.mjs`; el refactor está en `REDISENO.md` y BASE §9. |
| 1.2 · 1.3 · 1.5 | `tailwind.config.js`, `index.css` de Tailwind 3, marca en HSL con `<alpha-value>` (y la regla de oro 14) | Tailwind 4: el tema vive en `@theme` del `index.css` del estilo y `brand` está en `@theme inline` (las opacidades salen solas). |
| 1.4 | Paleta semántica cruda (`emerald` / `amber` / `red` / `blue` / `sky` / `indigo` / `violet` / `slate`), tintes `WINE_SHADES`, hex de recharts, foco `ring-primary/40`, escala de z-index de 13 niveles | Tokens `success` / `warning` / `info` / `destructive` + tonos de `StatusBadge` (§3.11 de acá), `chart-*` validados (`DATAVIZ.md`), foco con `ring` (`DESIGN.md` §1.8), cinco capas (BASE §2). |
| 1.4 | "El modo noche nunca se activa" | El kit tiene noche de verdad (`DESIGN.md` §5). |
| 2 · 9.6 | `useModalAnimation`, clases `.modal-enter/exit`, `backdropClose` | Radix + `tw-animate-css` (`data-open` / `data-closed`) animan la salida; Radix no cierra cuando la selección de texto empieza adentro y suelta afuera (el cierre exige el `pointerdown` afuera). |
| 3.1–3.10 · 3.16 | Primitivos escritos a mano con `forwardRef`, Tabs sin Radix, Select/Combobox portaleados con `zIndex: 999999` | Componentes del starter (shadcn sobre Radix, React 19). |
| 3.8 · 4.6 · 7.11 | `StatCard`, `KpiCard` (con `accent`, `budget`), tile de KPI con ícono, `DeltaChip` | `Kpi` / `KpiGrid` (BASE §4, `DESIGN.md` §3.4). Un KPI destacado no se pinta con la marca (`DATAVIZ.md` §5). |
| 3.13 | Toast propio (`useToast`) | `sonner` (`toast.success` / `toast.error`). |
| 3.14 | `TooltipHost` global que convierte todo `title=` | `Tooltip` de Radix en cada botón-ícono + `aria-label`. Un `title` nativo sigue siendo válido como ayuda secundaria, no como tooltip del kit. |
| 3.18 | DatePicker con el día elegido en marca | Día elegido en `primary` (`DESIGN.md` §2, `calendar`). |
| 4.2 | `ConfirmModal` con `z-[9999]` | `useConfirm` (`DESIGN.md` §3.6). |
| 4.3 | Botón "Ir al módulo" en `bg-brand text-white` | `Button` default (la marca no va en botones). |
| 4.5 · 8.5 | Layout con `h-screen`, nav activo `bg-primary`, contador `bg-red-500 text-white` | `AppShell` con tokens `sidebar-*` y contador `bg-destructive` (`DESIGN.md` §4.1). |
| 4.6 · 10 | `shared.tsx` (formatos `en-US`, `toFixed`, grilla punteada, gradientes de área, radar, doble eje, `shade(i)` en barras) | `DATAVIZ.md` + `formato.ts` (es-AR) + skills `business-intelligence` y `dataviz`. |
| 4.7 | `SeasonPicker` (temporadas septiembre → agosto de Kautapen); `mb-5` en la barra; toggle con `bg-brand/[0.06]` y conteo `text-white` | Dominio de otro cliente → `DateRangePicker`. La barra no lleva margen propio (el `gap` de la página); `bg-brand/5` y `text-brand-foreground`. |
| 5.5 · 5.8 | `max-h-[90vh]`, `md:h-[calc(100vh-140px)]` | `dvh` siempre (BASE §6). |
| 5.10 | Header mobile `fixed` con `mt-16` en el contenido, drawer con `useModalAnimation` | `AppShell` (header `z-header` + `Sheet` izquierdo). |
| 5.12 | Cuerpo `text-sm sm:text-base`, números que crecen con el viewport | `DESIGN.md` §4.3: el cuerpo no crece en desktop, crece el gutter. |
| 5.13 | Controles `h-9` y botones-ícono `h-8` en mobile como deuda | El kit ya resolvió: `h-10` mínimo en mobile, `md:h-9` en toolbars de desktop. |
| 6.2 | Error de campo `text-[10px]` con ícono, borde rojo por clase | `FieldError` (`text-xs`, `role="alert"`) + `aria-invalid`. |
| 6.4 | Checkbox a mano y nativo con `accent-brand` | `Checkbox` del kit (marcado = `primary`). |
| 6.10 · 7.2 | `text-emerald-600` / `text-red-500` y `toFixed(2)` | `text-success` / `text-destructive` + `dinero()`. |
| 7.4 · 7.5 | Paginación y orden a mano | `DataTable` (`porPagina`, `ordenar`, `orden` / `onOrden`). |
| 7.6 · 7.7 | Acción `text-emerald-600`, checkbox `accent-brand`, acción masiva `bg-red-600` / `bg-emerald-600` | Tokens + variantes de `Button` (§7.6 y §7.7 de acá). |
| 8.1 · 8.3 | Modales de dashboard `bg-black/40` sin blur, `z-[1000]`, `rounded-2xl`, `max-w-[1200px]`; checkout con header `bg-zinc-900 text-white`; overlay anidado `absolute` | Un solo fondo (`bg-black/60`, `DialogOverlay`), `sm:max-w-6xl`, `rounded-xl`; Radix apila los anidados. |
| 8.4 | Patrón de popover portaleado y el hook `useAnchoredPortal` | Popover / DropdownMenu / Select de Radix. |
| 8.6 | Bloque de usuario en el header desktop; idioma con la activa en `primary` en mobile | Usuario en el pie de la sidebar; el selector de idioma igual en todos los tamaños. |
| 9.1 | "No hay skeletons" | El kit trae `Skeleton` (`DESIGN.md` §3.7). |
| 9.4 | Banner `bg-amber-100 border-l-4 … shadow-sm` | Banner suave y con acento de `DESIGN.md` §1.1 / §3.7. |
| 12.1 | Inputs `h-12 bg-secondary/30`, botón `text-base shadow-lg shadow-primary/20 hover:scale-[1.01]`, título `text-primary`, degradés `from-black/80`, `text-gray-200`, logo con `brightness-0 invert` | `DESIGN.md` §3.5: `h-11`, `panel-marca`, tokens. (MediFlow los conserva con `sumar-validar-ignorar`; una app nueva no.) |
| 13 | `BRAND` de emails con un hex propio | `EJEMPLOS.md` §6 (`MARCA` = `--brand`). |
| 14 | Permisos fail-open (todo rol desconocido ve todo) | `EJEMPLOS.md` §7: fail-closed. |
| 15 | Reglas de oro 2, 5, 6, 10, 11, 12, 14, 19 | Reemplazadas por `DESIGN.md` §6 + BASE §8 (marca en un token, Radix, `sonner`, tokens semánticos, `tw-animate-css`, capas). |
