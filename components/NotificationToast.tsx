import React, { useEffect, useState } from 'react';
import { Notification, NotificationType } from '../types';
import { AlertCircle, CheckCircle2, Bell, X } from './Icons';
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

const iconFor = (type: NotificationType) => {
  switch (type) {
    case NotificationType.NEW_TICKET:
      return <AlertCircle className="w-5 h-5 text-blue-500 shrink-0" />;
    case NotificationType.STATUS_UPDATE:
      return <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />;
    default:
      return <Bell className="w-5 h-5 text-slate-500 shrink-0" />;
  }
};

const bgFor = (type: NotificationType) => {
  switch (type) {
    case NotificationType.NEW_TICKET:
      return 'border-l-blue-500 bg-blue-50/95';
    case NotificationType.STATUS_UPDATE:
      return 'border-l-emerald-500 bg-emerald-50/95';
    default:
      return 'border-l-slate-500 bg-white/95';
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

  return (
    <div
      className={cn(
        'relative w-full max-w-sm mx-auto rounded-xl shadow-lg border border-slate-200/50 border-l-4 overflow-hidden cursor-pointer',
        'transition-all duration-300 ease-out',
        visible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0',
        bgFor(n.type),
      )}
      onClick={() => { onTap?.(); setVisible(false); setTimeout(onDismiss, 300); }}
    >
      <div className="flex items-start gap-3 p-3 pr-8">
        {iconFor(n.type)}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 leading-tight">{n.title}</p>
          <p className="text-xs text-slate-600 mt-0.5 leading-snug line-clamp-2">{n.message}</p>
        </div>
      </div>

      {/* Close button */}
      <button
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors"
        onClick={(e) => { e.stopPropagation(); setVisible(false); setTimeout(onDismiss, 300); }}
      >
        <X className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {/* Progress bar */}
      <div className="h-0.5 bg-slate-200/50">
        <div
          className={cn(
            'h-full transition-[width] ease-linear',
            n.type === NotificationType.NEW_TICKET ? 'bg-blue-400' : 'bg-emerald-400',
          )}
          style={{ width: `${progress}%`, transitionDuration: '50ms' }}
        />
      </div>
    </div>
  );
};

export const NotificationToasts: React.FC<NotificationToastProps> = ({ toasts, onDismiss, onTap }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-0 right-0 z-[99999] flex flex-col items-center gap-2 px-4 pointer-events-none">
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
