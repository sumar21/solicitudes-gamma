
import React from 'react';
import { Notification, NotificationType } from '../types';
import { Bell, CheckCircle2, AlertCircle, Clock, Info, X } from './Icons';
import { Button } from './ui/button';
import { Vacio } from './ui/estados';
import { cn } from '../lib/utils';

interface NotificationsDropdownProps {
  notifications: Notification[];
  onNotificationClick: (notification: Notification) => void;
  onMarkAllAsRead: () => void;
  onClose: () => void;
}

export const NotificationsDropdown: React.FC<NotificationsDropdownProps> = ({
  notifications,
  onNotificationClick,
  onMarkAllAsRead,
  onClose
}) => {
  const unreadCount = notifications.filter(n => !n.isRead).length;

  // Tile de ícono por tipo (DESIGN §1.7): semántico al 10 % + ícono en su color.
  const getIconContainer = (type: NotificationType) => {
    switch (type) {
      case NotificationType.NEW_TICKET:
        return { bg: 'bg-info/10', icon: <AlertCircle className="size-4 text-info" aria-hidden="true" /> };
      case NotificationType.STATUS_UPDATE:
        return { bg: 'bg-success/10', icon: <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> };
      case NotificationType.POR_CONSOLIDAR:
        return { bg: 'bg-warning/10', icon: <Clock className="size-4 text-warning" aria-hidden="true" /> };
      case NotificationType.ROLE_CHANGE:
        return { bg: 'bg-muted', icon: <Info className="size-4 text-foreground" aria-hidden="true" /> };
      default:
        return { bg: 'bg-muted', icon: <Bell className="size-4 text-muted-foreground" aria-hidden="true" /> };
    }
  };

  // Va adentro de un PopoverContent del kit (p-0): la superficie, el borde y la sombra los pone el popover.
  return (
    <div className="flex flex-col text-sm">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Bell className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="flex min-w-0 flex-col">
            <h3 className="titulo leading-tight">Notificaciones</h3>
            {unreadCount > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {unreadCount} pendientes
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {unreadCount > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={onMarkAllAsRead}>
              Limpiar
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Cerrar notificaciones"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto overscroll-contain sm:max-h-[440px]">
        {notifications.length === 0 ? (
          <Vacio icono={Bell} titulo="Sin novedades" className="border-0 bg-transparent" />
        ) : (
          <div className="divide-y">
            {notifications.map((n) => {
              const style = getIconContainer(n.type);
              return (
                <div
                  key={n.id}
                  className={cn(
                    'group relative flex cursor-pointer gap-3 border-l-4 p-4 transition-colors hover:bg-muted/50',
                    !n.isRead ? 'border-l-info bg-info/5' : 'border-l-transparent'
                  )}
                  onClick={() => onNotificationClick(n)}
                >
                  <div className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg', style.bg)}>
                    {style.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn(
                        'text-sm leading-tight',
                        !n.isRead ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'
                      )}>
                        {n.title}
                      </p>
                      {!n.isRead && (
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-info" aria-label="Sin leer" />
                      )}
                    </div>
                    <p className="mt-1 pr-1 text-xs leading-relaxed text-muted-foreground">
                      {n.message}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                        <Clock className="size-3" aria-hidden="true" />
                        {n.timestamp}
                      </div>
                      {n.ticketId && (
                        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground tabular-nums opacity-0 transition-opacity group-hover:opacity-100">
                          #{n.ticketId.split('-')[1]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
