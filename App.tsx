
import React, { useState, useEffect } from 'react';
import {
  Activity, LayoutDashboard, Home as HomeIcon, LogOut, MessageSquare, History, Menu, X, Info
} from './components/Icons';
import { ChatSidebar } from './components/ChatSidebar';
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Card } from "./components/ui/card";

// Views
import { DashboardView } from './views/DashboardView';
import { RequestsView } from './views/RequestsView';
import { HistoryView } from './views/HistoryView';
import { BedsView } from './views/BedsView';

// Hooks & Constants
import { useHospitalState } from './hooks/useHospitalState';
import { CHANNELS } from './lib/constants';
import { Role } from './types'; // Import Role

import { NotificationsDropdown } from './components/NotificationsDropdown';
import { Popover, PopoverTrigger, PopoverContent } from './components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Bell } from './components/Icons';

// Modals
import { NewRequestModal } from './components/modals/NewRequestModal';
import { AssignBedModal } from './components/modals/AssignBedModal';
import { AreaSelectionModal } from './components/modals/AreaSelectionModal'; // Import
import { cn } from './lib/utils';

export default function App() {
  const { state, actions } = useHospitalState();

  // UI State local (para control de modales)
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);
  const [isAssignBedOpen, setIsAssignBedOpen] = useState(false);
  const [isAreaSelectionOpen, setIsAreaSelectionOpen] = useState(false); // New state
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLegendModalOpen, setIsLegendModalOpen] = useState(false);

  // Open Area Selection on login if Hostess has no areas assigned
  useEffect(() => {
    if (state.currentUser?.role === Role.HOSTESS && (!state.currentUser.assignedAreas || state.currentUser.assignedAreas.length === 0)) {
      setIsAreaSelectionOpen(true);
    }
  }, [state.currentUser?.id]);

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

  // Azafata: Operativa + Mapa de Camas
  const hasAzafataAccess = state.currentUser?.role === Role.HOSTESS;

  // Cualquier role con al menos acceso a Operativa
  const hasOperationalAccess = hasFullAccess || hasAzafataAccess;

  // Force view to BEDS if read-only and trying to access other views (or default)
  // This effect could be better handled in useEffect, but for now we control rendering.

  if (!state.currentUser) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-100 p-4 md:p-6">
        <Card className="w-full max-w-md p-6 md:p-10 shadow-xl rounded-3xl border-none bg-white">
          {/* ... header ... */}
          <div className="flex flex-col items-center mb-8 md:mb-10">
            <div className="w-14 h-14 md:w-16 md:h-16 bg-zinc-950 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg">
              <Activity className="w-7 h-7 md:w-8 md:h-8" />
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">MediFlow Orchestrator</h1>
            <p className="text-slate-400 text-xs md:sm font-medium mt-2 text-center">Login de Sede Hospitalaria</p>
          </div>
          <form onSubmit={actions.handleLogin} className="space-y-4 md:space-y-6">
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest ml-1">Email Institucional</Label>
              <Input type="email" value={state.loginEmail} onChange={e => actions.setLoginEmail(e.target.value)} className="h-11 md:h-12 rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest ml-1">Contraseña</Label>
              <Input type="password" value={state.loginPass} onChange={e => actions.setLoginPass(e.target.value)} className="h-11 md:h-12 rounded-xl" />
            </div>
            {state.loginError && <p className="text-red-500 text-xs font-bold text-center">{state.loginError}</p>}
            <Button type="submit" className="w-full h-11 md:h-12 bg-zinc-950 hover:bg-black rounded-xl text-white font-semibold">Entrar al Sistema</Button>
          </form>
          <div className="mt-6 md:mt-8 pt-6 md:pt-8 border-t border-slate-100 flex flex-wrap justify-center gap-4">
            <button onClick={() => { actions.setLoginEmail('admin@hpr.com'); actions.setLoginPass('1234'); }} className="text-[9px] font-bold text-slate-400 hover:text-zinc-950 uppercase">Admin</button>
            <button onClick={() => { actions.setLoginEmail('admision@hpr.com'); actions.setLoginPass('1234'); }} className="text-[9px] font-bold text-slate-400 hover:text-zinc-950 uppercase">Admisión</button>
            <button onClick={() => { actions.setLoginEmail('azafata@hpr.com'); actions.setLoginPass('1234'); }} className="text-[9px] font-bold text-slate-400 hover:text-zinc-950 uppercase">Azafata</button>
            <button onClick={() => { actions.setLoginEmail('enfermeria@hpr.com'); actions.setLoginPass('1234'); }} className="text-[9px] font-bold text-slate-400 hover:text-zinc-950 uppercase">Enfermería</button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen h-[100dvh] w-full flex flex-col md:flex-row bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-48 bg-zinc-950 text-zinc-300 flex-col shrink-0 border-r border-zinc-900 z-30">
        <div className="h-20 flex items-center px-4 border-b border-zinc-900 shrink-0">
          <Activity className="w-5 h-5 text-white mr-3" />
          <div className="flex flex-col">
            <span className="font-bold text-white tracking-tight leading-none text-lg">MediFlow</span>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Sede {state.currentUser.sede}</span>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {hasFullAccess && (
            <>
              <Button variant={state.currentView === 'HOME' ? 'secondary' : 'ghost'} className="w-full justify-start gap-3 h-11" onClick={() => actions.setCurrentView('HOME')}><HomeIcon className="w-4 h-4" />Monitor</Button>
              <Button variant={state.currentView === 'REQUESTS' ? 'secondary' : 'ghost'} className="w-full justify-start gap-3 h-11" onClick={() => actions.setCurrentView('REQUESTS')}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
              <Button variant={state.currentView === 'HISTORY' ? 'secondary' : 'ghost'} className="w-full justify-start gap-3 h-11" onClick={() => actions.setCurrentView('HISTORY')}><History className="w-4 h-4" />Historial</Button>
            </>
          )}
          {hasAzafataAccess && (
            <Button variant={state.currentView === 'REQUESTS' ? 'secondary' : 'ghost'} className="w-full justify-start gap-3 h-11" onClick={() => actions.setCurrentView('REQUESTS')}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
          )}
          <Button variant={state.currentView === 'BEDS' ? 'secondary' : 'ghost'} className="w-full justify-start gap-3 h-11" onClick={() => actions.setCurrentView('BEDS')}><Menu className="w-4 h-4" />Mapa de Camas</Button>
        </nav>
        <div className="p-3 border-t border-zinc-900">
          <Button variant="ghost" className="w-full justify-start gap-3 text-red-400 hover:text-red-300 hover:bg-red-950/20" onClick={actions.handleLogout}><LogOut className="w-4 h-4" /> Salir</Button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <header className="h-16 md:h-14 bg-white border-b border-slate-200 flex items-center justify-between px-2 md:px-8 shrink-0 z-20 shadow-sm relative">
          <div className="flex items-center gap-1.5">
            <button 
              className="md:hidden p-2 bg-zinc-950 rounded-xl text-white hover:bg-zinc-800 transition-colors shadow-lg active:scale-95"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Activity className="w-5 h-5" />
            </button>
            <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight truncate max-w-[100px] xs:max-w-[180px] sm:max-w-none">
              {state.currentView === 'HOME' ? 'Monitor' : state.currentView === 'REQUESTS' ? 'Operativa' : state.currentView === 'BEDS' ? 'Camas' : 'Historial'}
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
            "fixed inset-y-0 left-0 w-64 bg-zinc-950 text-zinc-300 flex flex-col z-50 md:hidden transition-transform duration-300 ease-in-out shadow-2xl",
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}>
            <div className="h-14 flex items-center justify-between px-4 border-b border-zinc-900 shrink-0">
              <div className="flex items-center">
                <Activity className="w-5 h-5 text-white mr-3" />
                <div className="flex flex-col">
                  <span className="font-bold text-white tracking-tight leading-none text-lg">MediFlow</span>
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Sede {state.currentUser.sede}</span>
                </div>
              </div>
              <button 
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 text-zinc-400 hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {hasFullAccess && (
                <>
                  <Button variant={state.currentView === 'HOME' ? 'secondary' : 'ghost'} className="w-full justify-start gap-3 h-11" onClick={() => { actions.setCurrentView('HOME'); setIsMobileMenuOpen(false); }}><HomeIcon className="w-4 h-4" />Monitor</Button>
                  <Button variant={state.currentView === 'REQUESTS' ? 'secondary' : 'ghost'} className="w-full justify-start gap-3 h-11" onClick={() => { actions.setCurrentView('REQUESTS'); setIsMobileMenuOpen(false); }}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
                  <Button variant={state.currentView === 'HISTORY' ? 'secondary' : 'ghost'} className="w-full justify-start gap-3 h-11" onClick={() => { actions.setCurrentView('HISTORY'); setIsMobileMenuOpen(false); }}><History className="w-4 h-4" />Historial</Button>
                </>
              )}
              {hasAzafataAccess && (
                <Button variant={state.currentView === 'REQUESTS' ? 'secondary' : 'ghost'} className="w-full justify-start gap-3 h-11" onClick={() => { actions.setCurrentView('REQUESTS'); setIsMobileMenuOpen(false); }}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
              )}
              <Button variant={state.currentView === 'BEDS' ? 'secondary' : 'ghost'} className="w-full justify-start gap-3 h-11" onClick={() => { actions.setCurrentView('BEDS'); setIsMobileMenuOpen(false); }}><Menu className="w-4 h-4" />Mapa de Camas</Button>
            </nav>
            <div className="p-3 border-t border-zinc-900">
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
                <Button
                  variant="outline"
                  className="h-10 sm:h-8 text-xs sm:text-[10px] font-black uppercase tracking-wider px-2 sm:px-2 rounded-xl border-zinc-200 bg-zinc-50 hover:bg-zinc-100 active:scale-95 transition-all shadow-sm"
                  onClick={() => setIsAreaSelectionOpen(true)}
                >
                  SECTORES: {state.currentUser.assignedAreas?.length || 0}
                </Button>
              )}
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-bold text-slate-900 leading-none">{state.currentUser.name}</span>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Sede {state.currentUser.sede}</span>
              </div>
              {state.currentUser?.role !== Role.HOSTESS && (
                <div className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600 shadow-sm shrink-0">{state.currentUser.avatar}</div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 bg-slate-50/50 relative overscroll-y-contain">
          {/* Monitor — solo Admin y Admisión */}
          {hasFullAccess && state.currentView === 'HOME' && <DashboardView tickets={state.filteredTickets} />}
          {/* Operativa — Admin, Admisión y Azafata */}
          {hasOperationalAccess && state.currentView === 'REQUESTS' && (
            <RequestsView
              tickets={state.filteredTickets} activeRole={state.activeRole} setActiveRole={actions.setActiveRole} averageWaitTime={35}
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
              currentUser={state.currentUser}
              beds={state.beds}
            />
          )}
          {/* Historial — solo Admin y Admisión */}
          {hasFullAccess && state.currentView === 'HISTORY' && <HistoryView tickets={state.filteredTickets} />}
          {/* Mapa de Camas — todos los roles, o fallback si el rol no tiene otra vista */}
          {(state.currentView === 'BEDS' || (!hasFullAccess && !hasAzafataAccess)) && <BedsView beds={state.beds} currentUser={state.currentUser} />}
        </main>
      </div>

      {/* Chat responsivo */}
      {state.isChatOpen && (
        <div className="fixed inset-0 z-[100] md:relative md:inset-auto md:z-30 h-full">
          <ChatSidebar
            channels={CHANNELS}
            activeChannelId={state.activeChannelId}
            onChannelSelect={actions.setActiveChannelId}
            messages={state.filteredChatMessages}
            onSendMessage={actions.handleSendMessage}
            onClose={() => actions.setChatOpen(false)}
          />
        </div>
      )}

      {/* Modals */}
      <NewRequestModal
        open={isNewRequestOpen}
        onOpenChange={setIsNewRequestOpen}
        onCreate={onNewRequestCreated}
        beds={state.beds}
      />
      <AssignBedModal open={isAssignBedOpen} onOpenChange={setIsAssignBedOpen} onConfirm={onConfirmBed} />
      <AreaSelectionModal
        open={isAreaSelectionOpen}
        onOpenChange={setIsAreaSelectionOpen}
        onConfirm={actions.handleUpdateUserAreas}
        initialSelectedAreas={state.currentUser?.assignedAreas}
      />

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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
