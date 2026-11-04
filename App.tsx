
import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Home as HomeIcon, History, Info,
  Mail, Lock, Eye, EyeOff, User, Settings, Users
} from './components/Icons';
import { Activity, AlertCircle, ArrowRight, BedDouble, Globe, Loader2, MapPin as MapPinIcon, RefreshCw, Utensils } from 'lucide-react';
import { AppShell, type ItemNav } from './components/layout/app-shell';
import { Aviso, BloqueUsuario, EntornoDePrueba, PieSesion, SelectorTema } from './components/layout/partes-shell';
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import { StatusBadge } from './components/ui/status-badge';
import { Vacio } from './components/ui/estados';
import { fechaHora } from './lib/formato';
import { GammaLogo } from './components/GammaLogo';
import { ModuleHelp } from './components/ModuleHelp';
import { IS_TESTING } from './lib/env';
import { APP_VERSION } from './lib/version';
import { ActualizacionProvider } from './components/Actualizacion';
import { ActualizacionDialog } from './components/ActualizacionDialog';
import { CuentaRegresivaDeActualizacion } from './components/CuentaRegresiva';
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
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { AISLAMIENTOS, MARCAS_CAMA, ORDEN_ESTADOS_CAMA, estadoCama, puntoAislamiento } from './lib/estados-camas';
import { PASOS_CIRUGIA, estadoCirugia } from './lib/estados-cirugia';
import { Bell } from './components/Icons';

// Modals
import { NewRequestModal } from './components/modals/NewRequestModal';
import { PreTicketModal } from './components/modals/PreTicketModal';
import { ConfigureDestinoModal } from './components/modals/ConfigureDestinoModal';
import { ConsolidarUrgenciaModal } from './components/modals/ConsolidarUrgenciaModal';
import { EditRequestModal, EditRequestPayload } from './components/modals/EditRequestModal';
import { RestablecerDestinoModal } from './components/modals/RestablecerDestinoModal';
import { AssignBedModal } from './components/modals/AssignBedModal';
import { AreaSelectionModal } from './components/modals/AreaSelectionModal';
import { RejectionModal } from './components/modals/RejectionModal';
import { cn, calculateTicketMetrics } from './lib/utils';
import { NotificationToasts } from './components/NotificationToast';
import { appAlert } from './lib/appDialog';

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

// Botón principal de las pantallas de acceso (DESIGN §12.1): más alto que el de la app y con halo de marca.
const BOTON_ACCESO = [
  // sumar-validar-ignorar: cuerpo-text-base botón grande del login (receta DESIGN §12.1)
  "h-12 w-full text-base font-semibold",
  // sumar-validar-ignorar: sombras-pesadas halo de marca del botón del login (receta DESIGN §12.1)
  "shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]",
].join(" ");

// Pantalla de acceso (DESIGN §12.1, split-screen): a la izquierda el panel de marca (solo desktop), a la
// derecha el formulario. La usan el login y el gate de cuentas compartidas.
const PantallaAcceso: React.FC<{ titulo: string; bajada: string; children: React.ReactNode }> = ({ titulo, bajada, children }) => (
  <div className="flex min-h-dvh w-full flex-col bg-background animate-in fade-in duration-500 md:flex-row">
    {/* Panel de marca (verde Gamma) */}
    <div className="panel-marca relative hidden w-1/2 flex-col justify-between overflow-hidden p-12 md:flex lg:w-3/5">
      <GammaLogo size={520} className="pointer-events-none absolute -right-32 -bottom-40 opacity-[0.07]" />
      <div className="relative flex items-center gap-3">
        <GammaLogo size={40} />
        <span className="text-xl font-bold tracking-tight">Gamma</span>
      </div>
      <div className="relative">
        <h1 className="mb-6 text-4xl leading-tight font-extrabold tracking-tight lg:text-6xl">Gestión de Traslados</h1>
        <p className="max-w-md border-l-2 border-sidebar-foreground/30 pl-4 text-lg text-sidebar-foreground/80">
          Solicitud, cama, limpieza, traslado y consolidación, en un solo lugar.
        </p>
      </div>
      <p className="relative text-xs font-medium tracking-wide text-sidebar-foreground/60 uppercase">Grupo Gamma · Red de Salud</p>
    </div>
    {/* Formulario */}
    <div className="relative flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <GammaLogo size={56} className="mb-6 text-brand md:hidden" />
        <h2 className="text-3xl font-bold tracking-tight text-primary">{titulo}</h2>
        <p className="mb-6 text-sm text-muted-foreground">{bajada}</p>
        {children}
      </div>
    </div>
  </div>
);

