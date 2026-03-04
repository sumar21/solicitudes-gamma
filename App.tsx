
import React, { useState, useEffect } from 'react';
import {
  Activity, LayoutDashboard, Home as HomeIcon, LogOut, MessageSquare, History, Menu, X
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

// Modals
import { NewRequestModal } from './components/modals/NewRequestModal';
import { AssignBedModal } from './components/modals/AssignBedModal';
import { RejectionModal } from './components/modals/RejectionModal';
import { AreaSelectionModal } from './components/modals/AreaSelectionModal'; // Import
import { cn } from './lib/utils';

export default function App() {
  const { state, actions } = useHospitalState();

  // UI State local (para control de modales)
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);
  const [isAssignBedOpen, setIsAssignBedOpen] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [isAreaSelectionOpen, setIsAreaSelectionOpen] = useState(false); // New state
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Open Area Selection on login if Hostess has no areas assigned
  useEffect(() => {
    if (state.currentUser?.role === Role.HOSTESS && (!state.currentUser.assignedAreas || state.currentUser.assignedAreas.length === 0)) {
      setIsAreaSelectionOpen(true);
    }
  }, [state.currentUser?.id]);

  const onConfirmRejection = (reason: string) => {
    if (selectedTicketId) {
      actions.handleRejectAction(selectedTicketId, reason);
      setSelectedTicketId(null);
    }
  };

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

  const handleOpenReject = (id: string) => {
    setSelectedTicketId(id);
    setIsRejectDialogOpen(true);
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
    <div className="h-screen w-full flex flex-col md:flex-row bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-60 bg-zinc-950 text-zinc-300 flex-col shrink-0 border-r border-zinc-900 z-20">
        <div className="h-20 flex items-center px-6 border-b border-zinc-900 shrink-0">
          <Activity className="w-5 h-5 text-white mr-3" />
          <div className="flex flex-col">
            <span className="font-bold text-white tracking-tight leading-none text-lg">MediFlow</span>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Sede {state.currentUser.sede}</span>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
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
        <div className="p-4 border-t border-zinc-900">
          <Button variant="ghost" className="w-full justify-start gap-3 text-red-400 hover:text-red-300 hover:bg-red-950/20" onClick={actions.handleLogout}><LogOut className="w-4 h-4" /> Salir</Button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 relative pb-16 md:pb-0">
        <header className="h-14 md:h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shrink-0 z-10 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="md:hidden p-1.5 bg-zinc-950 rounded-lg text-white mr-2">
              <Activity className="w-4 h-4" />
            </div>
            <h1 className="text-base md:text-xl font-bold text-slate-800 truncate max-w-[150px] sm:max-w-none">
              {state.currentView === 'HOME' ? 'Monitor' : state.currentView === 'REQUESTS' ? 'Operativa' : state.currentView === 'BEDS' ? 'Mapa de Camas' : 'Historial'}
            </h1>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {/* hasOperationalAccess && (
              <Button
                variant={state.isChatOpen ? "secondary" : "outline"}
                size="sm"
                className="gap-2 h-9 md:h-10 rounded-xl"
                onClick={() => actions.setChatOpen(!state.isChatOpen)}
              >
                <MessageSquare className="w-4 h-4" />
                <span className="hidden sm:inline">Mensajes</span>
              </Button>
            ) */}
            <div className="flex items-center gap-3 pl-2 md:pl-4 border-l border-slate-100">
              {state.currentUser?.role === Role.HOSTESS && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-[10px] font-bold uppercase tracking-wider px-2 rounded-lg border-zinc-200 hover:bg-zinc-50"
                  onClick={() => setIsAreaSelectionOpen(true)}
                >
                  Áreas: {state.currentUser.assignedAreas?.length || 0}
                </Button>
              )}
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-bold text-slate-900 leading-none">{state.currentUser.name}</span>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Sede {state.currentUser.sede}</span>
              </div>
              <div className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600 shadow-sm">{state.currentUser.avatar}</div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-50/50">
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
              onRejectTicket={handleOpenReject}
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
          {(state.currentView === 'BEDS' || (!hasFullAccess && !hasAzafataAccess)) && <BedsView beds={state.beds} />}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200 flex items-center justify-around px-2 z-30 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        {hasFullAccess && (
          <>
            <button
              onClick={() => actions.setCurrentView('HOME')}
              className={cn(
                "flex flex-col items-center justify-center gap-1 w-full h-full transition-colors",
                state.currentView === 'HOME' ? "text-zinc-950" : "text-slate-400"
              )}
            >
              <HomeIcon className={cn("w-5 h-5", state.currentView === 'HOME' && "fill-zinc-950/10")} />
              <span className="text-[9px] font-black uppercase tracking-tighter">Monitor</span>
              {state.currentView === 'HOME' && <div className="w-1 h-1 bg-zinc-950 rounded-full mt-0.5" />}
            </button>
            <button
              onClick={() => actions.setCurrentView('REQUESTS')}
              className={cn(
                "flex flex-col items-center justify-center gap-1 w-full h-full transition-colors",
                state.currentView === 'REQUESTS' ? "text-zinc-950" : "text-slate-400"
              )}
            >
              <LayoutDashboard className={cn("w-5 h-5", state.currentView === 'REQUESTS' && "fill-zinc-950/10")} />
              <span className="text-[9px] font-black uppercase tracking-tighter">Tareas</span>
              {state.currentView === 'REQUESTS' && <div className="w-1 h-1 bg-zinc-950 rounded-full mt-0.5" />}
            </button>
          </>
        )}
        {hasAzafataAccess && (
          <button
            onClick={() => actions.setCurrentView('REQUESTS')}
            className={cn(
              "flex flex-col items-center justify-center gap-1 w-full h-full transition-colors",
              state.currentView === 'REQUESTS' ? "text-zinc-950" : "text-slate-400"
            )}
          >
            <LayoutDashboard className={cn("w-5 h-5", state.currentView === 'REQUESTS' && "fill-zinc-950/10")} />
            <span className="text-[9px] font-black uppercase tracking-tighter">Operativa</span>
            {state.currentView === 'REQUESTS' && <div className="w-1 h-1 bg-zinc-950 rounded-full mt-0.5" />}
          </button>
        )}
        <button
          onClick={() => actions.setCurrentView('BEDS')}
          className={cn(
            "flex flex-col items-center justify-center gap-1 w-full h-full transition-colors",
            state.currentView === 'BEDS' ? "text-zinc-950" : "text-slate-400"
          )}
        >
          <Menu className={cn("w-5 h-5", state.currentView === 'BEDS' && "fill-zinc-950/10")} />
          <span className="text-[9px] font-black uppercase tracking-tighter">Camas</span>
          {state.currentView === 'BEDS' && <div className="w-1 h-1 bg-zinc-950 rounded-full mt-0.5" />}
        </button>
        <button
          onClick={actions.handleLogout}
          className="flex flex-col items-center justify-center gap-1 w-full h-full text-red-400"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-[9px] font-black uppercase tracking-tighter">Salir</span>
        </button>
      </nav>

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
      <RejectionModal open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen} onConfirm={onConfirmRejection} />
      <AreaSelectionModal
        open={isAreaSelectionOpen}
        onOpenChange={setIsAreaSelectionOpen}
        onConfirm={actions.handleUpdateUserAreas}
        initialSelectedAreas={state.currentUser?.assignedAreas}
      />
    </div>
  );
}
