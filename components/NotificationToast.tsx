import React, { useEffect, useState } from 'react';
import { Notification, NotificationType } from '../types';
import { AlertCircle, CheckCircle2, Bell, Clock, X } from './Icons';
import { cn } from '../lib/utils';

export interface ToastItem {
  id: string;
  notification: Notification;
  /** ms remaining before auto-dismiss */
  exiting?: boolean;
}

interface NotificationToastProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onTap?: (notification: Notification) => void;
}

// Tono semántico por tipo (DESIGN §1.1): nuevo traslado = info, cambio de estado = éxito,
// por consolidar = aviso. El resto, neutro.
const tonoFor = (type: NotificationType) => {
  switch (type) {
    case NotificationType.NEW_TICKET:
      return { Icon: AlertCircle, icono: 'text-info', acento: 'border-l-info', barra: 'bg-info' };
    case NotificationType.STATUS_UPDATE:
      return { Icon: CheckCircle2, icono: 'text-success', acento: 'border-l-success', barra: 'bg-success' };
    case NotificationType.POR_CONSOLIDAR:
      return { Icon: Clock, icono: 'text-warning', acento: 'border-l-warning', barra: 'bg-warning' };
    default:
      return { Icon: Bell, icono: 'text-muted-foreground', acento: 'border-l-muted-foreground', barra: 'bg-muted-foreground' };
  }
};

const SingleToast: React.FC<{
  toast: ToastItem;
  onDismiss: () => void;
  onTap?: () => void;
}> = ({ toast, onDismiss, onTap }) => {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    // Slide in
    requestAnimationFrame(() => setVisible(true));

    // Progress bar countdown (8 seconds)
    const duration = 8000;
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(tick);
        setVisible(false);
        setTimeout(onDismiss, 300); // wait for exit animation
      }
    }, 50);

    return () => clearInterval(tick);
  }, [onDismiss]);

  const n = toast.notification;
  const tono = tonoFor(n.type);

  return (
    // Superficie de lo que flota (popover) con acento a la izquierda del color del tipo.
    <div
      className={cn(
        'relative w-full max-w-sm mx-auto overflow-hidden rounded-lg border border-l-4 bg-popover text-popover-foreground shadow-md cursor-pointer',
        'transition-all duration-300 ease-out motion-reduce:transition-none',
        visible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0',
        tono.acento,
      )}
      onClick={() => { onTap?.(); setVisible(false); setTimeout(onDismiss, 300); }}
    >
      <div className="flex items-start gap-3 p-3 pr-9">
        <tono.Icon className={cn('size-4 mt-0.5 shrink-0', tono.icono)} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight text-foreground">{n.title}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground line-clamp-2">{n.message}</p>
        </div>
      </div>

      {/* Cerrar */}
      <button
        type="button"
        aria-label="Cerrar notificación"
        className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(e) => { e.stopPropagation(); setVisible(false); setTimeout(onDismiss, 300); }}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>

      {/* Barra de tiempo hasta que se cierra sola */}
      <div className="h-0.5 bg-muted">
        <div
          className={cn('h-full transition-[width] ease-linear', tono.barra)}
          style={{ width: `${progress}%`, transitionDuration: '50ms' }}
        />
      </div>
    </div>
  );
};

export const NotificationToasts: React.FC<NotificationToastProps> = ({ toasts, onDismiss, onTap }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-0 right-0 z-toast flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto w-full max-w-sm">
          <SingleToast
            toast={t}
            onDismiss={() => onDismiss(t.id)}
            onTap={onTap ? () => onTap(t.notification) : undefined}
          />
        </div>
      ))}
    </div>
  );
};
