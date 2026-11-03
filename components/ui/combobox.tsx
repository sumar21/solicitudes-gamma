import * as React from "react"
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface OpcionCombobox {
  value: string
  label: string
}

interface BaseProps {
  opciones: OpcionCombobox[]
  placeholder?: string
  /** Texto cuando la búsqueda no encuentra nada. */
  vacio?: string
  /** Placeholder del buscador ("Buscar cama…"). Por defecto "Buscar…". */
  buscar?: string
  id?: string
  disabled?: boolean
  className?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
}

const claseTrigger =
  "w-full justify-between gap-2 px-3 font-normal has-[>svg]:px-3 data-[vacio=true]:text-muted-foreground aria-invalid:border-destructive"

// Lista con buscador (cmdk): teclado, filtro y ARIA vienen de cmdk + Radix.
function Lista({
  opciones,
  vacio,
  buscar = "Buscar…",
  elegido,
  onElegir,
  onLimpiar,
  multiple = false,
}: {
  multiple?: boolean
  opciones: OpcionCombobox[]
  vacio: string
  buscar?: string
  elegido: (v: string) => boolean
  onElegir: (v: string) => void
  onLimpiar?: () => void
}) {
  return (
    <Command>
      <CommandInput placeholder={buscar} />
      <CommandList>
        <CommandEmpty>{vacio}</CommandEmpty>
        <CommandGroup>
          {opciones.map((o) => (
            <CommandItem
              key={o.value}
              value={o.value}
              keywords={[o.label]}
              data-checked={!multiple && elegido(o.value)}
              aria-checked={elegido(o.value)}
              onSelect={() => onElegir(o.value)}
            >
              {multiple && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-sm border border-muted-foreground",
                    elegido(o.value) && "border-primary bg-primary text-primary-foreground"
                  )}
                >
                  {elegido(o.value) && <CheckIcon className="size-3" />}
                </span>
              )}
              <span className="truncate">{o.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      {onLimpiar && (
        <>
          <CommandSeparator />
          <div className="p-1">
            <Button variant="ghost" size="sm" className="w-full justify-center" onClick={onLimpiar}>
              Limpiar
            </Button>
          </div>
        </>
      )}
    </Command>
  )
}

/** `obligatorio`: el campo no puede quedar vacío (no se desmarca ni se limpia) y onChange recibe siempre un string. */
export type ComboboxProps = BaseProps &
  (
    | { obligatorio: true; value: string | null; onChange: (v: string) => void }
    | { obligatorio?: false; value: string | null; onChange: (v: string | null) => void }
  )

/** Una opción, con búsqueda. Elegir la opción marcada la desmarca (salvo `obligatorio`). */
export function Combobox({
  opciones,
  value,
  onChange,
  obligatorio = false,
  placeholder = "Seleccionar…",
  vacio = "Sin resultados",
  buscar,
  className,
  ...extras
}: ComboboxProps) {
  const cambiar = onChange as (v: string | null) => void
  const [abierto, setAbierto] = React.useState(false)
  const actual = opciones.find((o) => o.value === value)

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={abierto}
          data-vacio={!actual}
          className={cn(claseTrigger, className)}
          {...extras}
        >
          <span className="truncate">{actual ? actual.label : placeholder}</span>
          <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Lista
          opciones={opciones}
          vacio={vacio}
          buscar={buscar}
          elegido={(v) => v === value}
          onElegir={(v) => {
            if (v !== value) cambiar(v)
            else if (!obligatorio) cambiar(null)
            setAbierto(false)
          }}
          onLimpiar={
            value != null && !obligatorio
              ? () => {
                  cambiar(null)
                  setAbierto(false)
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  )
}

export interface MultiComboboxProps extends BaseProps {
  value: string[]
  onChange: (v: string[]) => void
  /** Cuántos chips mostrar en el botón antes de pasar a "+N". Por defecto 2. */
  maxChips?: number
}

/** Varias opciones, con búsqueda. El botón muestra chips y un contador "+N". */
export function MultiCombobox({
  opciones,
  value,
  onChange,
  placeholder = "Seleccionar…",
  vacio = "Sin resultados",
  maxChips = 2,
  buscar,
  className,
  ...extras
}: MultiComboboxProps) {
  const [abierto, setAbierto] = React.useState(false)
  const elegidas = opciones.filter((o) => value.includes(o.value))
  const visibles = elegidas.slice(0, maxChips)
  const resto = elegidas.length - visibles.length

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={abierto}
          data-vacio={elegidas.length === 0}
          className={cn(claseTrigger, className)}
          {...extras}
        >
          {elegidas.length === 0 ? (
            <span className="truncate">{placeholder}</span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {visibles.map((o) => (
                <span
                  key={o.value}
                  className="min-w-0 truncate rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                >
                  {o.label}
                </span>
              ))}
              {resto > 0 && (
                <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                  +{resto}
                </span>
              )}
              <span className="sr-only">{`${elegidas.length} seleccionadas`}</span>
            </span>
          )}
          <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Lista
          multiple
          opciones={opciones}
          vacio={vacio}
          buscar={buscar}
          elegido={(v) => value.includes(v)}
          onElegir={(v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])}
          onLimpiar={value.length > 0 ? () => onChange([]) : undefined}
        />
      </PopoverContent>
    </Popover>
  )
}

/** Chips sueltos para mostrar lo elegido fuera del combo, con botón para quitar cada uno. */
export function ChipsSeleccion({
  opciones,
  value,
  onChange,
}: {
  opciones: OpcionCombobox[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  const elegidas = opciones.filter((o) => value.includes(o.value))
  if (elegidas.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {elegidas.map((o) => (
        <span
          key={o.value}
          className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-xs font-medium text-secondary-foreground"
        >
          {o.label}
          <button
            type="button"
            aria-label={`Quitar ${o.label}`}
            onClick={() => onChange(value.filter((x) => x !== o.value))}
            className="rounded-full p-0.5 outline-hidden hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
