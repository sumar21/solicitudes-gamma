import React, { useEffect, useRef } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { useActualizacion } from './Actualizacion';
import { POSTERGACION_MS } from '../lib/version/actualizacion';

/** Sale de la constante: si cambia la espera, el botón no puede decir otra cosa. */
const MINUTOS_DE_POSTERGACION = POSTERGACION_MS / 60_000;

// Dos salidas y ninguna más: «Actualizar ahora» recarga; «Actualizar en 10 minutos» cierra y arranca la
// cuenta. Escape equivale a postergar. Va sobre AlertDialog del kit y no sobre Dialog: no trae cruz ni
// cierra con clic afuera, que dejarían la pestaña con la versión vieja sin elegir nada. Los botones son
// Button sueltos (no AlertDialogAction/Cancel) para que ninguno cierre por su cuenta: cada uno hace lo suyo.
export const ActualizacionDialog: React.FC = () => {
  const { avisoAbierto, desplegada, recargando, postergar, actualizarAhora } = useActualizacion();
  const ahoraRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!avisoAbierto) return;
    // Captura en window: el aviso suele abrirse ENCIMA de un modal que escucha Escape en document.
    // Cortamos la propagación para que Esc posterge y no cierre el modal de abajo.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      postergar();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [avisoAbierto, postergar]);

  return (
    // Capa: z-overlay del kit; el portal se monta al abrir, así que queda encima de lo que ya estaba.
    <AlertDialog open={avisoAbierto} onOpenChange={open => { if (!open) postergar(); }}>
      <AlertDialogContent
        // El foco arranca en «Actualizar ahora» (Radix lo pondría en el primer botón, el de postergar).
        onOpenAutoFocus={e => { e.preventDefault(); ahoraRef.current?.focus(); }}
      >
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-info/10 text-info">
            <RefreshCw aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Hay una versión nueva de MediFlow</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-1.5">
              <p>La aplicación se actualizó con mejoras y correcciones.</p>
              <p className="font-medium text-foreground">Guardá lo que estés haciendo: la página se va a recargar para actualizarse.</p>
              {/* El número, para soporte: el mismo que va a mostrar el sidebar después. */}
              {desplegada !== null && (
                <p className="mt-1.5 text-xs">
                  Versión nueva <span className="font-mono tabular-nums">{desplegada}</span>
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" type="button" onClick={postergar}>
            Actualizar en {MINUTOS_DE_POSTERGACION} minutos
          </Button>
          <Button ref={ahoraRef} type="button" onClick={actualizarAhora} disabled={recargando} aria-busy={recargando}>
            {recargando ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Actualizar ahora
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
