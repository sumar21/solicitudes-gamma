import * as React from "react"

import { Input } from "@/components/ui/input"
import { numero, parseDinero } from "@/lib/formato"
import { cn } from "@/lib/utils"

/**
 * Máscara es-AR mientras se tipea: `.` agrupa miles y `,` separa decimales
 * (`1234,5` → `1.234,5`). Si el texto trae los dos separadores, el último
 * que aparece es el decimal (así se puede pegar `1,234.56` o `1.234,56`).
 */
function enmascarar(crudo: string, decimales: number): string {
  const negativo = crudo.trim().startsWith("-")
  const s = crudo.replace(/[^0-9.,]/g, "")
  if (s === "") return negativo ? "-" : ""

  let entero: string
  let decimal = ""
  let conDecimal = false
  const coma = s.lastIndexOf(",")
  const punto = s.lastIndexOf(".")
  if (coma !== -1 && punto !== -1) {
    const corte = Math.max(coma, punto)
    entero = s.slice(0, corte).replace(/\D/g, "")
    decimal = s.slice(corte + 1).replace(/\D/g, "")
    conDecimal = true
  } else if (coma !== -1) {
    entero = s.slice(0, coma).replace(/\D/g, "")
    decimal = s.slice(coma + 1).replace(/\D/g, "")
    conDecimal = true
  } else {
    entero = s.replace(/\D/g, "")
  }

  entero = entero.replace(/^0+(?=\d)/, "")
  let agrupado = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  if (conDecimal && decimales > 0) {
    if (agrupado === "") agrupado = "0"
    agrupado = `${agrupado},${decimal.slice(0, decimales)}`
  }
  return (negativo ? "-" : "") + agrupado
}

const formatear = (v: number | null, decimales: number) => (v == null ? "" : numero(v, { decimales }))

export interface MoneyInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type"> {
  value: number | null
  onValueChange: (v: number | null) => void
  /** Decimales permitidos (por defecto 2). */
  decimales?: number
}

/**
 * Input de dinero con máscara es-AR (`1.234,56`) y prefijo `$`. Trabaja con
 * números: recibe `value: number | null` y avisa con `onValueChange`. Al salir
 * del campo completa los decimales. (Para montos nunca un input numérico nativo.)
 */
export function MoneyInput({
  value,
  onValueChange,
  decimales = 2,
  className,
  onBlur,
  placeholder,
  ...props
}: MoneyInputProps) {
  const [texto, setTexto] = React.useState(() => formatear(value, decimales))
  const [previo, setPrevio] = React.useState(value)

  // Si el valor cambia desde afuera (reset del formulario, carga de datos),
  // reescribimos el texto; si cambió porque el usuario tipeó, lo dejamos.
  if (value !== previo) {
    setPrevio(value)
    if (value !== parseDinero(texto)) setTexto(formatear(value, decimales))
  }

  return (
    <div data-slot="money-input" className="relative w-full">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
      >
        $
      </span>
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder ?? (decimales > 0 ? `0,${"0".repeat(decimales)}` : "0")}
        className={cn("pl-7 tabular-nums", className)}
        value={texto}
        onChange={(e) => {
          const nuevo = enmascarar(e.target.value, decimales)
          setTexto(nuevo)
          const n = parseDinero(nuevo)
          setPrevio(n)
          onValueChange(n)
        }}
        onBlur={(e) => {
          setTexto(formatear(parseDinero(texto), decimales))
          onBlur?.(e)
        }}
        {...props}
      />
    </div>
  )
}
