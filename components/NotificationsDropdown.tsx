
import React from 'react';
import { Notification, NotificationType } from '../types';
import { Bell, CheckCircle2, AlertCircle, Clock, Info, X } from './Icons';
import { Button } from './ui/button';
import { Card } from './ui/card';
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

  const getIconContainer = (type: NotificationType) => {
    switch (type) {
      case NotificationType.NEW_TICKET: 
        return {
          bg: "bg-blue-50 border-blue-100",
          icon: <AlertCircle className="w-3.5 h-3.5 text-blue-600" />
        };
      case NotificationType.STATUS_UPDATE: 
        return {
          bg: "bg-emerald-50 border-emerald-100",
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        };
      case NotificationType.ROLE_CHANGE:
        return {
          bg: "bg-purple-50 border-purple-100",
          icon: <Info className="w-3.5 h-3.5 text-purple-600" />
        };
      default: 
        return {
          bg: "bg-slate-50 border-slate-100",
          icon: <Bell className="w-3.5 h-3.5 text-slate-600" />
        };
    }
  };

  return (
    <Card className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/50 shadow-none relative">
      {/* Header aligned with Sidebar Zinc theme */}
      <div className="px-4 py-4 bg-zinc-950 text-white flex items-center justify-between shrink-0 relative z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Bell className="w-5 h-5 text-white" />
            {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-zinc-950" />}
          </div>
          <div className="flex flex-col">
            <h3 className="font-black text-[11px] tracking-[0.15em] uppercase leading-none">Notificaciones</h3>
            {unreadCount > 0 && (
              <span className="text-[9px] font-bold text-zinc-500 mt-1 uppercase tracking-wider">
                {unreadCount} pendientes
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-[10px] h-8 font-black uppercase tracking-widest text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 px-3 rounded-lg"
              onClick={onMarkAllAsRead}
            >
              Limpiar
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/10 rounded-full"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="max-h-[60vh] sm:max-h-[440px] overflow-y-auto bg-white overscroll-contain">
        {notifications.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-slate-100">
              <Bell className="w-6 h-6 text-slate-200" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">Sin novedades</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map((n) => {
              const style = getIconContainer(n.type);
              return (
                <div 
                  key={n.id} 
                  className={cn(
                    "p-4 sm:p-5 hover:bg-slate-50/80 transition-all cursor-pointer relative flex gap-4 group border-l-4 border-transparent",
                    !n.isRead ? "bg-blue-50/30 border-l-blue-500" : "hover:border-l-slate-200"
                  )}
                  onClick={() => onNotificationClick(n)}
                >
                  <div className={cn(
                    "mt-0.5 shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center border shadow-sm transition-transform group-hover:scale-105",
                    style.bg
                  )}>
                    {style.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <p className={cn(
                        "text-sm font-black leading-tight tracking-tight transition-colors", 
                        !n.isRead ? "text-slate-900" : "text-slate-500"
                      )}>
                        {n.title}
                      </p>
                      {!n.isRead && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full mt-1 shrink-0 ring-4 ring-blue-500/10" />
                      )}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed font-medium mt-1 pr-1">
                      {n.message}
                    </p>
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold tabular-nums uppercase tracking-wider">
                        <Clock className="w-3.5 h-3.5 opacity-50" />
                        {n.timestamp}
                      </div>
                      {n.ticketId && (
                        <span className="text-[9px] font-black font-mono text-blue-600 bg-blue-100/50 px-2 py-1 rounded-lg uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">
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
      
      <div className="p-4 bg-slate-50/50 border-t border-slate-100 shrink-0">
        <Button variant="ghost" className="w-full text-[10px] h-10 text-slate-500 hover:text-slate-900 font-black uppercase tracking-[0.2em] transition-all hover:bg-white border border-slate-200 rounded-xl shadow-sm">
          Ver Actividad Completa
        </Button>
      </div>
    </Card>
  );
};
