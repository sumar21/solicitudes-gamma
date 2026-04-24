
import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, Home as HomeIcon, LogOut, History, Menu, Info,
  Mail, Lock, Eye, EyeOff, User, Settings, ChevronDown, ChevronUp, Users, Download
} from './components/Icons';
import { GammaLogo } from './components/GammaLogo';
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Card } from "./components/ui/card";

// Views
import { DashboardView } from './views/DashboardView';
import { RequestsView } from './views/RequestsView';
import { HistoryView } from './views/HistoryView';
import { BedsView } from './views/BedsView';
import { UserManagementView } from './views/UserManagementView';
import { RoleManagementView } from './views/RoleManagementView';

// Hooks & Constants
import { useHospitalState } from './hooks/useHospitalState';
import { Role, TicketStatus } from './types';

import { NotificationsDropdown } from './components/NotificationsDropdown';
import { Popover, PopoverTrigger, PopoverContent } from './components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Bell } from './components/Icons';

// Modals
import { NewRequestModal } from './components/modals/NewRequestModal';
import { EditRequestModal, EditRequestPayload } from './components/modals/EditRequestModal';
import { AssignBedModal } from './components/modals/AssignBedModal';
import { AreaSelectionModal } from './components/modals/AreaSelectionModal';
import { RejectionModal } from './components/modals/RejectionModal';
import { cn, calculateTicketMetrics } from './lib/utils';
import { NotificationToasts } from './components/NotificationToast';

