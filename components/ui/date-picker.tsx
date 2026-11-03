import * as React from "react"
import type { DateRange } from "react-day-picker"
import { CalendarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { fecha } from "@/lib/formato"
import { cn } from "@/lib/utils"

interface ExtrasTrigger {
  id?: string
  disabled?: boolean
  className?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
}

const claseTrigger =
  "w-full justify-start gap-2 px-3 text-left font-normal has-[>svg]:px-3 data-[vacio=true]:text-muted-foreground aria-invalid:border-destructive"

export interface DatePickerProps extends ExtrasTrigger {
  value?: Date
  onChange: (d?: Date) => void
  placeholder?: string
}

/** Fecha suelta: botón con la fecha en formato es-AR + calendario en un Popover. */
export function DatePicker({ value, onChange, placeholder = "Elegir fecha", className, ...extras }: DatePickerProps) {
  const [abierto, setAbierto] = React.useState(false)

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button variant="outline" data-vacio={!value} className={cn(claseTrigger, className)} {...extras}>
          <CalendarIcon className="text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{value ? fecha(value) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          defaultMonth={value}
          onSelect={(d) => {
            onChange(d)
            setAbierto(false)
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

/** Dos meses lado a lado desde md; uno solo en mobile (no entra en 390 px). */
function useDosMeses() {
  const consulta = "(min-width: 768px)"
  const [dos, setDos] = React.useState(() => typeof window !== "undefined" && window.matchMedia(consulta).matches)
  React.useEffect(() => {
    const mq = window.matchMedia(consulta)
    const alCambiar = () => setDos(mq.matches)
    mq.addEventListener("change", alCambiar)
    return () => mq.removeEventListener("change", alCambiar)
  }, [])
  return dos
}

export interface DateRangePickerProps extends ExtrasTrigger {
  value?: DateRange
  onChange: (r?: DateRange) => void
  placeholder?: string
}

/** Período (desde–hasta): un Popover con el calendario en modo rango. */
export function DateRangePicker({
  value,
  onChange,
  placeholder = "Elegir período",
  className,
  ...extras
}: DateRangePickerProps) {
  const dosMeses = useDosMeses()
  const texto = value?.from
    ? value.to
      ? `${fecha(value.from)} – ${fecha(value.to)}`
      : `Desde ${fecha(value.from)}`
    : placeholder

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" data-vacio={!value?.from} className={cn(claseTrigger, className)} {...extras}>
          <CalendarIcon className="text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{texto}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value}
          defaultMonth={value?.from}
          onSelect={onChange}
          numberOfMonths={dosMeses ? 2 : 1}
          autoFocus
        />
        {value?.from && (
          <div className="flex justify-end border-t p-2">
            <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>
              Limpiar
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export type { DateRange }
