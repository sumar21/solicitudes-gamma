import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info } from './Icons';
import { cn } from '../lib/utils';
import { AppAlertRequest, AppAlertTone, subscribeAppAlerts } from '../lib/appDialog';

// Cartel de avisos de la app (ver lib/appDialog.ts). Va montado una sola vez en index.tsx, fuera de
// <App />, así funciona también en el login y en el gate de identificación.

const TONES: Record<AppAlertTone, { title: string; icon: React.ReactNode; ring: string }> = {
  error:   { title: 'No se pudo completar la acción', icon: <AlertCircle className="w-5 h-5 text-red-600" />,      ring: 'bg-red-50' },
  warning: { title: 'Atención',                       icon: <AlertCircle className="w-5 h-5 text-amber-600" />,    ring: 'bg-amber-50' },
  info:    { title: 'Aviso',                          icon: <Info className="w-5 h-5 text-blue-600" />,            ring: 'bg-blue-50' },
  success: { title: 'Listo',                          icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />, ring: 'bg-emerald-50' },
};

export const AppAlertHost: React.FC = () => {
  const [queue, setQueue] = useState<AppAlertRequest[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = queue[0];

  useEffect(() => subscribeAppAlerts(req => setQueue(prev => [...prev, req])), []);

  const close = () => {
    if (!current) return;
    current.resolve();
    setQueue(prev => prev.slice(1));
  };

  useEffect(() => {
    if (!current) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    buttonRef.current?.focus();
    // Captura en window: el aviso suele abrirse ENCIMA de un modal (p. ej. el de pre-ticket) cuyo
    // DialogContent escucha Escape en document. Cortamos la propagación para que Esc/Enter cierren
    // solo este cartel y no el modal de abajo.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab') {
        e.preventDefault(); // un solo botón: el foco no se escapa del cartel
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      previousFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) return null;
  const tone = TONES[current.tone ?? 'error'];

  return (
    // Por encima de los modales (z-50) y del overlay "Guardando en sistema..." (z-[100]); debajo
    // de los toasts de notificación (z-[99999]).
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] animate-in fade-in" onClick={close} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-alert-title"
        aria-describedby="app-alert-message"
        className="relative w-[94vw] max-w-md rounded-2xl border border-slate-100 bg-white shadow-xl animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-start gap-3 p-6 pb-4">
          <div className={cn('shrink-0 w-9 h-9 rounded-full flex items-center justify-center', tone.ring)}>
            {tone.icon}
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h3 id="app-alert-title" className="text-base font-semibold leading-snug text-slate-900">
              {current.title ?? tone.title}
            </h3>
            <p id="app-alert-message" className="mt-1.5 text-sm leading-relaxed text-slate-600 whitespace-pre-line break-words">
              {current.message}
            </p>
          </div>
        </div>
        <div className="flex justify-end px-6 pb-5">
          <button
            ref={buttonRef}
            type="button"
            onClick={close}
            className="inline-flex items-center justify-center h-10 px-8 rounded-xl bg-emerald-950 text-sm font-medium text-white hover:bg-emerald-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          >
            {current.confirmLabel ?? 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
};