export default function App() {
  const { state, actions } = useHospitalState();

  // Espera media real: promedio de tiempo total de tickets consolidados
  const avgWaitTime = React.useMemo(() => {
    const completed = state.tickets.filter(t => t.status === TicketStatus.COMPLETED && t.createdAt && t.completedAt);
    if (completed.length === 0) return '--';
    const total = completed.reduce((acc, t) => acc + calculateTicketMetrics(t).totalCycleTime, 0);
    return Math.round(total / completed.length);
  }, [state.tickets]);

  // PWA install prompt
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  React.useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const handleInstallApp = () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.then(() => setInstallPrompt(null));
  };

  // UI State local (para control de modales)
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);
  const [isAssignBedOpen, setIsAssignBedOpen] = useState(false);
  const [isAreaSelectionOpen, setIsAreaSelectionOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isUnreadModalOpen, setIsUnreadModalOpen] = useState(false);
  const [rejectTicketId, setRejectTicketId] = useState<string | null>(null);
  const [editTicketId, setEditTicketId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLegendModalOpen, setIsLegendModalOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(state.currentView === 'USERS' || (state.currentView as string) === 'ROLES');

  // Open Area Selection on login only if Hostess has NO areas from ABM
  useEffect(() => {
    if (state.currentUser?.role === Role.HOSTESS && (!state.currentUser.assignedAreas || state.currentUser.assignedAreas.length === 0)) {
      setIsAreaSelectionOpen(true);
    }
  }, [state.currentUser?.id]);

  // Refresh beds when entering Mapa de Camas view
  useEffect(() => {
    if (state.currentView === 'BEDS') {
      actions.fetchBeds();
    }
  }, [state.currentView]);

  const onConfirmBed = (bed: string) => {
    if (selectedTicketId) {
      actions.handleAssignBedAction(selectedTicketId, bed);
      setSelectedTicketId(null);
    }
  };

  const handleOpenAssignBed = (id: string) => {
    setSelectedTicketId(id);
    setIsAssignBedOpen(true);
  };

  const onNewRequestCreated = (data: any) => {
    actions.handleCreateTicket(data);
    setIsNewRequestOpen(false);
  };

  // Admin y Admisión: acceso completo (Monitor, Operativa, Historial, Mapa de Camas)
  const hasFullAccess = state.currentUser?.role === Role.ADMIN ||
    state.currentUser?.role === Role.ADMISSION;

  // Solo Admin: Configuración / Usuarios
  const isAdmin = state.currentUser?.role === Role.ADMIN;

  // Azafata: Operativa + Mapa de Camas
  const hasAzafataAccess = state.currentUser?.role === Role.HOSTESS;

  // Cualquier role con al menos acceso a Operativa
  const hasOperationalAccess = hasFullAccess || hasAzafataAccess;

  // Force view to BEDS if read-only and trying to access other views (or default)
  // This effect could be better handled in useEffect, but for now we control rendering.

  if (!state.currentUser) {
    return (
      <div className="h-screen w-full flex flex-col items-center bg-slate-50 overflow-auto">
        {/* Green gradient header */}
        <div className="w-full flex flex-col items-center pt-12 pb-28 md:pt-16 md:pb-32 px-4" style={{ background: 'linear-gradient(180deg, #022C22 0%, #034334 60%, #04604b 100%)' }}>
          <GammaLogo size={64} className="text-white mb-5" />
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">Bienvenido</h1>
          <p className="text-emerald-300/80 text-sm font-medium mt-1">Gestión de Traslados</p>
        </div>

        {/* Login card overlapping the header */}
        <Card className="w-full max-w-md -mt-20 mx-4 p-6 md:p-10 shadow-xl rounded-3xl border-none bg-white relative z-10">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-full bg-emerald-50 border-2 border-emerald-100 flex items-center justify-center -mt-12 md:-mt-14 mb-4 shadow-sm">
              <User className="w-6 h-6 text-emerald-700" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Iniciar Sesión</h2>
          </div>

          <form onSubmit={actions.handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest ml-1">Correo Electrónico</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  type="text"
                  autoComplete="username"
                  placeholder="nombre@grupogamma.com"
                  value={state.loginEmail}
                  onChange={e => actions.setLoginEmail(e.target.value)}
                  className="h-12 pl-11 rounded-xl border-emerald-200 focus:border-emerald-500 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest ml-1">Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={state.loginPass}
                  onChange={e => actions.setLoginPass(e.target.value)}
                  className="h-12 pl-11 pr-11 rounded-xl border-emerald-200 focus:border-emerald-500 focus:ring-emerald-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {state.loginError && <p className="text-red-500 text-xs font-bold text-center">{state.loginError}</p>}

            <Button
              type="submit"
              disabled={state.loginLoading}
              className="w-full h-12 rounded-xl text-white font-bold text-sm disabled:opacity-60 hover:opacity-90 shadow-lg"
              style={{ backgroundColor: '#022C22' }}
            >
              {state.loginLoading ? 'Verificando...' : 'Ingresar'}
            </Button>
          </form>

          <div className="mt-8 pt-5 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-400 font-medium">Grupo Gamma &bull; Red de Salud</p>
            <p className="text-[10px] text-slate-300 mt-0.5">MediFlow v1.0</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen h-[100dvh] w-full flex flex-col md:flex-row bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Toast notifications */}
      <NotificationToasts
        toasts={state.toasts}
        onDismiss={actions.handleDismissToast}
        onTap={(n) => {
          if (n.ticketId) actions.setCurrentView('REQUESTS');
        }}
      />

      {/* Loading overlay */}
      {state.ticketActionLoading && (
        <div className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin" />
            <span className="text-sm font-medium text-slate-600">Guardando en sistema...</span>
          </div>
        </div>
      )}
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-48 text-white flex-col shrink-0 z-30" style={{ background: 'linear-gradient(180deg, #022C22 0%, #034334 100%)' }}>
        <div className="h-20 flex items-center px-4 border-b border-white/10 shrink-0">
          <GammaLogo size={22} className="text-emerald-400 mr-3" />
          <div className="flex flex-col">
            <span className="font-bold text-white tracking-tight leading-none text-lg">Gamma</span>
            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest mt-1">Sede {state.currentUser.sede}</span>
          </div>
        </div>
        <nav className="flex-1 p-3 flex flex-col">
          <div className="space-y-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/30 px-3 mb-1 block">Menú Principal</span>
            {hasFullAccess && (
              <>
                <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'HOME' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('HOME')}><HomeIcon className="w-4 h-4" />Monitor</Button>
                <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'REQUESTS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('REQUESTS')}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
              </>
            )}
            {hasAzafataAccess && (
              <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'REQUESTS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('REQUESTS')}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
            )}
            <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'HISTORY' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('HISTORY')}><History className="w-4 h-4" />Historial</Button>
            <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'BEDS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('BEDS')}><Menu className="w-4 h-4" />Mapa de Camas</Button>
          </div>

          {/* Configuración — collapsible, solo admin */}
          {isAdmin && (
            <div className="mt-auto pt-3 border-t border-white/10">
              <button
                onClick={() => setIsConfigOpen(v => !v)}
                className={cn(
                  "w-full flex items-center justify-between gap-3 h-10 px-3 rounded-lg text-sm transition-colors",
                  isConfigOpen || state.currentView === 'USERS' ? 'text-white font-bold' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                )}
              >
                <span className="flex items-center gap-3"><Settings className="w-4 h-4" />Configuración</span>
                {isConfigOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {isConfigOpen && (
                <div className="ml-4 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                  <Button variant="ghost" className={cn("w-full justify-start gap-3 h-9 rounded-lg text-sm", state.currentView === 'USERS' ? 'bg-white/15 text-white font-bold' : 'text-white/60 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('USERS')}><Users className="w-3.5 h-3.5" />Usuarios</Button>
                  <Button variant="ghost" className={cn("w-full justify-start gap-3 h-9 rounded-lg text-sm", state.currentView === 'ROLES' as any ? 'bg-white/15 text-white font-bold' : 'text-white/60 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('ROLES' as any)}><Settings className="w-3.5 h-3.5" />Roles</Button>
                </div>
              )}
            </div>
          )}
        </nav>
        <div className="p-3 border-t border-white/10">
          <Button variant="ghost" className="w-full justify-start gap-3 text-red-400 hover:text-red-300 hover:bg-red-950/20" onClick={actions.handleLogout}><LogOut className="w-4 h-4" /> Salir</Button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <header className="h-16 md:h-14 bg-white border-b border-slate-200 flex items-center justify-between px-2 md:px-8 shrink-0 z-20 shadow-sm relative">
          <div className="flex items-center gap-1.5">
            <button 
              className="md:hidden p-2 rounded-xl text-white hover:opacity-90 transition-colors shadow-lg active:scale-95"
              style={{ backgroundColor: '#022C22' }}
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <GammaLogo size={20} />
            </button>
            <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight truncate max-w-[100px] xs:max-w-[180px] sm:max-w-none">
              {state.currentView === 'HOME' ? 'Monitor' : state.currentView === 'REQUESTS' ? 'Operativa' : state.currentView === 'BEDS' ? 'Mapa de Camas' : state.currentView === 'USERS' ? 'Usuarios' : (state.currentView as string) === 'ROLES' ? 'Roles' : 'Historial'}
            </h1>
          </div>
          
          {/* Mobile Sidebar Overlay */}
          {isMobileMenuOpen && (
            <div 
              className="fixed inset-0 bg-black/50 z-40 md:hidden" 
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          {/* Mobile Sidebar */}
          <div className={cn(
            "fixed inset-y-0 left-0 w-64 text-white flex flex-col z-50 md:hidden transition-transform duration-300 ease-in-out shadow-2xl",
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )} style={{ background: 'linear-gradient(180deg, #022C22 0%, #034334 100%)' }}>
            <div className="h-14 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
              <div className="flex items-center">
                <GammaLogo size={22} className="text-emerald-400 mr-3" />
                <div className="flex flex-col">
                  <span className="font-bold text-white tracking-tight leading-none text-lg">Gamma</span>
                  <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest mt-1">Sede {state.currentUser.sede}</span>
                </div>
              </div>
              <button 
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 text-zinc-400 hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <nav className="flex-1 p-3 flex flex-col overflow-y-auto">
              <div className="space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/30 px-3 mb-1 block">Menú Principal</span>
                {hasFullAccess && (
                  <>
                    <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'HOME' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('HOME'); setIsMobileMenuOpen(false); }}><HomeIcon className="w-4 h-4" />Monitor</Button>
                    <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'REQUESTS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('REQUESTS'); setIsMobileMenuOpen(false); }}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
                  </>
                )}
                {hasAzafataAccess && (
                  <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'REQUESTS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('REQUESTS'); setIsMobileMenuOpen(false); }}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
                )}
                <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'HISTORY' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('HISTORY'); setIsMobileMenuOpen(false); }}><History className="w-4 h-4" />Historial</Button>
                <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'BEDS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('BEDS'); setIsMobileMenuOpen(false); }}><Menu className="w-4 h-4" />Mapa de Camas</Button>
              </div>

              {isAdmin && (
                <div className="mt-auto pt-3 border-t border-white/10">
                  <button
                    onClick={() => setIsConfigOpen(v => !v)}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 h-10 px-3 rounded-lg text-sm transition-colors",
                      isConfigOpen || state.currentView === 'USERS' ? 'text-white font-bold' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                    )}
                  >
                    <span className="flex items-center gap-3"><Settings className="w-4 h-4" />Configuración</span>
                    {isConfigOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {isConfigOpen && (
                    <div className="ml-4 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                      <Button variant="ghost" className={cn("w-full justify-start gap-3 h-9 rounded-lg text-sm", state.currentView === 'USERS' ? 'bg-white/15 text-white font-bold' : 'text-white/60 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('USERS'); setIsMobileMenuOpen(false); }}><Users className="w-3.5 h-3.5" />Usuarios</Button>
                      <Button variant="ghost" className={cn("w-full justify-start gap-3 h-9 rounded-lg text-sm", state.currentView === 'ROLES' as any ? 'bg-white/15 text-white font-bold' : 'text-white/60 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('ROLES' as any); setIsMobileMenuOpen(false); }}><Settings className="w-3.5 h-3.5" />Roles</Button>
                    </div>
                  )}
                </div>
              )}
            </nav>
            <div className="p-3 border-t border-white/10 space-y-1">
              {installPrompt && /android/i.test(navigator.userAgent) && (
                <Button variant="ghost" className="w-full justify-start gap-3 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/20" onClick={() => { handleInstallApp(); setIsMobileMenuOpen(false); }}><Download className="w-4 h-4" /> Instalar App</Button>
              )}
              <Button variant="ghost" className="w-full justify-start gap-3 text-red-400 hover:text-red-300 hover:bg-red-950/20" onClick={() => { actions.handleLogout(); setIsMobileMenuOpen(false); }}><LogOut className="w-4 h-4" /> Salir</Button>
            </div>
          </div>

          <div className="flex items-center gap-1 md:gap-4">
            {state.currentView === 'BEDS' && (
              <Button variant="ghost" size="icon" className="w-10 h-10 sm:w-9 sm:h-9 text-slate-400 hover:text-slate-600" onClick={() => setIsLegendModalOpen(true)}>
                <Info className="w-6 h-6 sm:w-5 sm:h-5" />
              </Button>
            )}
            <div className="flex items-center gap-1 sm:gap-3 pl-1 sm:pl-4 border-l border-slate-100">
              {(hasFullAccess || hasAzafataAccess) && (
                <Popover open={isNotificationsOpen} onOpenChange={setIsNotificationsOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative w-10 h-10 sm:w-9 sm:h-9 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 active:bg-slate-200">
                      <Bell className="w-5 h-5 sm:w-4 sm:h-4" />
                      {state.filteredNotifications.filter(n => !n.isRead).length > 0 && (
                        <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white" />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent 
                    align="end" 
                    sideOffset={-40} 
                    className="p-0 w-[calc(100vw-1.5rem)] sm:w-[380px] border-none shadow-[0_20px_50px_rgba(0,0,0,0.3)] rounded-2xl z-[9999] outline-none animate-in fade-in zoom-in-95 duration-200 origin-top-right"
                  >
                    <NotificationsDropdown 
                      notifications={state.filteredNotifications} 
                      onNotificationClick={(n) => {
                        actions.handleMarkNotificationRead(n.id);
                        setIsNotificationsOpen(false);
                        // Optional: navigate to the ticket if needed
                      }}
                      onMarkAllAsRead={actions.handleMarkAllNotificationsRead}
                      onClose={() => setIsNotificationsOpen(false)}
                    />
                  </PopoverContent>
                </Popover>
              )}
              {state.currentUser?.role === Role.HOSTESS && (
                <span className="h-10 sm:h-8 text-xs sm:text-[10px] font-black uppercase tracking-wider px-2 sm:px-2 rounded-xl border border-zinc-200 bg-zinc-50 shadow-sm flex items-center">
                  SECTORES: {state.currentUser.assignedAreas?.length || 0}
                </span>
              )}
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-bold text-slate-900 leading-none">{state.currentUser.name}</span>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Sede {state.currentUser.sede}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Banner de notificaciones sin leer */}
        {state.unreadSpNotifications?.length > 0 && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
              <p className="text-xs font-semibold text-red-800">
                Tenés <span className="font-black">{state.unreadSpNotifications.length}</span> notificación{state.unreadSpNotifications.length > 1 ? 'es' : ''} sin confirmar hace más de 20 minutos
              </p>
            </div>
            <button
              onClick={() => { console.log('[App] Opening unread modal, count:', state.unreadSpNotifications?.length); setIsUnreadModalOpen(true); }}
              className="text-[10px] font-black uppercase tracking-widest text-red-700 hover:text-red-900 border border-red-300 rounded-lg px-2 py-1 hover:bg-red-100 transition-colors shrink-0"
            >
              Ver pendientes
            </button>
          </div>
        )}

        {/* Banner de sesión por vencer */}
        {state.tokenExpirySoon && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <p className="text-xs font-semibold text-amber-800">
                Tu sesión vence en <span className="font-black">{state.tokenMinutesLeft} min</span>. Guardá tu trabajo y volvé a ingresar.
              </p>
            </div>
            <button
              onClick={actions.handleLogout}
              className="text-[10px] font-black uppercase tracking-widest text-amber-700 hover:text-amber-900 border border-amber-300 rounded-lg px-2 py-1 hover:bg-amber-100 transition-colors shrink-0"
            >
              Renovar sesión
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 bg-slate-50/50 relative overscroll-y-contain">
          {/* Monitor — solo Admin y Admisión */}
          {hasFullAccess && state.currentView === 'HOME' && <DashboardView tickets={state.filteredTickets} />}
          {/* Operativa — Admin, Admisión y Azafata */}
          {hasOperationalAccess && state.currentView === 'REQUESTS' && (
            <RequestsView
              tickets={state.filteredTickets} activeRole={state.activeRole} setActiveRole={actions.setActiveRole} averageWaitTime={avgWaitTime}
              searchTerm={state.requestsSearchTerm} setSearchTerm={actions.setRequestsSearchTerm} sortConfig={state.sortConfig}
              onSort={(key) => actions.setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))}
              onNewRequest={() => setIsNewRequestOpen(true)}
              onValidateReason={actions.handleValidateTicket}
              onAssignBed={handleOpenAssignBed}
              onHousekeepingAction={actions.handleHousekeepingAction}
              onStartTransport={actions.handleStartTransport}
              onCompleteTransport={actions.handleCompleteTransport}
              onRoomReady={actions.handleRoomReady}
              onConfirmReception={actions.handleConfirmReception}
              onConsolidate={actions.handleConsolidate}
              onReject={(id) => { setRejectTicketId(id); setIsRejectOpen(true); }}
              onEdit={(id) => setEditTicketId(id)}
              currentUser={state.currentUser}
              beds={state.beds}
              isolatedPatients={state.isolatedPatients}
            />
          )}
          {/* Historial — todos los roles */}
          {state.currentView === 'HISTORY' && <HistoryView tickets={state.historyTickets} />}
          {/* Usuarios — solo Admin */}
          {isAdmin && state.currentView === 'USERS' && <UserManagementView currentUser={state.currentUser} />}
          {/* Roles — solo Admin */}
          {isAdmin && (state.currentView as string) === 'ROLES' && <RoleManagementView currentUser={state.currentUser} />}
          {/* Mapa de Camas — visible para todos los roles cuando es la vista activa */}
          {state.currentView === 'BEDS' && <BedsView beds={state.beds} tickets={state.tickets} currentUser={state.currentUser} bedsLoading={state.bedsLoading} bedsError={state.bedsError} isolatedBeds={state.isolatedBeds} isolatedPatients={state.isolatedPatients} onToggleIsolation={actions.toggleIsolation} onEnrichBed={actions.enrichBed} onRefresh={actions.refreshAll} />}
        </main>
      </div>

      {/* Modals */}
      <NewRequestModal
        open={isNewRequestOpen}
        onOpenChange={setIsNewRequestOpen}
        onCreate={onNewRequestCreated}
        beds={state.beds}
        isolatedPatients={state.isolatedPatients}
        activeTransferOrigins={new Set(state.tickets.filter(t => t.status !== 'Consolidado' && t.status !== 'Cancelado').map(t => t.origin))}
      />
      <EditRequestModal
        open={!!editTicketId}
        onOpenChange={(open) => { if (!open) setEditTicketId(null); }}
        ticket={editTicketId ? (state.tickets.find(t => t.id === editTicketId) ?? null) : null}
        beds={state.beds}
        isolatedPatients={state.isolatedPatients}
        onSave={(payload: EditRequestPayload) => {
          actions.handleEditTicket(payload);
          setEditTicketId(null);
        }}
      />
      <AssignBedModal open={isAssignBedOpen} onOpenChange={setIsAssignBedOpen} onConfirm={onConfirmBed} />
      <RejectionModal
        open={isRejectOpen}
        onOpenChange={setIsRejectOpen}
        onConfirm={(reason) => {
          if (rejectTicketId) actions.handleRejectTicket(rejectTicketId, reason);
          setRejectTicketId(null);
        }}
      />
      <AreaSelectionModal
        open={isAreaSelectionOpen}
        onOpenChange={setIsAreaSelectionOpen}
        onConfirm={actions.handleUpdateUserAreas}
        initialSelectedAreas={state.currentUser?.assignedAreas}
      />

      {/* Modal de notificaciones pendientes */}
      <Dialog open={isUnreadModalOpen} onOpenChange={setIsUnreadModalOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Bell className="w-5 h-5 text-red-500" />
              Notificaciones Pendientes
              <span className="text-sm font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">{state.unreadSpNotifications?.length || 0}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2 py-2">
            {(state.unreadSpNotifications ?? []).map((n: any) => (
              <div key={n.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors">
                <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900">{n.title}</p>
                  <p className="text-xs text-slate-500 truncate">{n.message}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{n.fecha ? new Date(n.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</p>
                </div>
                <button
                  onClick={() => actions.handleMarkNotificationRead(n.id)}
                  className="text-[9px] font-bold uppercase text-emerald-600 hover:text-emerald-800 border border-emerald-200 rounded-lg px-2 py-1 hover:bg-emerald-50 transition-colors shrink-0"
                >
                  Leída
                </button>
              </div>
            ))}
            {(state.unreadSpNotifications ?? []).length === 0 && (
              <div className="py-10 text-center">
                <Bell className="w-10 h-10 mx-auto mb-3 text-emerald-200" />
                <p className="text-sm font-bold text-slate-300">Sin notificaciones pendientes</p>
              </div>
            )}
          </div>
          {(state.unreadSpNotifications ?? []).length > 0 && (
            <div className="border-t border-slate-100 pt-3 flex gap-2">
              <button
                onClick={() => {
                  // Mark all SP notifications as read
                  (state.unreadSpNotifications ?? []).forEach((n: any) => {
                    actions.handleMarkNotificationRead(n.id);
                  });
                  actions.handleMarkAllNotificationsRead();
                  setIsUnreadModalOpen(false);
                }}
                className="flex-1 h-10 rounded-xl font-bold text-xs uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                Marcar todas como leídas
              </button>
              <button
                onClick={() => setIsUnreadModalOpen(false)}
                className="h-10 px-4 rounded-xl font-bold text-xs uppercase tracking-widest border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
              >
                Cerrar
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isLegendModalOpen} onOpenChange={setIsLegendModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Estado de Camas</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 mt-4">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-emerald-500" />
              <span className="text-sm font-bold text-slate-700">DISPONIBLE</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-red-500" />
              <span className="text-sm font-bold text-slate-700">OCUPADA</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-amber-500" />
              <span className="text-sm font-bold text-slate-700">EN PREPARACIÓN</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-blue-500" />
              <span className="text-sm font-bold text-slate-700">ASIGNADA (TRÁNSITO)</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-slate-400" />
              <span className="text-sm font-bold text-slate-700">INHABILITADA</span>
            </div>
            <div className="border-t border-slate-100 pt-3 mt-1 space-y-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Aislamientos</span>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-pink-500" /><span className="text-xs text-slate-600">Neutropénico</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-slate-500" /><span className="text-xs text-slate-600">Trasplante</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-green-500" /><span className="text-xs text-slate-600">Respiratorio</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500" /><span className="text-xs text-slate-600">Por Gotas</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-yellow-500" /><span className="text-xs text-slate-600">Covid</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-violet-500" /><span className="text-xs text-slate-600">Entomológico</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-orange-500" /><span className="text-xs text-slate-600">Contacto</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-800" /><span className="text-xs text-slate-600">CD</span></div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
