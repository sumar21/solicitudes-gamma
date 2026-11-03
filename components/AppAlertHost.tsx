import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info } from './Icons';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { cn } from '../lib/utils';
import { AppAlertRequest, AppAlertTone, subscribeAppAlerts } from '../lib/appDialog';

// Cartel de avisos de la app (ver lib/appDialog.ts). Va montado una sola vez en index.tsx, fuera de
// <App />, así funciona también en el login y en el gate de identificación.
// Armado sobre el Dialog del kit (y no AlertDialog) porque el cartel se cierra también con un clic
// en el fondo; la confirmación de DESIGN §3.6 da el aspecto: ícono en círculo, título y pie.

const TONES: Record<AppAlertTone, { title: string; Icon: typeof Info; circulo: string }> = {
  error:   { title: 'No se pudo completar la acción', Icon: AlertCircle,  circulo: 'bg-destructive/10 text-destructive' },
  warning: { title: 'Atención',                       Icon: AlertCircle,  circulo: 'bg-warning/10 text-warning' },
  info:    { title: 'Aviso',                          Icon: Info,         circulo: 'bg-info/10 text-info' },
  success: { title: 'Listo',                          Icon: CheckCircle2, circulo: 'bg-success/10 text-success' },
};

export const AppAlertHost: React.FC = () => {
  const [queue, setQueue] = useState<AppAlertRequest[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = queue[0];

  // El último aviso mostrado sigue pintado mientras corre la animación de salida del Dialog.
  const [mostrado, setMostrado] = useState<AppAlertRequest | undefined>(current);
  if (current && current !== mostrado) setMostrado(current);

  useEffect(() => subscribeAppAlerts(req => setQueue(prev => [...prev, req])), []);

  const close = () => {
    if (!current) return;
    current.resolve();
    setQueue(prev => prev.slice(1));
  };

  useEffect(() => {
    if (!current) return;
    buttonRef.current?.focus();
    // Captura en window: el aviso suele abrirse ENCIMA de un modal (p. ej. el de pre-ticket) que
    // escucha Escape en document. Cortamos la propagación para que Esc/Enter cierren solo este
    // cartel y no el modal de abajo. El foco atrapado y su vuelta al cerrar los da Radix.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!mostrado) return null;
  const tone = TONES[mostrado.tone ?? 'error'];

  return (
    // Capa: z-overlay del kit. Se abre después que los modales y que el "Guardando en sistema…",
    // así que el portal queda último en el body y se pinta encima de ellos.
    <Dialog open={!!current} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        className="sm:max-w-md"
        onOpenAutoFocus={e => { e.preventDefault(); buttonRef.current?.focus(); }}
      >
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
          <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', tone.circulo)}>
            <tone.Icon className="size-5" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:pt-1.5">
            <DialogTitle>{mostrado.title ?? tone.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-line wrap-break-word">
              {mostrado.message}
            </DialogDescription>
          </div>
        </div>
        <DialogFooter>
          <Button ref={buttonRef} type="button" onClick={close} className="sm:min-w-24">
            {mostrado.confirmLabel ?? 'Aceptar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
