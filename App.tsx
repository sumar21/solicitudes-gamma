
import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Home as HomeIcon, LogOut, History, Menu, Info,
  Mail, Lock, Eye, EyeOff, User, Settings, ChevronDown, ChevronUp, Users, Download
} from './components/Icons';
import { Globe, MapPin as MapPinIcon, RefreshCw, Utensils } from 'lucide-react';
import { GammaLogo } from './components/GammaLogo';
import { ModuleHelp } from './components/ModuleHelp';
import { IS_TESTING } from './lib/env';
import { APP_VERSION } from './lib/version';
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Card } from "./components/ui/card";

// Views
import { DashboardView } from './views/DashboardView';
import { RequestsView } from './views/RequestsView';
import { HistoryView } from './views/HistoryView';
import { BedsView } from './views/BedsView';
import { CleaningManagementView } from './views/CleaningManagementView';
import { CirugiasView } from './views/CirugiasView';
import { ComandasManagementView } from './views/ComandasManagementView';
import { UserManagementView } from './views/UserManagementView';
import { RoleManagementView } from './views/RoleManagementView';

// Hooks & Constants
import { useHospitalState } from './hooks/useHospitalState';
import { TicketStatus } from './types';
import { can, hasModule, receivesAnyNotif } from './lib/permissions';

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

// SVG inline del spray-can (lucide 0.344). Se inlinea porque el componente `SprayCan`
// del barrel de lucide no renderizaba en el sidebar (mientras los demás iconos, del mismo
// módulo, sí). Con el SVG directo evitamos cualquier problema de resolución/bundling.
const SprayCanIcon = ({ className }: { className?: string }) => (
  // width/height="24" (dimensión intrínseca, como los iconos de lucide) + shrink-0: sin esto
  // el SVG se colapsa a 0 en el flex del sidebar desktop (se veía en mobile pero no en desktop).
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0', className)} aria-hidden="true">
    <path d="M3 3h.01" /><path d="M7 5h.01" /><path d="M11 7h.01" /><path d="M3 7h.01" />
    <path d="M7 9h.01" /><path d="M3 11h.01" />
    <rect width="4" height="4" x="15" y="5" />
    <path d="m19 9 2 2v10c0 .6-.4 1-1 1h-6c-.6 0-1-.4-1-1V11l2-2" />
    <path d="m13 14 8-2" /><path d="m13 19 8-2" />
  </svg>
);

// Gate de identificación para CUENTAS COMPARTIDAS: cuando el rol lo exige y no hay operador de
// sesión, se bloquea la app con "¿Quién sos?" (mismo look que el login). El nombre (texto libre)
// queda como responsable de las transacciones hasta el "cambio de turno".
const IdentificationGate: React.FC<{
  accountName: string;
  onConfirm: (name: string) => void;
  onLogout: () => void;
}> = ({ accountName, onConfirm, onLogout }) => {
  const [name, setName] = useState('');
  const submit = (e: React.FormEvent) => { e.preventDefault(); const n = name.trim(); if (n) onConfirm(n); };
  return (
    <div className="h-screen w-full flex flex-col items-center bg-slate-50 overflow-auto">
      <div className="w-full flex flex-col items-center pt-12 pb-28 md:pt-16 md:pb-32 px-4" style={{ background: 'linear-gradient(180deg, #022C22 0%, #034334 60%, #04604b 100%)' }}>
        <GammaLogo size={64} className="text-white mb-5" />
        <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">¿Quién sos?</h1>
        <p className="text-emerald-300/80 text-sm font-medium mt-1">Identificate para registrar tus operaciones</p>
      </div>
      <Card className="w-full max-w-md -mt-20 mx-4 p-6 md:p-10 shadow-xl rounded-3xl border-none bg-white relative z-10">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-full bg-emerald-50 border-2 border-emerald-100 flex items-center justify-center -mt-12 md:-mt-14 mb-4 shadow-sm">
            <User className="w-6 h-6 text-emerald-700" />
          </div>
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Cuenta compartida</p>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">{accountName}</h2>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest ml-1">Tu nombre</Label>
            <Input autoFocus type="text" placeholder="Nombre y apellido" value={name} onChange={e => setName(e.target.value)}
              className="h-12 rounded-xl border-emerald-200 focus:border-emerald-500 focus:ring-emerald-500/20" />
            <p className="text-[11px] text-slate-400 ml-1">Todas tus operaciones van a quedar registradas a tu nombre hasta el cambio de turno.</p>
          </div>
          <Button type="submit" disabled={!name.trim()} className="w-full h-12 rounded-xl text-white font-bold disabled:opacity-40" style={{ backgroundColor: '#022C22' }}>
            Continuar
          </Button>
        </form>
        <button type="button" onClick={onLogout} className="w-full mt-4 text-xs font-bold text-slate-400 hover:text-slate-600">Cerrar sesión</button>
      </Card>
    </div>
  );
};

