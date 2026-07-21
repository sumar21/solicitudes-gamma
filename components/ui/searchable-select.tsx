import * as React from "react"
import { Check, ChevronDown, Search } from "lucide-react"
import { cn } from "../../lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

interface Option {
  label: string;
  value: string;
}

interface SearchableSelectProps {
  options: Option[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  showSearch?: boolean;
  /** Alto máx. de la lista (clase Tailwind). Default "max-h-[200px]". */
  listMaxHeight?: string;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  className,
  showSearch = true,
  listMaxHeight = "max-h-[200px]"
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = React.useMemo(() => {
    if (!search) return options;
    const lowerSearch = search.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(lowerSearch));
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-400 focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200",
            className
          )}
        >
          {/* `min-w-0` es lo que hace funcionar al `truncate`: un hijo de flex arranca con
              min-width:auto, así que se niega a achicarse por debajo de su contenido y el
              overflow:hidden nunca llega a activarse. Sin esto, una opción larga (p. ej.
              "Internación Transitoria HPR - Cama 08 (Shockroom 2) (APELLIDO NOMBRE)") estira
              el botón, y con él la grilla del form y el ancho del modal entero.
              `shrink-0` en el chevron para que el texto no se lo coma al achicarse. */}
          <span className="block flex-1 min-w-0 truncate text-left">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 rounded-xl" align="start">
        {showSearch && (
          <div className="flex items-center border-b border-slate-100 px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        )}
        <div className={cn("overflow-y-auto p-1", listMaxHeight)}>
          {filteredOptions.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">No se encontraron resultados.</div>
          ) : (
            filteredOptions.map((option) => (
              <div
                key={option.value}
                className={cn(
                  "relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none transition-colors hover:bg-slate-100 hover:text-slate-900",
                  value === option.value ? "bg-slate-50 font-medium" : ""
                )}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                  setSearch("");
                }}
              >
                {value === option.value && (
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    <Check className="h-4 w-4 text-slate-700" />
                  </span>
                )}
                {/* mismo motivo que en el trigger: sin min-w-0 el truncate no corta y la
                    opción larga se desborda del ancho del popover. */}
                <span className="min-w-0 truncate">{option.label}</span>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
