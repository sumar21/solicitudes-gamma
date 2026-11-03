import * as React from "react"
import { CircleHelpIcon, TriangleAlertIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

export interface OpcionesConfirmar {
  titulo: string
  descripcion?: React.ReactNode
  /** Texto del botón de confirmar. Por defecto "Confirmar" (o "Eliminar" si es peligro). */
  accion?: string
  /** Texto del botón de cancelar. Por defecto "Cancelar". */
  cancelar?: string
  /** Acción destructiva: botón rojo e ícono de alerta. */
  peligro?: boolean
}

type Confirmar = (opciones: OpcionesConfirmar) => Promise<boolean>

const ContextoConfirmar = React.createContext<Confirmar | null>(null)

/** Montalo una vez en la raíz. Reemplaza al confirm nativo del navegador. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opciones, setOpciones] = React.useState<OpcionesConfirmar | null>(null)
  const [abierto, setAbierto] = React.useState(false)
  const resolver = React.useRef<((ok: boolean) => void) | null>(null)

  const cerrar = React.useCallback((ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setAbierto(false)
  }, [])

  const confirmar = React.useCallback<Confirmar>((nuevas) => {
    // Si había una confirmación abierta, la damos por cancelada.
    resolver.current?.(false)
    setOpciones(nuevas)
    setAbierto(true)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const peligro = opciones?.peligro ?? false
  const Icono = peligro ? TriangleAlertIcon : CircleHelpIcon

  return (
    <ContextoConfirmar.Provider value={confirmar}>
      {children}
      <AlertDialog open={abierto} onOpenChange={(o) => !o && cerrar(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className={cn(peligro && "bg-destructive/10 text-destructive")}>
              <Icono />
            </AlertDialogMedia>
            <AlertDialogTitle>{opciones?.titulo}</AlertDialogTitle>
            {opciones?.descripcion ? (
              <AlertDialogDescription>{opciones.descripcion}</AlertDialogDescription>
            ) : (
              <AlertDialogDescription className="sr-only">Confirmá para seguir.</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => cerrar(false)}>{opciones?.cancelar ?? "Cancelar"}</AlertDialogCancel>
            <AlertDialogAction variant={peligro ? "destructive" : "default"} onClick={() => cerrar(true)}>
              {opciones?.accion ?? (peligro ? "Eliminar" : "Confirmar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ContextoConfirmar.Provider>
  )
}

/** `const confirmar = useConfirm(); if (await confirmar({ titulo: "¿Borrar?", peligro: true })) …` */
export function useConfirm(): Confirmar {
  const ctx = React.useContext(ContextoConfirmar)
  if (!ctx) throw new Error("useConfirm tiene que usarse adentro de <ConfirmProvider>")
  return ctx
}