export default function App() {
  const { state, actions } = useHospitalState();

  // Espera media real: promedio de tiempo total de tickets consolidados.
  //
  // Sale de `historyTickets` y no de `tickets`: el poll de 15s dejó de traer el histórico,
  // así que `tickets` ya casi no tiene Consolidados (solo los de la ventana de gracia de
  // 30 min del server). `historyTickets` ahora es el RANGO cargado por Monitor/Historial (por
  // defecto "hoy"), así que este promedio refleja los cierres de ese rango; si el usuario no
  // pasó por esas vistas (p.ej. una azafata en Operativa), promedia solo los cierres recientes
  // del merge vivo, o muestra '--' si no hubo ninguno.
  const avgWaitTime = React.useMemo(() => {
    const completed = state.historyTickets.filter(t => t.status === TicketStatus.COMPLETED && t.createdAt && t.completedAt);
    if (completed.length === 0) return '--';
    const total = completed.reduce((acc, t) => acc + calculateTicketMetrics(t).totalCycleTime, 0);
    return Math.round(total / completed.length);
  }, [state.historyTickets]);

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
  const [syncingRoles, setSyncingRoles] = useState(false);

  // Fuerza el resync de módulos/permisos del rol (útil si un admin cambió tu acceso y
  // no querés esperar al poll de 60s). Actualiza el navbar en el acto si hubo cambios.
  const handleSyncRoles = useCallback(async () => {
    setSyncingRoles(true);
    try { await actions.syncSessionRole(); } finally { setSyncingRoles(false); }
  }, [actions]);

  // Open Area Selection on login only if the user's role filters by floors AND has none assigned yet.
  // Cubre HOSTESS, CATERING y cualquier rol nuevo con FiltrarPisos_RT=Sí.
  useEffect(() => {
    if (state.currentUser?.filterByFloors && (!state.currentUser.assignedAreas || state.currentUser.assignedAreas.length === 0)) {
      setIsAreaSelectionOpen(true);
    }
  }, [state.currentUser?.id]);

  // Logout silencioso una vez para usuarios que quedaron logueados pre-refactor
  // (sin permissions / modules en localStorage). Re-loguean y reciben la config nueva.
  useEffect(() => {
    const u = state.currentUser;
    if (u && (!Array.isArray(u.permissions) || !Array.isArray(u.modules))) {
      console.log('[App] User without permissions/modules — forcing re-login to pick up role config');
      actions.handleLogout();
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

  // Vistas accesibles (Acceso_RT del rol). Si el back devolvió `modules`, manda eso;
  // si no (fail-open en caso de rol no migrado), el hook ya forzó logout — acá quedan flags safe-default.
  const canViewMonitor   = hasModule(state.currentUser, 'Home');
  // Limpiezas vive DENTRO de Operativa como solapa, así que la entrada del sidebar se habilita
  // con cualquiera de los dos módulos. OJO: esto NO amplía acceso — cada solapa se gatea por
  // separado, así que un rol con solo Limpieza entra pero NO ve la lista de traslados.
  const canViewOperativa = hasModule(state.currentUser, 'Operativa') || hasModule(state.currentUser, 'Gestion Limpieza');
  const canSeeTraslados  = hasModule(state.currentUser, 'Operativa');
  const canSeeLimpiezas  = hasModule(state.currentUser, 'Gestion Limpieza');
  // Cirugías vive como solapa de Operativa (feature Cirugía). El gating fino por permiso
  // cirugia_* llega en F5/go-live; por ahora la ve cualquiera con Operativa o Mapa de Camas
  // (así el Admin ve todo para testear). Ver contrato F4.
  const canSeeCirugias   = hasModule(state.currentUser, 'Operativa') || hasModule(state.currentUser, 'Mapa de Camas');
  // Solapas disponibles, en orden. La botonera solo aparece si hay más de una.
  const operativaTabDefs = ([
    canSeeTraslados && (['traslados', 'Traslados'] as const),
    canSeeLimpiezas && (['limpiezas', 'Limpiezas'] as const),
    canSeeCirugias  && (['cirugias', 'Cirugías'] as const),
  ].filter(Boolean)) as ReadonlyArray<readonly ['traslados' | 'limpiezas' | 'cirugias', string]>;
  const showOperativaTabs = operativaTabDefs.length > 1;
  // Solapa efectiva: si el rol no puede ver la seleccionada, cae en la primera disponible.
  const availableSubviews = new Set(operativaTabDefs.map(([v]) => v));
  const operativaTab = availableSubviews.has(state.operativaSubview)
    ? state.operativaSubview
    : (operativaTabDefs[0]?.[0] ?? 'traslados');
  const canViewHistorial = hasModule(state.currentUser, 'Historial');
  const canViewBeds      = hasModule(state.currentUser, 'Mapa de Camas');
  const canViewComandas  = hasModule(state.currentUser, 'Gestion Comandas');
  const canViewConfig    = hasModule(state.currentUser, 'Configuracion');

  // Subsections de Configuración por permiso fino.
  const canSeeUsers = canViewConfig && can(state.currentUser, 'abm_usuarios');
  const canSeeRoles = canViewConfig && can(state.currentUser, 'abm_roles');

  // Filtro por pisos asignados (Azafata, Catering, o cualquier rol nuevo con FiltrarPisos_RT=Sí).
  const hasAzafataAccess = !!state.currentUser?.filterByFloors;

  // Alias legacy — cualquier rol con vista de Operativa.

  // Force view to BEDS if read-only and trying to access other views (or default)
  // This effect could be better handled in useEffect, but for now we control rendering.

  // ── Login debug info: IP + Geo ─────────────────────────────────────────────
  // Mostramos abajo del login la IP que ve el server y la geolocalización del
  // browser. Sirve para que el usuario nos mande captura cuando le rebota la
  // validación de ubicación al loguear.
  const [clientIp, setClientIp]   = useState<string | null>(null);
  const [clientGeo, setClientGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError]   = useState<string | null>(null);
  const [loadingDebug, setLoadingDebug] = useState(false);

  const refreshDebugInfo = useCallback(() => {
    setLoadingDebug(true);
    setGeoError(null);

    // IP via endpoint público.
    fetch('/api/client-ip')
      .then(r => r.ok ? r.json() : null)
      .then(d => setClientIp(d?.ip ?? '—'))
      .catch(() => setClientIp('—'));

    // Geo via browser. Timeout corto para no quedarse colgado en el login.
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setClientGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLoadingDebug(false);
        },
        (err) => {
          setClientGeo(null);
          setGeoError(err.code === err.PERMISSION_DENIED ? 'permiso denegado' : 'no disponible');
          setLoadingDebug(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    } else {
      setGeoError('no soportado');
      setLoadingDebug(false);
    }
  }, []);

  useEffect(() => {
    if (!state.currentUser) refreshDebugInfo();
  }, [state.currentUser, refreshDebugInfo]);

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
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest ml-1">Usuario o Correo Electrónico</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  type="text"
                  autoComplete="username"
                  placeholder="azafatap5 o correo@grupogamma.com"
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

          <div className="mt-3 text-center text-[10px] font-mono text-slate-400 select-all" title="Versión del cliente">{APP_VERSION}</div>

          {/* Zócalo de debug — IP que ve el server + geo del browser. Útil para que
              el usuario nos mande captura si le rebota la validación de ubicación. */}
          <div className="mt-6 pt-4 border-t border-slate-100">
            <div className="flex items-stretch gap-2">
              <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <Globe className="w-3 h-3" />
                  IP Conexión
                </div>
                <div className="text-xs font-bold text-slate-700 tabular-nums mt-0.5 truncate">
                  {clientIp ?? '—'}
                </div>
              </div>
              <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <MapPinIcon className="w-3 h-3" />
                  Geo (Lat/Lng)
                </div>
                <div className="text-xs font-bold text-slate-700 tabular-nums mt-0.5 truncate">
                  {clientGeo
                    ? `${clientGeo.lat.toFixed(3)} / ${clientGeo.lng.toFixed(3)}`
                    : geoError ?? '—'}
                </div>
              </div>
              <button
                type="button"
                onClick={refreshDebugInfo}
                disabled={loadingDebug}
                title="Reintentar"
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={cn('w-4 h-4 text-slate-500', loadingDebug && 'animate-spin')} />
              </button>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 text-center">
            {IS_TESTING && (
              <span className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-slate-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-pulse" />
                Entorno de prueba
              </span>
            )}
            <p className="text-xs text-slate-400 font-medium">Grupo Gamma &bull; Red de Salud</p>
            <p className="text-[10px] text-slate-300 mt-0.5">MediFlow v1.0</p>
          </div>
        </Card>
      </div>
    );
  }

  // Cuenta compartida: si el rol requiere identificación y aún no hay operador de sesión, se
  // bloquea con el gate "¿Quién sos?". El "cambio de turno" limpia el operador → reaparece.
  if (state.currentUser?.requiresIdentification && !state.operador) {
    return <IdentificationGate accountName={state.currentUser.name} onConfirm={actions.setOperador} onLogout={actions.handleLogout} />;
  }

  return (
    <div className="h-screen h-[100dvh] w-full flex flex-col md:flex-row bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Toast notifications */}
      <NotificationToasts
        toasts={state.toasts}
        onDismiss={actions.handleDismissToast}
        onTap={(n) => {
          // Además de la vista, se fuerza la solapa: si el usuario estaba en Limpiezas,
          // setCurrentView('REQUESTS') no produce cambio y el toast se vería muerto.
          if (n.ticketId) { actions.setOperativaSubview('traslados'); actions.setCurrentView('REQUESTS'); }
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
      <aside className="hidden md:flex w-48 text-white flex-col shrink-0 z-30" style={{ background: IS_TESTING ? 'linear-gradient(180deg, #1e293b 0%, #475569 100%)' : 'linear-gradient(180deg, #022C22 0%, #034334 100%)' }}>
        <div className="h-20 flex items-center px-4 border-b border-white/10 shrink-0">
          <GammaLogo size={22} className={cn("mr-3", IS_TESTING ? "text-slate-300" : "text-emerald-400")} />
          <div className="flex flex-col">
            <span className="font-bold text-white tracking-tight leading-none text-lg">Gamma</span>
            <span className={cn("text-[9px] font-bold uppercase tracking-widest mt-1", IS_TESTING ? "text-slate-300" : "text-emerald-400")}>Sede {state.currentUser.sede}</span>
            {IS_TESTING && (
              <span className="mt-1 inline-flex items-center gap-1 self-start rounded-md bg-slate-600 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-pulse" />
                Entorno de prueba
              </span>
            )}
          </div>
        </div>
        <nav className="flex-1 p-3 flex flex-col">
          <div className="space-y-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/30 px-3 mb-1 block">Menú Principal</span>
            {canViewMonitor && (
              <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'HOME' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('HOME')}><HomeIcon className="w-4 h-4" />Monitor</Button>
            )}
            {canViewOperativa && !hasAzafataAccess && (
              <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'REQUESTS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('REQUESTS')}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
            )}
            {hasAzafataAccess && canViewOperativa && (
              <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'REQUESTS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('REQUESTS')}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
            )}
            {canViewHistorial && (
              <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'HISTORY' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('HISTORY')}><History className="w-4 h-4" />Historial</Button>
            )}
            {canViewBeds && (
              <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'BEDS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('BEDS')}><Menu className="w-4 h-4" />Mapa de Camas</Button>
            )}
            {canViewComandas && (
              <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'COMANDAS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('COMANDAS')}><Utensils className="w-4 h-4" />Comandas</Button>
            )}
          </div>

          {/* Configuración — collapsible. Visible si el rol tiene Acceso_RT incluyendo Configuracion. */}
          {canViewConfig && (canSeeUsers || canSeeRoles) && (
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
                  {canSeeUsers && <Button variant="ghost" className={cn("w-full justify-start gap-3 h-9 rounded-lg text-sm", state.currentView === 'USERS' ? 'bg-white/15 text-white font-bold' : 'text-white/60 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('USERS')}><Users className="w-3.5 h-3.5" />Usuarios</Button>}
                  {canSeeRoles && <Button variant="ghost" className={cn("w-full justify-start gap-3 h-9 rounded-lg text-sm", state.currentView === 'ROLES' as any ? 'bg-white/15 text-white font-bold' : 'text-white/60 hover:bg-white/10 hover:text-white')} onClick={() => actions.setCurrentView('ROLES' as any)}><Settings className="w-3.5 h-3.5" />Roles</Button>}
                </div>
              )}
            </div>
          )}
        </nav>
        <div className="p-3 border-t border-white/10 space-y-1">
          <Button variant="ghost" disabled={syncingRoles} className="w-full justify-start gap-3 text-white/70 hover:bg-white/10 hover:text-white" onClick={handleSyncRoles}>
            <RefreshCw className={cn("w-4 h-4", syncingRoles && "animate-spin")} /> Actualizar accesos
          </Button>
          {state.currentUser?.requiresIdentification && (
            <Button variant="ghost" className="w-full justify-start gap-3 text-emerald-300 hover:bg-emerald-950/20 hover:text-emerald-200" onClick={actions.cambioTurno} title={state.operador ? `Operador: ${state.operador} — tocá para cambiar de turno` : 'Cambiar el nombre del operador de esta sesión'}>
              <User className="w-4 h-4 shrink-0" />
              <span className="min-w-0 flex-1 text-left truncate">Cambio de turno{state.operador ? ` · ${state.operador}` : ''}</span>
            </Button>
          )}
          <Button variant="ghost" className="w-full justify-start gap-3 text-red-400 hover:text-red-300 hover:bg-red-950/20" onClick={actions.handleLogout}><LogOut className="w-4 h-4" /> Salir</Button>
          <div className="px-3 pt-1 text-[9px] font-mono text-white/25 tracking-wider select-all" title="Versión del cliente">{APP_VERSION}</div>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <header className="h-16 md:h-14 bg-white border-b border-slate-200 flex items-center justify-between px-2 md:px-8 shrink-0 z-20 shadow-sm relative">
          <div className="flex items-center gap-1.5">
            <button
              className="md:hidden p-2 rounded-xl text-white hover:opacity-90 transition-colors shadow-lg active:scale-95"
              style={{ backgroundColor: IS_TESTING ? '#334155' : '#022C22' }}
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <GammaLogo size={20} />
            </button>
            <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight truncate max-w-[100px] xs:max-w-[180px] sm:max-w-none">
              {state.currentView === 'HOME' ? 'Monitor' : state.currentView === 'REQUESTS' ? (operativaTab === 'limpiezas' ? 'Operativa · Limpiezas' : operativaTab === 'cirugias' ? 'Operativa · Cirugías' : 'Operativa') : state.currentView === 'BEDS' ? 'Mapa de Camas' : state.currentView === 'COMANDAS' ? 'Gestión de Comandas' : state.currentView === 'USERS' ? 'Usuarios' : (state.currentView as string) === 'ROLES' ? 'Roles' : 'Historial'}
            </h1>
            <ModuleHelp
              moduleKey={
                state.currentView === 'HOME' ? 'Monitor'
                : state.currentView === 'REQUESTS' ? 'Operativa'
                : state.currentView === 'BEDS' ? 'MapaCamas'
                : state.currentView === 'COMANDAS' ? 'Comandas'
                : (state.currentView === 'USERS' || (state.currentView as string) === 'ROLES') ? 'Configuracion'
                : 'Historial'
              }
              user={state.currentUser}
            />
            {IS_TESTING && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-sm shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-pulse" />
                <span className="hidden xs:inline">Entorno de prueba</span>
                <span className="xs:hidden">Test</span>
              </span>
            )}
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
          )} style={{ background: IS_TESTING ? 'linear-gradient(180deg, #1e293b 0%, #475569 100%)' : 'linear-gradient(180deg, #022C22 0%, #034334 100%)' }}>
            <div className="h-14 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
              <div className="flex items-center">
                <GammaLogo size={22} className={cn("mr-3", IS_TESTING ? "text-slate-300" : "text-emerald-400")} />
                <div className="flex flex-col">
                  <span className="font-bold text-white tracking-tight leading-none text-lg">Gamma</span>
                  {IS_TESTING ? (
                    <span className="inline-flex items-center gap-1 self-start rounded bg-slate-600 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-white mt-0.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-pulse" />
                      Entorno de prueba
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest mt-1">Sede {state.currentUser.sede}</span>
                  )}
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
                {canViewMonitor && (
                  <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'HOME' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('HOME'); setIsMobileMenuOpen(false); }}><HomeIcon className="w-4 h-4" />Monitor</Button>
                )}
                {canViewOperativa && !hasAzafataAccess && (
                  <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'REQUESTS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('REQUESTS'); setIsMobileMenuOpen(false); }}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
                )}
                {hasAzafataAccess && canViewOperativa && (
                  <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'REQUESTS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('REQUESTS'); setIsMobileMenuOpen(false); }}><LayoutDashboard className="w-4 h-4" />Operativa</Button>
                )}
                {canViewHistorial && (
                  <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'HISTORY' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('HISTORY'); setIsMobileMenuOpen(false); }}><History className="w-4 h-4" />Historial</Button>
                )}
                {canViewBeds && (
                  <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'BEDS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('BEDS'); setIsMobileMenuOpen(false); }}><Menu className="w-4 h-4" />Mapa de Camas</Button>
                )}
                {canViewComandas && (
                  <Button variant="ghost" className={cn("w-full justify-start gap-3 h-10 rounded-lg text-sm", state.currentView === 'COMANDAS' ? 'bg-white/15 text-white font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('COMANDAS'); setIsMobileMenuOpen(false); }}><Utensils className="w-4 h-4" />Comandas</Button>
                )}
              </div>

              {canViewConfig && (canSeeUsers || canSeeRoles) && (
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
                      {canSeeUsers && <Button variant="ghost" className={cn("w-full justify-start gap-3 h-9 rounded-lg text-sm", state.currentView === 'USERS' ? 'bg-white/15 text-white font-bold' : 'text-white/60 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('USERS'); setIsMobileMenuOpen(false); }}><Users className="w-3.5 h-3.5" />Usuarios</Button>}
                      {canSeeRoles && <Button variant="ghost" className={cn("w-full justify-start gap-3 h-9 rounded-lg text-sm", state.currentView === 'ROLES' as any ? 'bg-white/15 text-white font-bold' : 'text-white/60 hover:bg-white/10 hover:text-white')} onClick={() => { actions.setCurrentView('ROLES' as any); setIsMobileMenuOpen(false); }}><Settings className="w-3.5 h-3.5" />Roles</Button>}
                    </div>
                  )}
                </div>
              )}
            </nav>
            <div className="p-3 border-t border-white/10 space-y-1">
              {installPrompt && /android/i.test(navigator.userAgent) && (
                <Button variant="ghost" className="w-full justify-start gap-3 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/20" onClick={() => { handleInstallApp(); setIsMobileMenuOpen(false); }}><Download className="w-4 h-4" /> Instalar App</Button>
              )}
              <Button variant="ghost" disabled={syncingRoles} className="w-full justify-start gap-3 text-white/70 hover:bg-white/10 hover:text-white" onClick={handleSyncRoles}>
                <RefreshCw className={cn("w-4 h-4", syncingRoles && "animate-spin")} /> Actualizar accesos
              </Button>
              {state.currentUser?.requiresIdentification && (
                <Button variant="ghost" className="w-full justify-start gap-3 text-emerald-300 hover:bg-emerald-950/20 hover:text-emerald-200" onClick={() => { actions.cambioTurno(); setIsMobileMenuOpen(false); }} title={state.operador ? `Operador: ${state.operador}` : undefined}><User className="w-4 h-4 shrink-0" /><span className="min-w-0 flex-1 text-left truncate">Cambio de turno{state.operador ? ` · ${state.operador}` : ''}</span></Button>
              )}
              <Button variant="ghost" className="w-full justify-start gap-3 text-red-400 hover:text-red-300 hover:bg-red-950/20" onClick={() => { actions.handleLogout(); setIsMobileMenuOpen(false); }}><LogOut className="w-4 h-4" /> Salir</Button>
              <div className="px-3 pt-1 text-[9px] font-mono text-white/25 tracking-wider select-all" title="Versión del cliente">{APP_VERSION}</div>
            </div>
          </div>

          <div className="flex items-center gap-1 md:gap-4">
            {state.currentView === 'BEDS' && (
              <Button variant="ghost" size="icon" className="w-10 h-10 sm:w-9 sm:h-9 text-slate-400 hover:text-slate-600" onClick={() => setIsLegendModalOpen(true)}>
                <Info className="w-6 h-6 sm:w-5 sm:h-5" />
              </Button>
            )}
            <div className="flex items-center gap-1 sm:gap-3 pl-1 sm:pl-4 border-l border-slate-100">
              {(can(state.currentUser, 'notif_new_ticket')
                || can(state.currentUser, 'notif_status_update')
                || can(state.currentUser, 'notif_reception_confirmed')
                || can(state.currentUser, 'notif_diet_change')) && (
                <Popover open={isNotificationsOpen} onOpenChange={(open) => { setIsNotificationsOpen(open); if (open) actions.handleOpenNotifications(); }}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative w-10 h-10 sm:w-9 sm:h-9 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 active:bg-slate-200">
                      <Bell className="w-5 h-5 sm:w-4 sm:h-4" />
                      {state.bellNotifications.filter(n => !n.isRead).length > 0 && (
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
                      notifications={state.bellNotifications}
                      onNotificationClick={(n) => {
                        // Pasamos la notif completa para que mark-by-event pueda linkear
                        // la notif local (NOTIF-*) con su contrapartida SP por ticketId+type.
                        actions.handleMarkNotificationRead(n);
                        setIsNotificationsOpen(false);
                      }}
                      onMarkAllAsRead={actions.handleMarkAllNotificationsRead}
                      onClose={() => setIsNotificationsOpen(false)}
                    />
                  </PopoverContent>
                </Popover>
              )}
              {hasAzafataAccess && (
                <span className="h-10 sm:h-8 text-xs sm:text-[10px] font-black uppercase tracking-wider px-2 sm:px-2 rounded-xl border border-zinc-200 bg-zinc-50 shadow-sm flex items-center">
                  SECTORES: {state.currentUser.assignedAreas?.length || 0}
                </span>
              )}
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-bold text-slate-900 leading-none">{state.currentUser.name}</span>
                {state.currentUser?.requiresIdentification && state.operador
                  ? <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest mt-1">Op: {state.operador}</span>
                  : <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Sede {state.currentUser.sede}</span>}
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

        {/* Banner de notificaciones desactivadas.
            Sin esto el usuario NO tiene forma de saber que está mudo: con el permiso en 'denied'
            la app nunca se suscribe y nunca vuelve a preguntar. Se midió en producción gente de
            Admisión con cientos de traslados creados y cero suscripción push. */}
        {state.notificationPermission !== 'granted' && state.notificationPermission !== 'unsupported'
          && receivesAnyNotif(state.currentUser) && (
          <div className="bg-orange-50 border-b border-orange-200 px-4 py-2 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
              <p className="text-xs font-semibold text-orange-900 truncate">
                {state.notificationPermission === 'denied'
                  ? 'Las notificaciones están bloqueadas en este navegador — no vas a recibir avisos de traslados ni de habitación limpia.'
                  : 'No tenés las notificaciones activadas — no vas a recibir avisos de traslados ni de habitación limpia.'}
              </p>
            </div>
            <button
              onClick={async () => {
                const perm = await actions.enableNotifications();
                // Con 'denied' el navegador ni siquiera muestra el prompt: hay que explicar el
                // camino manual, que es el único que existe una vez bloqueado.
                if (perm === 'denied') {
                  alert(
                    'El navegador tiene las notificaciones bloqueadas para este sitio.\n\n' +
                    'Para activarlas:\n' +
                    '1. Tocá el candado (o el ícono a la izquierda de la dirección web).\n' +
                    '2. Buscá "Notificaciones" y ponelo en "Permitir".\n' +
                    '3. Recargá la página.',
                  );
                }
              }}
              className="text-[10px] font-black uppercase tracking-widest text-orange-800 hover:text-orange-950 border border-orange-300 rounded-lg px-2 py-1 hover:bg-orange-100 transition-colors shrink-0"
            >
              Activar
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
          {/* Monitor — Admin, Admisión y Dirección (lectura) */}
          {/* `historyTickets` y no `filteredTickets`: el Monitor calcula KPIs por rango de
              fechas sobre traslados Consolidados, que el poll de 15s ya no trae (ver
              fetchAllTickets). Además así no lo afecta el buscador de Operativa. */}
          {canViewMonitor && state.currentView === 'HOME' && <DashboardView tickets={state.historyTickets} onRefresh={() => actions.fetchAllTickets(true)} refreshing={state.allTicketsLoading} onRangeChange={actions.setHistoryRange} />}
          {/* Operativa — dos solapas: Traslados y Limpiezas.
              Limpiezas dejó de ser una entrada del sidebar y vive acá. La barra de solapas va
              como HERMANA de las vistas (no las envuelve), así cada una conserva su propio
              padding de página y no se duplica. */}
          {canViewOperativa && state.currentView === 'REQUESTS' && (
            <>
              {showOperativaTabs && (
                <div className="px-4 md:px-8 pt-4 md:pt-8">
                  <div className="flex items-center gap-1 border-b border-slate-200">
                    {operativaTabDefs.map(([val, label]) => (
                      <button key={val} onClick={() => actions.setOperativaSubview(val)}
                        className={cn(
                          'px-4 py-2 text-xs font-bold uppercase tracking-wide border-b-2 -mb-px transition-colors',
                          operativaTab === val ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-400 hover:text-slate-600',
                        )}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {operativaTab === 'limpiezas' ? (
                canSeeLimpiezas && (
                  <CleaningManagementView beds={state.beds} currentUser={state.currentUser}
                    onConsolidate={(label) => actions.undoBedClean(label, 'CONSOLIDADO')} onRefresh={actions.refreshAll} />
                )
              ) : operativaTab === 'cirugias' ? (
                canSeeCirugias && (
                  <CirugiasView
                    cirugias={Array.from(state.cirugias.values())}
                    beds={state.beds}
                    currentUser={state.currentUser}
                    onVanABuscar={actions.cirugiaVanABuscar}
                    onEnTraslado={actions.cirugiaEnTraslado}
                    onEnCirugia={actions.cirugiaEnCirugia}
                    onEnDevolucion={actions.cirugiaEnDevolucion}
                    onRecibida={actions.cirugiaRecibida}
                    onTolerancia={can(state.currentUser, 'cirugia_tolerancia') ? actions.cirugiaTolerancia : undefined}
                    onCancelar={actions.cancelarCirugia}
                    onRefresh={actions.refreshAll}
                  />
                )
              ) : (
                canSeeTraslados && (
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
                onAddObservation={actions.handleAddObservation}
                currentUser={state.currentUser}
                beds={state.beds}
              />
                )
              )}
            </>
          )}
          {/* Historial — gateado por Acceso_RT */}
          {canViewHistorial && state.currentView === 'HISTORY' && <HistoryView tickets={state.historyTickets} onRefresh={() => actions.fetchAllTickets(true)} refreshing={state.allTicketsLoading} onRangeChange={actions.setHistoryRange} onFetchPatientTickets={actions.fetchPatientTickets} />}
          {/* Usuarios — gateado por permiso abm_usuarios */}
          {canSeeUsers && state.currentView === 'USERS' && <UserManagementView currentUser={state.currentUser} />}
          {/* Roles — gateado por permiso abm_roles */}
          {canSeeRoles && (state.currentView as string) === 'ROLES' && <RoleManagementView currentUser={state.currentUser} onSessionRoleUpdate={actions.refreshSessionRole} />}
          {/* Mapa de Camas — gateado por Acceso_RT */}
          {canViewBeds && state.currentView === 'BEDS' && <BedsView beds={state.beds} tickets={state.tickets} currentUser={state.currentUser} bedsLoading={state.bedsLoading} bedsError={state.bedsError} isolatedBeds={state.isolatedBeds} onEnrichBed={actions.enrichBed} onFetchPatientTickets={actions.fetchPatientTickets} onRefresh={actions.refreshAll} onMarkClean={actions.markBedClean} onUndoClean={actions.undoBedClean} onSaveMeal={actions.saveMealLoad} onClearMeal={actions.clearMealLoad} onSaveCompanion={actions.saveCompanionLoad} onClearCompanion={actions.clearCompanionLoad} onMarcarListo={can(state.currentUser, 'cirugia_listo') ? actions.marcarListoParaCirugia : undefined} onCirugiaEnTraslado={can(state.currentUser, 'cirugia_entregar') ? actions.cirugiaEnTraslado : undefined} onCirugiaRecibida={can(state.currentUser, 'cirugia_recibir') ? actions.cirugiaRecibida : undefined} onCirugiaTolerancia={can(state.currentUser, 'cirugia_tolerancia') ? actions.cirugiaTolerancia : undefined} onStartRoutineCleaning={can(state.currentUser, 'limpieza_rutina') ? actions.startRoutineCleaning : undefined} onFinishRoutineCleaning={can(state.currentUser, 'limpieza_rutina') ? actions.finishRoutineCleaning : undefined} onMarcarVaCirugia={can(state.currentUser, 'cirugia_marcar') ? actions.marcarVaCirugia : undefined} onDesmarcarVaCirugia={can(state.currentUser, 'cirugia_marcar') ? actions.desmarcarVaCirugia : undefined} />}
          {canViewComandas && state.currentView === 'COMANDAS' && <ComandasManagementView beds={state.beds} currentUser={state.currentUser} onRefresh={actions.refreshAll} onSetMealStatus={actions.setMealStatus} />}
        </main>
      </div>

      {/* Modals */}
      <NewRequestModal
        open={isNewRequestOpen}
        onOpenChange={setIsNewRequestOpen}
        onCreate={onNewRequestCreated}
        beds={state.beds}
        activeTransferOrigins={new Set(state.tickets.filter(t => t.status !== 'Consolidado' && t.status !== 'Cancelado').map(t => t.origin))}
        activeTransferDestinations={new Set(
          state.tickets
            .filter(t => t.status !== 'Consolidado' && t.status !== 'Cancelado' && t.destination)
            .map(t => t.destination as string)
        )}
      />
      <EditRequestModal
        open={!!editTicketId}
        onOpenChange={(open) => { if (!open) setEditTicketId(null); }}
        ticket={editTicketId ? (state.tickets.find(t => t.id === editTicketId) ?? null) : null}
        beds={state.beds}
        activeTransferDestinations={new Set(
          state.tickets
            .filter(t => t.id !== editTicketId && t.status !== 'Consolidado' && t.status !== 'Cancelado' && t.destination)
            .map(t => t.destination as string)
        )}
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
                  onClick={() => actions.handleMarkNotificationRead(n)}
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
                  // Una sola llamada: el handler usa el endpoint bulk y maneja errores
                  // internamente. Antes acá había forEach + call all → 2N PATCH duplicados.
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
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-fuchsia-500" /><span className="text-xs text-slate-600">Entomológico/Dengue</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-orange-500" /><span className="text-xs text-slate-600">Contacto</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-teal-500" /><span className="text-xs text-slate-600">Contacto preventivo</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-800" /><span className="text-xs text-slate-600">C. Difficile</span></div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
