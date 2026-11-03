import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"

import { useTema } from "@/lib/tema"

// Toasts arriba a la derecha (como el kit), con los tokens del tema: superficie
// popover; éxito/error/aviso/info con su color al 10 % y el borde al 30 %.
// La capa sale del token z-toast (110), no del z-index gigante de sonner.
const Toaster = ({ ...props }: ToasterProps) => {
  const { resuelto } = useTema()

  return (
    <Sonner
      theme={resuelto === "oscuro" ? "dark" : "light"}
      position="top-right"
      richColors
      closeButton
      containerAriaLabel="Notificaciones"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          zIndex: "var(--z-index-toast)",
          fontFamily: "var(--font-sans)",
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "color-mix(in oklab, var(--success) 10%, var(--popover))",
          "--success-text": "var(--success)",
          "--success-border": "color-mix(in oklab, var(--success) 30%, var(--popover))",
          "--error-bg": "color-mix(in oklab, var(--destructive) 10%, var(--popover))",
          "--error-text": "var(--destructive)",
          "--error-border": "color-mix(in oklab, var(--destructive) 30%, var(--popover))",
          "--warning-bg": "color-mix(in oklab, var(--warning) 10%, var(--popover))",
          "--warning-text": "var(--warning)",
          "--warning-border": "color-mix(in oklab, var(--warning) 30%, var(--popover))",
          "--info-bg": "color-mix(in oklab, var(--info) 10%, var(--popover))",
          "--info-text": "var(--info)",
          "--info-border": "color-mix(in oklab, var(--info) 30%, var(--popover))",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: "Cerrar",
        classNames: {
          toast: "shadow-lg text-sm",
          title: "font-medium",
          description: "text-xs",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
