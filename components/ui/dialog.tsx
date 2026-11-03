import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Modal de formulario canónico (DESIGN.md §4.1, §5.5). El componente pone TODO el marco: overlay,
 * panel, radio, header, cuerpo con scroll y footer. Las pantallas no le pasan radio, sombra, borde ni
 * alto: solo el ancho (`sm:max-w-*`, §4.1 "Tamaños").
 *
 *   <DialogContent className="sm:max-w-2xl">
 *     <DialogHeader><DialogTitle/><DialogDescription/></DialogHeader>
 *     <DialogBody>…campos…</DialogBody>
 *     <DialogFooter><Button variant="outline"/> <Button/></DialogFooter>
 *   </DialogContent>
 */
function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

// Overlay canónico: negro al 60 % con blur (§4.1). Con p-4 = gutter de 16 px en mobile (§5.5).
function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-overlay bg-black/60 backdrop-blur-sm duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

// Panel: rounded-xl, borde, shadow-2xl, max-h-[90vh], flex-col; scrollea el DialogBody, no el panel.
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-overlay flex max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background text-sm text-foreground shadow-2xl duration-200 outline-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label="Cerrar"
            className="absolute top-3.5 right-4 rounded-full p-2 text-muted-foreground transition-colors outline-hidden hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-5" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

// Header: px-6 py-4 border-b bg-secondary/20 (§4.1). El pr deja lugar a la cruz.
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 flex-col gap-0.5 border-b bg-secondary/20 px-6 py-4 pr-14 text-left", className)}
      {...props}
    />
  )
}

// Cuerpo con scroll: flex-1 overflow-y-auto p-6 (§4.1).
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-body" className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto p-6", className)} {...props} />
}

// Footer: p-4 border-t bg-muted/20; en mobile los botones apilados y a lo ancho (§5.5), la acción principal arriba.
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t bg-muted/20 p-4 *:w-full sm:flex-row sm:justify-end sm:*:w-auto",
        className
      )}
      {...props}
    />
  )
}

// Título de modal: text-xl font-bold tracking-tight (§4.1, tipografía 1.4).
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("flex items-center gap-2 text-xl font-bold tracking-tight", className)}
      {...props}
    />
  )
}

// Subtítulo: text-xs text-muted-foreground (el contexto va en <span className="font-medium text-foreground">).
function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
