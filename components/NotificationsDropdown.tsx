
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
    <Card className="absolute right-0 mt-3 w-80 sm:w-[400px] shadow-2xl border-slate-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 rounded-2xl">
      {/* Header aligned with Sidebar Zinc theme */}
      <div className="px-5 py-4 bg-zinc-950 text-white flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Bell className="w-4 h-4 text-white/70" />
            {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-zinc-950" />}
          </div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-xs tracking-tight uppercase">Notificaciones</h3>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-[10px] px-1.5 py-0.5 rounded-full font-black leading-none min-w-[18px] text-center">
                {unreadCount}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-[9px] h-7 font-black uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/10 px-2"
              onClick={onMarkAllAsRead}
            >
              Marcar todo leído
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7 text-white/40 hover:text-white rounded-full"
            onClick={onClose}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="max-h-[440px] overflow-y-auto bg-white">
        {notifications.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
              <Bell className="w-5 h-5 text-slate-200" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">Bandeja de entrada vacía</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map((n) => {
              const style = getIconContainer(n.type);
              return (
                <div 
                  key={n.id} 
                  className={cn(
                    "p-5 hover:bg-slate-50/80 transition-all cursor-pointer relative flex gap-4 group border-l-2 border-transparent",
                    !n.isRead ? "bg-blue-50/20 border-l-blue-500" : "hover:border-l-slate-200"
                  )}
                  onClick={() => onNotificationClick(n)}
                >
                  <div className={cn(
                    "mt-0.5 shrink-0 w-8 h-8 rounded-xl flex items-center justify-center border shadow-sm transition-transform group-hover:scale-105",
                    style.bg
                  )}>
                    {style.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-0.5">
                      <p className={cn(
                        "text-xs font-bold leading-none tracking-tight transition-colors", 
                        !n.isRead ? "text-slate-900" : "text-slate-500"
                      )}>
                        {n.title}
                      </p>
                      {!n.isRead && (
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-0.5 ring-4 ring-blue-500/10" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 leading-normal font-medium mt-1 pr-2">
                      {n.message}
                    </p>
                    <div className="flex items-center justify-between mt-2.5">
                      <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-bold tabular-nums uppercase tracking-wider">
                        <Clock className="w-3 h-3 opacity-50" />
                        {n.timestamp}
                      </div>
                      {n.ticketId && (
                        <span className="text-[8px] font-black font-mono text-blue-600 bg-blue-100/50 px-1.5 py-0.5 rounded uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">
                          Detalle {n.ticketId}
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
      
      <div className="p-3 bg-slate-50/50 border-t border-slate-100">
        <Button variant="ghost" className="w-full text-[9px] h-9 text-slate-400 hover:text-slate-900 font-black uppercase tracking-[0.2em] transition-all hover:bg-white border border-transparent hover:border-slate-200 rounded-xl">
          Centro de Actividad
        </Button>
      </div>
    </Card>
  );
};
