import React, { useEffect, useRef } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { useActualizacion } from './Actualizacion';
import { POSTERGACION_MS } from '../lib/version/actualizacion';

/** Sale de la constante: si cambia la espera, el botón no puede decir otra cosa. */
const MINUTOS_DE_POSTERGACION = POSTERGACION_MS / 60_000;

// Dos salidas y ninguna más: «Actualizar ahora» recarga; «Actualizar en 10 minutos» cierra y arranca la
// cuenta. Escape equivale a postergar. No usa ui/dialog porque ese trae cruz y cierra con clic afuera,
// que dejarían la pestaña con la versión vieja sin elegir nada. Mismo armado que AppAlertHost.
export const ActualizacionDialog: React.FC = () => {
  const { avisoAbierto, desplegada, recargando, postergar, actualizarAhora } = useActualizacion();
  const ahoraRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!avisoAbierto) return;
    ahoraRef.current?.focus();
    // Captura en window: el aviso suele abrirse ENCIMA de un modal cuyo DialogContent escucha Escape en
    // document. Cortamos la propagación para que Esc posterge y no cierre el modal de abajo.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      postergar();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [avisoAbierto, postergar]);

  if (!avisoAbierto) return null;

  return (
    // Por encima de los modales (z-50) y del overlay "Guardando en sistema..." (z-[100]); debajo de
    // AppAlertHost (z-[1000]): un error de la app se tiene que leer antes.
    <div className="fixed inset-0 z-[900] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] animate-in fade-in" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="actualizacion-titulo"
        aria-describedby="actualizacion-mensaje"
        className="relative w-[94vw] max-w-md rounded-2xl border border-slate-100 bg-white p-6 shadow-xl animate-in zoom-in-95 duration-200"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
        </div>
        <h3 id="actualizacion-titulo" className="mt-4 text-lg font-semibold leading-snug text-slate-900">
          Hay una versión nueva de MediFlow
        </h3>
        <div id="actualizacion-mensaje" className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-slate-500">
          <p>La aplicación se actualizó con mejoras y correcciones.</p>
          <p className="font-medium text-slate-900">Guardá lo que estés haciendo: la página se va a recargar para actualizarse.</p>
        </div>
        {/* El número, para soporte: el mismo que va a mostrar el sidebar después. */}
        {desplegada !== null && (
          <p className="mt-3 text-xs text-slate-400">
            Versión nueva <span className="font-mono tabular-nums">{desplegada}</span>
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" type="button" onClick={postergar}>
            Actualizar en {MINUTOS_DE_POSTERGACION} minutos
          </Button>
          <Button ref={ahoraRef} type="button" onClick={actualizarAhora} disabled={recargando} aria-busy={recargando} className="gap-2">
            {recargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Actualizar ahora
          </Button>
        </div>
      </div>
    </div>
  );
};