// Label e input del login (§12.1): micro-etiqueta y campo h-12 sobre bg-secondary/30.
const LABEL_ACCESO = 'ml-1 mb-1.5 block text-xs font-semibold tracking-wider text-muted-foreground uppercase';
const INPUT_ACCESO = 'h-12 border-border bg-secondary/30 transition-all focus:border-primary focus:bg-background';

// Gate de identificación para CUENTAS COMPARTIDAS: cuando el rol lo exige y no hay operador de
// sesión, se bloquea la app con "¿Quién sos?" (mismo layout que el login). El nombre (texto libre)
// queda como responsable de las transacciones hasta el "cambio de turno".
const IdentificationGate: React.FC<{
  accountName: string;
  onConfirm: (name: string) => void;
  onLogout: () => void;
}> = ({ accountName, onConfirm, onLogout }) => {
  const [name, setName] = useState('');
  const submit = (e: React.FormEvent) => { e.preventDefault(); const n = name.trim(); if (n) onConfirm(n); };
  return (
    <PantallaAcceso titulo="¿Quién sos?" bajada="Identificate para registrar tus operaciones.">
      <div className="mb-6 flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"><User className="size-4" /></div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Cuenta compartida</p>
          <p className="truncate text-sm font-medium">{accountName}</p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="operador" className={LABEL_ACCESO}>Tu nombre</label>
          <Input id="operador" autoFocus type="text" placeholder="Nombre y apellido" value={name} onChange={e => setName(e.target.value)} className={INPUT_ACCESO} />
          <p className="mt-1.5 ml-1 text-xs text-muted-foreground">Todas tus operaciones van a quedar registradas a tu nombre hasta el cambio de turno.</p>
        </div>
        <Button type="submit" disabled={!name.trim()} className={BOTON_ACCESO}>
          Continuar <ArrowRight className="ml-1 size-4" />
        </Button>
      </form>
      <Button type="button" variant="ghost" onClick={onLogout} className="mt-3 w-full text-muted-foreground">Cerrar sesión</Button>
    </PantallaAcceso>
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
    // Sin urgencias: su "ciclo" es hasta que Admisión las vincula, no un traslado (ver DashboardView.computeStats).
    const completed = state.historyTickets.filter(t => t.status === TicketStatus.COMPLETED && t.createdAt && t.completedAt && !t.urgencia);
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
  const [isPreTicketOpen, setIsPreTicketOpen] = useState(false);
  const [configureDestinoId, setConfigureDestinoId] = useState<string | null>(null);
  const [consolidarUrgenciaId, setConsolidarUrgenciaId] = useState<string | null>(null);
  const [isAssignBedOpen, setIsAssignBedOpen] = useState(false);
  const [isAreaSelectionOpen, setIsAreaSelectionOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isUnreadModalOpen, setIsUnreadModalOpen] = useState(false);
  const [rejectTicketId, setRejectTicketId] = useState<string | null>(null);
  const [editTicketId, setEditTicketId] = useState<string | null>(null);
  const [resetDestinoId, setResetDestinoId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isLegendModalOpen, setIsLegendModalOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
  // "Ya se operó (fuera de MediFlow)": permiso propio del ABM (cirugia_previa; Coordinación, pedido de Gamma).
  const canCirugiaPrevia = can(state.currentUser, 'cirugia_previa');
  // "Volver un paso" pide el permiso del paso que se deshace: sin ninguno, ni se monta el bloque de cirugía del
  // mapa (si no, Catering/Nutrición veían la pill y los textos de la operatoria).
  const canCirugiaRetroceder = (['cirugia_buscar', 'cirugia_entregar', 'cirugia_operar', 'cirugia_devolver', 'cirugia_volver_listo'] as const).some(p => can(state.currentUser, p));

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
      <PantallaAcceso titulo="Bienvenido" bajada="Ingresá con tu usuario de MediFlow.">
        <form onSubmit={actions.handleLogin} className="space-y-4">
          {/* Banner de error (§6.2) */}
          {state.loginError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /> {state.loginError}
            </div>
          )}
          <div>
            <label htmlFor="login-usuario" className={LABEL_ACCESO}>Usuario o correo electrónico</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="login-usuario"
                type="text"
                autoComplete="username"
                placeholder="azafatap5 o correo@grupogamma.com"
                value={state.loginEmail}
                onChange={e => actions.setLoginEmail(e.target.value)}
                aria-invalid={!!state.loginError || undefined}
                className={cn(INPUT_ACCESO, 'pl-10')}
              />
            </div>
          </div>
          <div>
            <label htmlFor="login-clave" className={LABEL_ACCESO}>Contraseña</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="login-clave"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={state.loginPass}
                onChange={e => actions.setLoginPass(e.target.value)}
                aria-invalid={!!state.loginError || undefined}
                className={cn(INPUT_ACCESO, 'pr-11 pl-10')}
              />
              {/* Mostrar / ocultar (§6.8) */}
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <Button
            type="submit"
            disabled={state.loginLoading}
            className={cn("mt-2", BOTON_ACCESO)}
          >
            {state.loginLoading ? <><Loader2 className="size-4 animate-spin" /> Verificando…</> : <>Ingresar <ArrowRight className="ml-1 size-4" /></>}
          </Button>
        </form>

        <p className="mt-6 text-center font-mono text-xs tracking-wide text-muted-foreground/70 select-all" title="Versión del cliente">{APP_VERSION}</p>

        {/* Zócalo de debug — IP que ve el server + geo del browser. Útil para que
            el usuario nos mande captura si le rebota la validación de ubicación. */}
        <div className="mt-6 flex items-stretch gap-2 border-t pt-4">
          {[
            { icono: Globe, label: 'IP de conexión', valor: clientIp ?? '—' },
            { icono: MapPinIcon, label: 'Ubicación (lat / lng)', valor: clientGeo ? `${clientGeo.lat.toFixed(3)} / ${clientGeo.lng.toFixed(3)}` : geoError ?? '—' },
          ].map(({ icono: Icono, label, valor }) => (
            <div key={label} className="min-w-0 flex-1 rounded-lg border bg-muted/20 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                <Icono className="size-3" /> {label}
              </div>
              <div className="mt-0.5 truncate text-xs font-medium tabular-nums">{valor}</div>
            </div>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="outline" size="icon" onClick={refreshDebugInfo} disabled={loadingDebug} aria-label="Reintentar IP y ubicación" className="h-auto shrink-0">
                <RefreshCw className={cn('size-4', loadingDebug && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reintentar</TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-6 flex flex-col items-center gap-2 text-center">
          {IS_TESTING && <EntornoDePrueba />}
          <p className="text-xs text-muted-foreground">Grupo Gamma · Red de Salud</p>
        </div>
      </PantallaAcceso>
    );
  }

  // Cuenta compartida: si el rol requiere identificación y aún no hay operador de sesión, se
  // bloquea con el gate "¿Quién sos?". El "cambio de turno" limpia el operador → reaparece.
  if (state.currentUser?.requiresIdentification && !state.operador) {
    return <IdentificationGate accountName={state.currentUser.name} onConfirm={actions.setOperador} onLogout={actions.handleLogout} />;
  }

  // ── Shell (rediseño, capa 2): AppShell del Estilo 1, sin router ────────────
  // Configuración se arma con permisos finos; Operativa es una sola entrada aunque la vean
  // roles con o sin filtro de pisos.
  const nav = ([
    canViewMonitor && { id: 'HOME', label: 'Monitor', icon: HomeIcon },
    canViewOperativa && { id: 'REQUESTS', label: 'Operativa', icon: LayoutDashboard },
    canViewHistorial && { id: 'HISTORY', label: 'Historial', icon: History },
    canViewBeds && { id: 'BEDS', label: 'Mapa de Camas', icon: BedDouble },
    canViewComandas && { id: 'COMANDAS', label: 'Comandas', icon: Utensils },
    // Configuración va siempre abajo, anclada al pie de la sidebar (DESIGN §8.5).
    canSeeUsers && { id: 'USERS', label: 'Usuarios', icon: Users, grupo: 'Configuración', abajo: true },
    canSeeRoles && { id: 'ROLES', label: 'Roles', icon: Settings, grupo: 'Configuración', abajo: true },
  ].filter(Boolean)) as ItemNav[];

  const tituloVista =
    state.currentView === 'HOME' ? 'Monitor'
    : state.currentView === 'REQUESTS' ? (operativaTab === 'limpiezas' ? 'Operativa · Limpiezas' : operativaTab === 'cirugias' ? 'Operativa · Cirugías' : 'Operativa')
    : state.currentView === 'BEDS' ? 'Mapa de Camas'
    : state.currentView === 'COMANDAS' ? 'Gestión de Comandas'
    : state.currentView === 'USERS' ? 'Usuarios'
    : (state.currentView as string) === 'ROLES' ? 'Roles'
    : 'Historial';

  const ayudaModulo = (
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
  );

  // Header desktop: breadcrumb "Sede / Vista" (DESIGN §8.6). El título grande vive en la página.
  const ubicacion = (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <span className="truncate text-muted-foreground">Sede {state.currentUser.sede}</span>
        <span className="text-muted-foreground/50" aria-hidden="true">/</span>
        <span className="truncate">{tituloVista}</span>
      </span>
      {ayudaModulo}
      {IS_TESTING && <EntornoDePrueba />}
    </div>
  );

  // Header mobile: el nombre del módulo (DESIGN §5.10).
  const tituloMobile = (
    <div className="flex min-w-0 items-center gap-1.5">
      <h1 className="truncate text-lg font-bold">{tituloVista}</h1>
      {ayudaModulo}
      {IS_TESTING && <EntornoDePrueba />}
    </div>
  );

  const marca = (
    <div className="flex min-w-0 items-center gap-2.5">
      <GammaLogo size={22} className="shrink-0 text-sidebar-primary" />
      <div className="min-w-0 leading-tight">
        <div className="titulo truncate">Gamma</div>
        <div className="truncate text-xs text-sidebar-foreground/70" title={`Sede ${state.currentUser.sede}`}>Sede {state.currentUser.sede}</div>
      </div>
    </div>
  );

  const pieSesion = (compacto: boolean) => (
    <PieSesion
      compacto={compacto}
      operador={state.operador}
      sincronizando={syncingRoles}
      onActualizarAccesos={handleSyncRoles}
      onCambioTurno={state.currentUser?.requiresIdentification ? actions.cambioTurno : undefined}
      onInstalar={installPrompt && /android/i.test(navigator.userAgent) ? handleInstallApp : undefined}
      onSalir={actions.handleLogout}
    />
  );

  const noLeidas = state.bellNotifications.filter(n => !n.isRead).length;
  const acciones = (
    <>
      <CuentaRegresivaDeActualizacion />
      {state.currentView === 'BEDS' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" onClick={() => setIsLegendModalOpen(true)} aria-label="Referencias del mapa">
              <Info className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Referencias del mapa</TooltipContent>
        </Tooltip>
      )}
      {(can(state.currentUser, 'notif_new_ticket')
        || can(state.currentUser, 'notif_status_update')
        || can(state.currentUser, 'notif_reception_confirmed')
        || can(state.currentUser, 'notif_diet_change')) && (
        <Popover open={isNotificationsOpen} onOpenChange={(open) => { setIsNotificationsOpen(open); if (open) actions.handleOpenNotifications(); }}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="relative text-muted-foreground" aria-label={noLeidas ? `Notificaciones (${noLeidas} sin leer)` : 'Notificaciones'}>
              <Bell className="size-5" />
              {noLeidas > 0 && <span className="absolute top-2 right-2 size-2.5 rounded-full bg-destructive ring-2 ring-background" aria-hidden="true" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[calc(100vw-1.5rem)] overflow-hidden p-0 sm:w-[380px]">
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
      <SelectorTema />
      {hasAzafataAccess && (
        <span className="micro flex h-8 items-center rounded-md border bg-muted/50 px-2 tabular-nums">
          Sectores: {state.currentUser.assignedAreas?.length || 0}
        </span>
      )}
      <BloqueUsuario
        nombre={state.currentUser.name}
        detalle={state.currentUser?.requiresIdentification && state.operador ? `Op: ${state.operador}` : `Sede ${state.currentUser.sede}`}
      />
    </>
  );

  const avisos = (
    <>
      {state.unreadSpNotifications?.length > 0 && (
        <Aviso
          tono="peligro"
          accion={<Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setIsUnreadModalOpen(true)}>Ver pendientes</Button>}
        >
          Tenés <span className="font-semibold">{state.unreadSpNotifications.length}</span> notificación{state.unreadSpNotifications.length > 1 ? 'es' : ''} sin confirmar hace más de 20 minutos
        </Aviso>
      )}
      {/* Notificaciones desactivadas. Sin esto el usuario NO tiene forma de saber que está mudo: con
          el permiso en 'denied' la app nunca se suscribe y nunca vuelve a preguntar. Se midió en
          producción gente de Admisión con cientos de traslados creados y cero suscripción push. */}
      {state.notificationPermission !== 'granted' && state.notificationPermission !== 'unsupported'
        && receivesAnyNotif(state.currentUser) && (
        <Aviso
          tono="aviso"
          accion={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={async () => {
                const perm = await actions.enableNotifications();
                // Con 'denied' el navegador ni siquiera muestra el prompt: hay que explicar el
                // camino manual, que es el único que existe una vez bloqueado.
                if (perm === 'denied') {
                  appAlert(
                    'El navegador tiene las notificaciones bloqueadas para este sitio.\n\n' +
                    'Para activarlas:\n' +
                    '1. Tocá el candado (o el ícono a la izquierda de la dirección web).\n' +
                    '2. Buscá "Notificaciones" y ponelo en "Permitir".\n' +
                    '3. Recargá la página.',
                    { tone: 'warning', title: 'Notificaciones bloqueadas' },
                  );
                }
              }}
            >
              Activar
            </Button>
          }
        >
          {state.notificationPermission === 'denied'
            ? 'Las notificaciones están bloqueadas en este navegador — no vas a recibir avisos de traslados ni de habitación limpia.'
            : 'No tenés las notificaciones activadas — no vas a recibir avisos de traslados ni de habitación limpia.'}
        </Aviso>
      )}
      {state.tokenExpirySoon && (
        <Aviso
          tono="aviso"
          accion={<Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={actions.handleLogout}>Renovar sesión</Button>}
        >
          Tu sesión vence en <span className="font-semibold tabular-nums">{state.tokenMinutesLeft} min</span>. Guardá tu trabajo y volvé a ingresar.
        </Aviso>
      )}
    </>
  );

  return (
    <ActualizacionProvider retenida={state.ticketActionLoading}>
    <AppShell
      nav={nav}
      activo={state.currentView as string}
      onNavegar={(id) => actions.setCurrentView(id as any)}
      marca={marca}
      marcaCompacta={<GammaLogo size={24} className="text-sidebar-primary" />}
      usuario={pieSesion(false)}
      usuarioCompacto={pieSesion(true)}
      ubicacion={ubicacion}
      tituloMobile={tituloMobile}
      acciones={acciones}
      avisos={avisos}
      relleno={false}
    >
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

      {/* Guardando: bloquea la pantalla mientras se escribe en el sistema */}
      {state.ticketActionLoading && (
        <div className="fixed inset-0 z-overlay grid place-items-center bg-background/60 backdrop-blur-xs" role="status" aria-live="polite">
          <div className="flotante flex flex-col items-center gap-3 px-8 py-6">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">Guardando en sistema…</span>
          </div>
        </div>
      )}

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
              {/* Tab bar de Operativa (DESIGN §8.7): subrayado de marca; las vistas van abajo con su padding lateral. */}
              {showOperativaTabs ? (
                <Tabs value={operativaTab} onValueChange={(v) => actions.setOperativaSubview(v as typeof operativaTab)} className="mb-4 px-3 pt-3 md:mb-6 md:px-8 md:pt-6">
                  <TabsList variant="line" className="w-full justify-start">
                    {operativaTabDefs.map(([val, label]) => (
                      <TabsTrigger key={val} value={val}>{label}</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : (
                <div className="pt-3 md:pt-8" />
              )}
              {operativaTab === 'limpiezas' ? (
                canSeeLimpiezas && (
                  <CleaningManagementView beds={state.beds} currentUser={state.currentUser}
                    onConsolidate={(label) => actions.undoBedClean(label, 'CONSOLIDADO')} onRefresh={actions.refreshAll}
                    onCancelRutina={can(state.currentUser, 'limpieza_rutina_cancelar') ? actions.cancelarRutina : undefined}
                    onCancelLimpieza={can(state.currentUser, 'limpieza_rutina_cancelar') ? actions.cancelarLimpieza : undefined} />
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
                    onTolerancia={can(state.currentUser, 'cirugia_tolerancia') ? actions.cirugiaTolerancia : undefined}
                    onCancelar={actions.cancelarCirugia}
                    onRetroceder={actions.cirugiaRetroceder}
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
                onNewPreTicket={() => setIsPreTicketOpen(true)}
                onConfigureDestino={(id) => setConfigureDestinoId(id)}
                onValidateReason={actions.handleValidateTicket}
                onAssignBed={handleOpenAssignBed}
                onHousekeepingAction={actions.handleHousekeepingAction}
                onStartTransport={actions.handleStartTransport}
                onCompleteTransport={actions.handleCompleteTransport}
                onRoomReady={actions.handleRoomReady}
                onConfirmReception={actions.handleConfirmReception}
                onConsolidate={actions.handleConsolidate}
                onConsolidateUrgencia={(id) => setConsolidarUrgenciaId(id)}
                onReject={(id) => { setRejectTicketId(id); setIsRejectOpen(true); }}
                onEdit={(id) => setEditTicketId(id)}
                onResetDestino={can(state.currentUser, 'completar_pre_ticket') ? (id) => setResetDestinoId(id) : undefined}
                onAddObservation={actions.handleAddObservation}
                currentUser={state.currentUser}
                beds={state.beds}
                orphanTickets={state.orphanTickets}
                ticketsLoaded={state.ticketsLoaded}
                ticketsError={state.ticketsError}
              />
                )
              )}
            </>
          )}
          {/* Historial — gateado por Acceso_RT */}
          {canViewHistorial && state.currentView === 'HISTORY' && <HistoryView tickets={state.historyTickets} onRefresh={() => actions.fetchAllTickets(true)} refreshing={state.allTicketsLoading} onRangeChange={actions.setHistoryRange} onFetchPatientTickets={actions.fetchPatientTickets} onSearchHistory={actions.searchHistory} beds={state.bedsError ? undefined : state.rawBeds} />}
          {/* Usuarios — gateado por permiso abm_usuarios */}
          {canSeeUsers && state.currentView === 'USERS' && <UserManagementView currentUser={state.currentUser} />}
          {/* Roles — gateado por permiso abm_roles */}
          {canSeeRoles && (state.currentView as string) === 'ROLES' && <RoleManagementView currentUser={state.currentUser} onSessionRoleUpdate={actions.refreshSessionRole} />}
          {/* Mapa de Camas — gateado por Acceso_RT */}
          {canViewBeds && state.currentView === 'BEDS' && <BedsView beds={state.beds} tickets={state.tickets} currentUser={state.currentUser} bedsLoading={state.bedsLoading} bedsError={state.bedsError} isolatedBeds={state.isolatedBeds} onEnrichBed={actions.enrichBed} onFetchPatientTickets={actions.fetchPatientTickets} onRefresh={actions.refreshAll} onMarkClean={actions.markBedClean} onUndoClean={actions.undoBedClean} onRevertirLimpieza={can(state.currentUser, 'limpieza_revertir') ? actions.revertirLimpieza : undefined} onSaveMeal={actions.saveMealLoad} onClearMeal={actions.clearMealLoad} onSaveCompanion={actions.saveCompanionLoad} onClearCompanion={actions.clearCompanionLoad} onMarcarListo={can(state.currentUser, 'cirugia_listo') ? actions.marcarListoParaCirugia : undefined} onCirugiaEnTraslado={can(state.currentUser, 'cirugia_entregar') ? actions.cirugiaEnTraslado : undefined} onCirugiaTolerancia={can(state.currentUser, 'cirugia_tolerancia') ? actions.cirugiaTolerancia : undefined} onCirugiaRetroceder={canCirugiaRetroceder ? actions.cirugiaRetroceder : undefined} onCirugiaPrevia={canCirugiaPrevia ? actions.registrarCirugiaPrevia : undefined} onAnularCirugiaPrevia={canCirugiaPrevia ? actions.anularCirugiaPrevia : undefined} onStartRoutineCleaning={can(state.currentUser, 'limpieza_rutina') ? actions.startRoutineCleaning : undefined} onFinishRoutineCleaning={can(state.currentUser, 'limpieza_rutina') ? actions.finishRoutineCleaning : undefined} onMarcarVaCirugia={can(state.currentUser, 'cirugia_marcar') ? actions.marcarVaCirugia : undefined} onDesmarcarVaCirugia={can(state.currentUser, 'cirugia_marcar') ? actions.desmarcarVaCirugia : undefined} />}
          {canViewComandas && state.currentView === 'COMANDAS' && <ComandasManagementView beds={state.beds} currentUser={state.currentUser} onRefresh={actions.refreshAll} onSetMealStatus={actions.setMealStatus} />}

      {/* Modals */}
      <NewRequestModal
        open={isNewRequestOpen}
        onOpenChange={setIsNewRequestOpen}
        onCreate={onNewRequestCreated}
        beds={state.beds}
        activeTicketByOrigin={state.activeTicketByOrigin}
        activeTransferDestinations={new Set(
          state.tickets
            .filter(t => t.status !== 'Consolidado' && t.status !== 'Cancelado' && t.destination)
            .map(t => t.destination as string)
        )}
      />
      <PreTicketModal
        open={isPreTicketOpen}
        onOpenChange={setIsPreTicketOpen}
        onCreate={actions.createPreTicket}
        beds={state.beds}
        assignedAreas={state.currentUser?.filterByFloors ? state.currentUser.assignedAreas : undefined}
        activeTicketByOrigin={state.activeTicketByOrigin}
        activeTransferDestinations={new Set(
          state.tickets
            .filter(t => t.status !== 'Consolidado' && t.status !== 'Cancelado' && t.destination)
            .map(t => t.destination as string)
        )}
      />
      <ConsolidarUrgenciaModal
        open={!!consolidarUrgenciaId}
        onOpenChange={(open) => { if (!open) setConsolidarUrgenciaId(null); }}
        ticket={consolidarUrgenciaId ? (state.tickets.find(t => t.id === consolidarUrgenciaId) ?? null) : null}
        beds={state.beds}
        onConfirm={(id, link) => actions.handleConsolidate(id, link)}
      />
      <ConfigureDestinoModal
        open={!!configureDestinoId}
        onOpenChange={(open) => { if (!open) setConfigureDestinoId(null); }}
        ticket={configureDestinoId ? (state.tickets.find(t => t.id === configureDestinoId) ?? null) : null}
        beds={state.beds}
        activeTransferDestinations={new Set(
          state.tickets
            .filter(t => t.status !== 'Consolidado' && t.status !== 'Cancelado' && t.destination)
            .map(t => t.destination as string)
        )}
        onConfirm={actions.completePreTicket}
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
        onResetDestino={can(state.currentUser, 'completar_pre_ticket') ? actions.restablecerDestinoPreTicket : undefined}
      />
      <RestablecerDestinoModal
        open={!!resetDestinoId}
        onOpenChange={(open) => { if (!open) setResetDestinoId(null); }}
        ticket={resetDestinoId ? (state.tickets.find(t => t.id === resetDestinoId) ?? null) : null}
        onConfirm={actions.restablecerDestinoPreTicket}
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
        <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-[500px]">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <Bell className="size-4 text-destructive" aria-hidden="true" />
              Notificaciones pendientes
              <StatusBadge tono="peligro">{state.unreadSpNotifications?.length || 0}</StatusBadge>
            </DialogTitle>
            <DialogDescription>Sin confirmar hace más de 20 minutos.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-6">
            {(state.unreadSpNotifications ?? []).map((n: any) => (
              <div key={n.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{n.fecha ? fechaHora(n.fecha) : ''}</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => actions.handleMarkNotificationRead(n)}>
                  Leída
                </Button>
              </div>
            ))}
            {(state.unreadSpNotifications ?? []).length === 0 && (
              <Vacio icono={Bell} titulo="Sin notificaciones pendientes" />
            )}
          </div>
          {(state.unreadSpNotifications ?? []).length > 0 && (
            <DialogFooter className="shrink-0 border-t bg-muted/20 p-4">
              <Button type="button" variant="outline" onClick={() => setIsUnreadModalOpen(false)}>
                Cerrar
              </Button>
              <Button
                type="button"
                onClick={() => {
                  // Una sola llamada: el handler usa el endpoint bulk y maneja errores
                  // internamente. Antes acá había forEach + call all → 2N PATCH duplicados.
                  actions.handleMarkAllNotificationsRead();
                  setIsUnreadModalOpen(false);
                }}
              >
                Marcar todas como leídas
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isLegendModalOpen} onOpenChange={setIsLegendModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Estado de Camas</DialogTitle>
            <DialogDescription>Qué significa cada color del mapa.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ul className="space-y-2.5">
              {ORDEN_ESTADOS_CAMA.map((estado) => {
                const info = estadoCama(estado);
                return (
                  <li key={estado} className="flex items-center gap-3">
                    <span className="w-28 shrink-0"><StatusBadge tono={info.tono}>{info.label}</StatusBadge></span>
                    <span className="text-sm text-muted-foreground">{info.descripcion}</span>
                  </li>
                );
              })}
            </ul>
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Aislamientos</p>
              <ul className="grid grid-cols-2 gap-1.5">
                {AISLAMIENTOS.map((a) => (
                  <li key={a.nombre} className="flex items-center gap-2 text-xs">
                    <span className={cn("size-2.5 shrink-0 rounded-full", puntoAislamiento(a.color))} aria-hidden />
                    <span>{a.nombre}{a.sigla && <span className="text-muted-foreground"> ({a.sigla})</span>}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* Marcas de la celda: en el mapa van solo con ícono (celda compacta); acá, qué es cada una. */}
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Marcas en la cama</p>
              <ul className="space-y-1.5">
                {Object.entries(MARCAS_CAMA).map(([clave, m]) => (
                  <li key={clave} className="flex items-center gap-3 text-xs">
                    <span className="flex w-12 shrink-0 justify-center">
                      <StatusBadge tono={m.tono} className={cn('h-4 gap-0.5 px-1 py-0', clave === 'vaCirugia' && 'border border-dashed border-violet-400')}>
                        {clave === 'vaCirugia' || clave === 'quirurgico' ? m.label : <m.icono className="size-3" />}
                      </StatusBadge>
                    </span>
                    <span className="text-muted-foreground">{m.descripcion}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Cirugía (Cx)</p>
              <ul className="grid grid-cols-2 gap-1.5">
                {PASOS_CIRUGIA.map((paso) => {
                  const cx = estadoCirugia(paso);
                  return (
                    <li key={paso} className="flex items-center gap-2 text-xs">
                      <StatusBadge tono={cx.tono} className="h-4 gap-0.5 px-1 py-0"><Activity className="size-3" aria-hidden="true" />Cx</StatusBadge>
                      <span>{cx.titulo}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </AppShell>
    <ActualizacionDialog />
    </ActualizacionProvider>
  );
}
