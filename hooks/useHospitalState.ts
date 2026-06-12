
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  WorkflowType, Role, SedeType, Ticket, TicketStatus, User, Area,
  Notification, NotificationType, ViewMode, SortConfig, Bed, BedStatus, IsolationType,
  RoleModule,
} from '../types';
import { MOCK_TICKETS } from '../lib/constants';
import { can, hasModule, canReceiveNotif } from '../lib/permissions';
import { effectiveHostessAreas, formatDateTime } from '../lib/utils';

// ── JWT helpers (client-side, solo lectura — sin verificar firma) ─────────────
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch { return null; }
}

function getTokenMinutesLeft(token: string | null): number {
  if (!token) return 0;
  const payload = parseJwtPayload(token);
  if (!payload?.exp) return 0;
  return Math.floor(((payload.exp as number) * 1000 - Date.now()) / 60_000);
}

// ── Notification sound (Web Audio API — soft, clean chime) ───────────────────
function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    // Resume if browser suspended it (autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;

    // Two layered soft tones for a warm "ding-ding" feel
    const notes = [
      { freq: 784, start: 0,    dur: 0.25 },  // G5
      { freq: 1047, start: 0.12, dur: 0.3  },  // C6
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = note.freq;
      osc.connect(gain);
      gain.connect(ctx.destination);

      // Soft attack + smooth fade out (no harsh start/stop)
      gain.gain.setValueAtTime(0, t + note.start);
      gain.gain.linearRampToValueAtTime(0.15, t + note.start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + note.start + note.dur);

      osc.start(t + note.start);
      osc.stop(t + note.start + note.dur);
    }

    // Close context after all notes finish
    setTimeout(() => ctx.close(), 500);
  } catch { /* silent — AudioContext may be blocked */ }
}

// ── Bed merge ─────────────────────────────────────────────────────────────────
// Lista canónica de campos del paciente. IDENTITY = identifica al paciente actual
// (patientName/Code, eventOrigin/Number). ENRICH = datos del evento que vienen del
// cache de SP (diagnóstico, dieta, ayunos, plan, fechas, DNI/edad/sexo).
// Cualquier campo nuevo de enrich a futuro se agrega solo acá → clear/copy/snapshot
// quedan sincronizados sin tocar tres lugares.
const IDENTITY_FIELDS = ['patientName', 'patientCode', 'eventOrigin', 'eventNumber'] as const;
const ENRICH_FIELDS = [
  'institution', 'attendingPhysician',
  'dni', 'age', 'sex',
  'diagnosis', 'prescribingPhysician',
  'admissionType', 'admissionTypeCode', 'admissionDate', 'expectedSurgeryDate', 'authorizedDays',
  'medicalPlan', 'medicalPlanCode', 'medicalPlanDescription',
  'diets', 'dietTags', 'fasting',
  'enriched',
] as const;
type EnrichField = typeof ENRICH_FIELDS[number];
type PatientEnrichSnapshot = Pick<Bed, EnrichField>;

// Limpia TODOS los campos asociados a un paciente (identidad + enrich). Sin esto,
// tras un movimiento (ej. WAITING_CONSOLIDATION) la cama origen queda con
// fasting/dieta/diagnóstico/DNI "fantasma" del paciente que ya se fue.
function clearPatientFromBed(b: Bed): void {
  const r = b as unknown as Record<string, unknown>;
  for (const f of IDENTITY_FIELDS) r[f] = undefined;
  for (const f of ENRICH_FIELDS)   r[f] = undefined;
  b.enriched = false;
}

// Copia paciente + TODO el enrich de un bed a otro. Necesario para que la cama
// destino en WAITING_CONSOLIDATION muestre el enrich completo (modal abre con datos
// al instante, sin esperar al próximo poll de /api/beds).
function copyPatientToBed(from: Bed, to: Bed): void {
  const src = from as unknown as Record<string, unknown>;
  const dst = to   as unknown as Record<string, unknown>;
  for (const f of IDENTITY_FIELDS) dst[f] = src[f];
  for (const f of ENRICH_FIELDS)   dst[f] = src[f];
}

// Extrae el snapshot de enrich de un bed (sin la identidad — patientCode es la llave
// del mapa). Se usa al recibir un bed con `enriched===true` del server para guardar
// "lo que el paciente trae consigo" e ir aplicándolo donde el paciente esté.
function extractEnrichSnapshot(bed: Bed): PatientEnrichSnapshot {
  const src = bed as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of ENRICH_FIELDS) out[f] = src[f];
  return out as PatientEnrichSnapshot;
}

// Para cada bed con patientCode, si tenemos un snapshot guardado para ese paciente,
// sobreescribir TODOS los campos del enrich con los del snapshot. Esto garantiza que
// la pill (y demás campos) sigan al paciente aunque el server no haya actualizado
// el enrich todavía en su nueva cama (cron-enrich-beds corre cada 15 min). Beds sin
// patientCode o no presentes en el mapa quedan intactos.
function reapplyEnrichFromMap(beds: Bed[], map: Map<string, PatientEnrichSnapshot>): Bed[] {
  for (const bed of beds) {
    if (!bed.patientCode) continue;
    const snap = map.get(bed.patientCode);
    if (!snap) continue;
    Object.assign(bed, snap);
  }
  return beds;
}

// Mantiene al paciente en la cama ORIGEN mientras el traslado NO arrancó (WAITING_ROOM /
// IN_TRANSIT). En Piso→Piso Gamma sigue reportando al paciente en el origen, así que esto no
// hace nada (la cama ya tiene patientName). Pero en Sala de Espera (HRA) Gamma libera el sillón
// apenas se asigna la cama destino → sin esto el paciente "desaparece" del mapa antes de
// moverse. Lo re-pintamos desde el ticket; reapplyEnrichFromMap luego restaura su dieta/ayuno
// por patientCode si hay snapshot. No tocamos camas inhabilitadas.
function keepPatientOnOrigin(origin: Bed | undefined, ticket: Ticket): void {
  if (!origin || origin.patientName || origin.status === BedStatus.DISABLED) return;
  origin.patientName = ticket.patientName;
  origin.patientCode = ticket.patientCode;
  origin.status = BedStatus.OCCUPIED;
}

function mergeBeds(gammaBeds: Bed[], activeTickets: Ticket[]): Bed[] {
  const result = gammaBeds.map(b => ({ ...b }));
  for (const ticket of activeTickets) {
    const origin = result.find(b => b.label === ticket.origin);
    const dest   = ticket.destination ? result.find(b => b.label === ticket.destination) : null;
    switch (ticket.status) {
      case TicketStatus.WAITING_ROOM:
        keepPatientOnOrigin(origin, ticket); // el paciente no se movió aún → sigue en el origen
        if (dest) dest.status = BedStatus.PREPARATION;
        break;
      case TicketStatus.IN_TRANSIT:
        keepPatientOnOrigin(origin, ticket); // el paciente no se movió aún → sigue en el origen
        if (dest) dest.status = BedStatus.ASSIGNED;
        break;
      case TicketStatus.IN_TRANSPORT:
        // El traslado ya comenzó: el paciente sale de la cama origen. Copiamos su ficha
        // completa (dieta/ayuno/aislamiento/datos) a la cama destino —que sigue "Asignada",
        // NO ocupada— para que esos indicadores acompañen al paciente en tránsito en lugar de
        // desaparecer del mapa; y limpiamos el origen, dejándolo "En preparación".
        if (dest && origin) {
          copyPatientToBed(origin, dest);
          dest.patientName = ticket.patientName; // fallback por si el origin venía vacío
          dest.patientCode = dest.patientCode || ticket.patientCode; // si el origin venía vacío (HRA), habilita el reapply del enrich por patientCode
        }
        if (dest) dest.status = BedStatus.ASSIGNED;
        if (origin) {
          clearPatientFromBed(origin);
          origin.status = BedStatus.PREPARATION;
        }
        break;
      case TicketStatus.WAITING_CONSOLIDATION:
        // Hasta que Admin consolide en PROGAL, Gamma todavía apunta el paciente a
        // la cama origen. Visualmente lo mostramos en destino: copiamos paciente +
        // enrich completo (fasting/dieta/diagnóstico/DNI) al destino, y limpiamos
        // TODO en el origen — sino la pill de ayuno y otros campos quedan fantasma.
        if (dest && origin) {
          copyPatientToBed(origin, dest);
          dest.status = BedStatus.OCCUPIED;
          dest.patientName = ticket.patientName; // usar el del ticket por si el origin venía vacío
          dest.patientCode = dest.patientCode || ticket.patientCode; // si el origin venía vacío (HRA), habilita el reapply del enrich por patientCode
        }
        if (origin) {
          clearPatientFromBed(origin);
          origin.status = BedStatus.PREPARATION;
        }
        break;
    }
  }
  return result;
}

const POLL_TICKETS_MS     = 8_000;   // tickets: poll every 8s
const POLL_BEDS_MS        = 60_000;  // beds: poll every 60s
const POLL_ISOLATIONS_MS  = 30_000;  // isolations: poll every 30s (SP write → other clients see change)

/** Human-readable labels for status transitions (for poll-based notifications) */
function statusChangeLabel(_from: string, to: string): { title: string } | null {
  switch (to) {
    case TicketStatus.IN_TRANSIT:             return { title: 'Habitacion Lista' };
    case TicketStatus.IN_TRANSPORT:           return { title: 'Traslado en Curso' };
    case TicketStatus.WAITING_CONSOLIDATION:  return { title: 'Recepcion Confirmada' };
    case TicketStatus.COMPLETED:              return { title: 'Traslado Consolidado' };
    case TicketStatus.REJECTED:               return { title: 'Traslado Cancelado' };
    default: return null;
  }
}

/**
 * Timestamp del evento real del ticket (no "ahora" del cliente).
 * Hace que la hora en el dropdown refleje cuándo se generó el cambio en el server,
 * no cuándo el polling lo detectó.
 */
function timestampOfTicketEvent(t: Ticket): string {
  const iso =
      t.status === TicketStatus.IN_TRANSIT             ? t.cleaningDoneAt
    : t.status === TicketStatus.IN_TRANSPORT           ? t.transportStartedAt
    : t.status === TicketStatus.WAITING_CONSOLIDATION  ? t.receptionConfirmedAt
    : t.status === TicketStatus.COMPLETED              ? t.completedAt
    : t.status === TicketStatus.REJECTED               ? t.completedAt
    : t.createdAt;
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
const WARNING_MINUTES     = 15;
const TOKEN_KEY           = 'mediflow_token';
const USER_KEY            = 'mediflow_user';
const GEO_KEY             = 'mediflow_geo';
const GEO_CACHE_TTL       = 30 * 60_000; // 30 min — reuso de la última posición sin re-pedir permiso

type GeoCoords = { lat: number; lng: number };
type GeoRef = React.MutableRefObject<{ coords: GeoCoords | null; ts: number }>;

// Lee la última geo válida persistida (sobrevive recargas/deploys), si está vigente.
function readPersistedGeo(): { coords: GeoCoords; ts: number } | null {
  try {
    const raw = localStorage.getItem(GEO_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { lat: number; lng: number; ts: number };
    if (typeof p?.lat !== 'number' || typeof p?.lng !== 'number' || typeof p?.ts !== 'number') return null;
    if (Date.now() - p.ts >= GEO_CACHE_TTL) return null;
    return { coords: { lat: p.lat, lng: p.lng }, ts: p.ts };
  } catch { return null; }
}

function writePersistedGeo(coords: GeoCoords): void {
  try { localStorage.setItem(GEO_KEY, JSON.stringify({ ...coords, ts: Date.now() })); } catch { /* ignore */ }
}

// Estado del permiso de geolocalización. 'unknown' si el browser no soporta la
// Permissions API para geolocation (ej. Safari/iOS) → lo tratamos como NO concedido
// para no disparar prompts en background.
async function geoPermissionState(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state as 'granted' | 'prompt' | 'denied';
  } catch { return 'unknown'; }
}

// Geo SIN prompt: ref en memoria → localStorage. Nunca llama getCurrentPosition.
function geoNoPrompt(ref: GeoRef): GeoCoords | null {
  const now = Date.now();
  if (ref.current.coords && now - ref.current.ts < GEO_CACHE_TTL) return ref.current.coords;
  const p = readPersistedGeo();
  if (p) { ref.current = { coords: p.coords, ts: p.ts }; return p.coords; } // hidrata el ref tras un remount
  return null;
}

// Único punto que dispara el prompt del browser. Persiste lo obtenido (ref + localStorage).
function requestFreshGeo(ref: GeoRef): Promise<GeoCoords | null> {
  return new Promise<GeoCoords | null>(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        ref.current = { coords, ts: Date.now() };
        writePersistedGeo(coords);
        resolve(coords);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

export const useHospitalState = () => {

  // ── Session init ─────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(USER_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  const [currentView, setCurrentView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(USER_KEY);
    if (saved) {
      const user = JSON.parse(saved) as User;
      // Vista inicial = primer módulo accesible del rol. Mapea Acceso_RT a ViewMode.
      // Si el user (legacy) no tiene `modules`, default HOME.
      const modules = (user.modules ?? []) as RoleModule[];
      if (modules.includes('Home')) return 'HOME';
      if (modules.includes('Operativa')) return 'REQUESTS';
      if (modules.includes('Mapa de Camas')) return 'BEDS';
      if (modules.includes('Historial')) return 'HISTORY';
    }
    return 'HOME';
  });

  const [activeRole, setActiveRole] = useState<Role>(() => {
    const saved = localStorage.getItem(USER_KEY);
    return saved ? (JSON.parse(saved).role as Role) : Role.ADMISSION;
  });

  // ── Token state ───────────────────────────────────────────────────────────────
  const [token, setToken]                 = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [tokenExpirySoon, setExpirySoon]  = useState(false);
  const [tokenMinutesLeft, setMinutesLeft]= useState(() => getTokenMinutesLeft(localStorage.getItem(TOKEN_KEY)));

  // Check token expiry every minute
  useEffect(() => {
    const check = () => {
      const t    = localStorage.getItem(TOKEN_KEY);
      const mins = getTokenMinutesLeft(t);
      setMinutesLeft(mins);
      setExpirySoon(mins > 0 && mins <= WARNING_MINUTES);
      if (t && mins <= 0) handleLogout(); // auto-logout cuando expira
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── authFetch — agrega Authorization header en todos los requests ─────────────
  // Adicionalmente intercepta 403 con `error: 'location_blocked'` (del wrapper
  // La validación de ubicación NO corre per-request. Tiene su propia cadencia:
  // un useEffect dispara /api/validate-location cada 5 min. Si falla → logout.
  // Esto evita kicks por flake (multi-WAN, geo basura, cache stale entre instances)
  // mientras preserva la garantía "user que se va del hospital es expulsado" con
  // ventana de máximo 5 min.
  //
  // Igual mantenemos detección de 403 location_blocked acá por si algún endpoint
  // legacy o futuro lo dispara — no rompe nada y dispara el logout correcto.
  const authFetch = useCallback(async (url: string, options?: RequestInit): Promise<Response> => {
    const t = localStorage.getItem(TOKEN_KEY);

    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...(options?.headers ?? {}),
      },
    });
    // Detección de ubicación bloqueada server-side.
    // Usamos res.clone() para no consumir el body original — el caller puede
    // procesar la response normalmente después.
    if (res.status === 403) {
      try {
        const cloned = res.clone();
        const data = await cloned.json();
        if (data?.error === 'location_blocked') {
          setLoginError(
            data?.reason ??
            'Tu ubicación cambió. Volvé a ingresar desde un lugar autorizado.'
          );
          handleLogout();
        }
      } catch { /* response sin body JSON, ignorar */ }
    }
    return res;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── App state ─────────────────────────────────────────────────────────────────
  const [sortConfig, setSortConfig]                = useState<SortConfig>({ key: 'createdAt', direction: 'desc' });
  const [requestsSearchTerm, setRequestsSearchTerm]= useState('');
  const [notifications, setNotifications]          = useState<Notification[]>([]);
  const [notificationHistory, setNotificationHistory] = useState<Notification[]>([]); // historial 24h desde SP (campanita)
  const [toasts, setToasts]                        = useState<{ id: string; notification: Notification }[]>([]);
  const [loginEmail, setLoginEmail]                = useState('');
  const [loginPass, setLoginPass]                  = useState('');
  const [loginError, setLoginError]                = useState('');
  const [loginLoading, setLoginLoading]            = useState(false);
  const [bedsLoading, setBedsLoading]              = useState(false);
  const [bedsError, setBedsError]                  = useState<string | null>(null);
  const [ticketActionLoading, setTicketActionLoading] = useState(false);
  const writingRef = React.useRef(false); // block polls during SP writes
  const ticketsEtagRef = React.useRef<string | null>(null); // ETag for smart polling
  const prevTicketSnapshotRef = React.useRef<Map<string, string>>(new Map()); // id → status for change detection
  const initialLoadDoneRef = React.useRef(false); // skip notifications on first load
  const appStartTimeRef = React.useRef(Date.now()); // suppress notifications for first 15s
  const bedsEtagRef = React.useRef<string | null>(null); // ETag for beds 304 support
  const soundCooldownRef = React.useRef(false); // prevent sound spam
  // Cache cliente de la última posición geo válida. Compartida entre login y
  // revalidación periódica. TTL 30 min — evita golpear navigator.geolocation
  // (y por ende el prompt de permiso del browser) en cada poll.
  const geoCacheRef = React.useRef<{ coords: { lat: number; lng: number } | null; ts: number }>({ coords: null, ts: 0 });
  const [rawBeds, setRawBeds]                      = useState<Bed[]>([]);
  const [tickets, setTickets]                      = useState<Ticket[]>(MOCK_TICKETS);
  // Isolation: stored by patientCode, derived to bed labels via beds data
  // A patient may have multiple isolation types active at once (e.g. Covid + Contacto).
  const [isolatedPatients, setIsolatedPatients]    = useState<Map<string, IsolationType[]>>(new Map()); // patientCode → isolation types

  // Snapshot del enrich por patientCode — se actualiza en cada fetchBeds con los beds
  // cuyo enriched===true. Permite que la pill de ayuno/dieta/diagnóstico "siga" al
  // paciente cuando se mueve de cama y el cron aún no procesó su nueva ubicación.
  // useRef porque mutamos en cada poll sin querer disparar re-renders extra.
  const patientEnrichMapRef = useRef<Map<string, PatientEnrichSnapshot>>(new Map());

  const beds = useMemo(() => {
    const active = tickets.filter(t => t.status !== TicketStatus.COMPLETED && t.status !== TicketStatus.REJECTED);
    const merged = mergeBeds(rawBeds, active);
    return reapplyEnrichFromMap(merged, patientEnrichMapRef.current);
  }, [rawBeds, tickets]);

  // Derive isolatedBeds (bed labels) from isolatedPatients (patientCodes) + beds + active tickets
  const isolatedBeds = useMemo(() => {
    const set = new Set<string>();
    // 1. Check beds directly (from Gamma data)
    for (const bed of beds) {
      if (bed.patientCode && isolatedPatients.has(bed.patientCode)) set.add(bed.label);
    }
    // 2. Check active tickets — if an isolated patient is being transferred,
    //    mark the destination bed (patient follows the ticket, not the old bed)
    for (const t of tickets) {
      if (t.status === TicketStatus.COMPLETED || t.status === TicketStatus.REJECTED) continue;
      if (!t.destination) continue;
      // Find patientCode from the origin bed
      const originBed = rawBeds.find(b => b.label === t.origin);
      if (originBed?.patientCode && isolatedPatients.has(originBed.patientCode)) {
        set.add(t.destination); // mark destination as isolated
        set.delete(t.origin);  // origin is no longer isolated (patient is moving)
      }
    }
    return set;
  }, [beds, rawBeds, tickets, isolatedPatients]);

  // ── Data fetchers ─────────────────────────────────────────────────────────────
  const fetchBeds = useCallback(async (force = false) => {
    setBedsLoading(true);
    setBedsError(null);
    try {
      const headers: Record<string, string> = {};
      if (!force && bedsEtagRef.current) headers['If-None-Match'] = bedsEtagRef.current;

      const r = await authFetch('/api/beds', { headers });
      if (r.status === 401) { handleLogout(); return; }
      if (r.status === 304) return; // no changes
      if (!r.ok) return; // keep previous data

      const etag = r.headers.get('etag');
      if (etag) bedsEtagRef.current = etag;

      const data = await r.json();
      if (data.error) return;

      if (Array.isArray(data.beds) && data.beds.length > 0) {
        // Skip partial failures (all beds available when we know some are occupied)
        const hasOccupied = data.beds.some((b: any) => b.status === 'Ocupada' || b.status === 'En preparación' || b.status === 'Inhabilitada');
        if (!hasOccupied && rawBeds.length > 0 && rawBeds.some(b => b.status === BedStatus.OCCUPIED)) {
          return; // Gamma partial failure — keep previous data
        }
        // Actualizar el snapshot de enrich por paciente: solo donde el server marcó
        // enriched===true (aplicó enrich del cache). Guardamos también valores undefined
        // — sino la cancelación de un ayuno nunca limpiaría la entrada del mapa.
        for (const bed of data.beds as Bed[]) {
          if (bed.patientCode && bed.enriched === true) {
            patientEnrichMapRef.current.set(bed.patientCode, extractEnrichSnapshot(bed));
          }
        }
        setBedsError(null);
        setRawBeds(data.beds);
      }
    } catch (e: any) {
      console.error('[fetchBeds] error:', e);
    }
    finally { setBedsLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch]);

  // ── On-demand bed enrichment (single bed) ─────────────────────────────────
  const enrichBed = useCallback(async (bed: Bed): Promise<Bed> => {
    if (!bed.patientCode) return bed;
    try {
      // El evento (diet/diagnóstico/ayunos/plan) ya viene en `bed` desde /api/beds
      // y vive en el shared cache server-side (60s). Acá solo necesitamos los datos
      // del paciente que NO están en /api/beds: DNI, edad, sexo (consultarpacientecodigo,
      // cacheado 10 min). Por eso NO pasamos fresh=1 — sería un re-fetch innecesario
      // del evento que ya tenemos fresco.
      const params = new URLSearchParams({ patientCode: bed.patientCode });
      if (bed.eventOrigin) params.set('eventOrigin', bed.eventOrigin);
      if (bed.eventNumber != null) params.set('eventNumber', String(bed.eventNumber));
      const r = await authFetch(`/api/bed-enrich?${params}`);
      if (!r.ok) return bed;
      const data = await r.json();
      return { ...bed, ...data };
    } catch {
      return bed;
    }
  }, [authFetch]);

  const fetchTickets = useCallback(async () => {
    if (writingRef.current) return; // skip poll while writing to SP
    try {
      const headers: Record<string, string> = {};
      if (ticketsEtagRef.current) headers['If-None-Match'] = ticketsEtagRef.current;
      const r = await authFetch('/api/tickets?all=1', { headers });
      if (r.status === 401) { handleLogout(); return; }
      if (r.status === 304) return; // no changes
      if (!r.ok) return;
      const etag = r.headers.get('etag');
      if (etag) ticketsEtagRef.current = etag;
      const data: { tickets: Ticket[] } = await r.json();
      if (Array.isArray(data.tickets) && !writingRef.current) {
        // On first API load, seed the snapshot so we don't fire notifications for existing tickets
        if (!initialLoadDoneRef.current) {
          prevTicketSnapshotRef.current = new Map(data.tickets.map(t => [t.id, t.status]));
          initialLoadDoneRef.current = true;
        }
        setTickets(data.tickets);
      }
    } catch { /* keep mock/current data */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch]);

  // ── Polling ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetchBeds();
    fetchTickets();
    fetchIsolations();
    const ticketPoll    = setInterval(fetchTickets, POLL_TICKETS_MS);
    const bedPoll       = setInterval(fetchBeds, POLL_BEDS_MS);
    const isolationPoll = setInterval(fetchIsolations, POLL_ISOLATIONS_MS);
    return () => {
      clearInterval(ticketPoll);
      clearInterval(bedPoll);
      clearInterval(isolationPoll);
    };
  }, [token, fetchBeds, fetchTickets]);

  // ── Change detection — generate notifications from polling updates ───────────
  useEffect(() => {
    if (!currentUser || writingRef.current) return;

    // Snapshot key captures both status and destination so edits to destination
    // (without a status change) are detected and surfaced as "Modificación".
    const snapKey = (t: Ticket) => `${t.status}|${t.destination ?? ''}`;
    const prev = prevTicketSnapshotRef.current;
    const next = new Map(tickets.map(t => [t.id, snapKey(t)]));

    // Skip first load + suppress notifications for first 15 seconds after app start
    if (!initialLoadDoneRef.current || (Date.now() - appStartTimeRef.current < 15_000)) {
      prevTicketSnapshotRef.current = next;
      if (tickets.length > 0) initialLoadDoneRef.current = true;
      return;
    }

    // Helper to find bed area for a given label
    const areaOf = (label?: string | null) => label ? rawBeds.find(b => b.label === label)?.area : undefined;

    // Notif in-app relevante si:
    //   1) el rol tiene el permiso granular para ese tipo de notif (notif_new_ticket, etc.)
    //   2) si filtra por pisos, el área del ticket está en sus áreas asignadas.
    // El caso especial "Catering todo bloqueado" ya no hace falta: Catering simplemente
    // NO tiene los permisos notif_new_ticket / notif_status_update en su rol, así que
    // canReceiveNotif retorna false para esas notifs. Si en el futuro alguien le agrega
    // esos permisos en el ABM, Catering los recibe — comportamiento consistente.
    const isRelevant = (notif: Notification) => {
      if (!canReceiveNotif(currentUser, notif.type)) return false;
      if (!currentUser.filterByFloors) return true;
      if (!currentUser.assignedAreas?.length) return false;
      // Áreas efectivas: si un extremo es Sala de Espera (HRA) se remapea al piso real
      // del otro extremo, sino HRA (que todas las azafatas tienen) matchearía a todas.
      const { origin, dest } = effectiveHostessAreas(notif.originArea, notif.destinationArea);
      return Boolean(
        (origin && currentUser.assignedAreas.includes(origin)) ||
        (dest   && currentUser.assignedAreas.includes(dest))
      );
    };

    const newNotifs: Notification[] = [];

    for (const t of tickets) {
      const prevKey = prev.get(t.id);

      // No notificar sobre tickets ya cerrados que recién aparecen (ej: histórico al
      // cargar). Una TRANSICIÓN a cerrado (Consolidado/Cancelado) sí se notifica más
      // abajo — así admisión se entera de la finalización aunque el web-push falle.
      if ((t.status === TicketStatus.COMPLETED || t.status === TicketStatus.REJECTED) && prevKey === undefined) continue;

      const originArea = areaOf(t.origin);
      const destArea   = areaOf(t.destination);

      if (prevKey === undefined) {
        // ── New ticket appeared ─────────────────────────────────────────
        // El creador ya recibió una notif local al crear; no duplicar vía polling.
        // (El skip aplica SOLO acá: para cambios de estado posteriores el creador —ej.
        // admisión— sí debe recibir notif, sino se pierde la finalización si falla el push.)
        if (t.createdById && String(t.createdById) === String(currentUser.id)) continue;
        const notif: Notification = {
          id: `NOTIF-POLL-${t.id}`, isRead: false,
          timestamp: timestampOfTicketEvent(t),
          type: NotificationType.NEW_TICKET,
          title: 'Nueva Solicitud de Traslado',
          message: `${t.patientName}: ${t.origin} → ${t.destination ?? '?'}`,
          ticketId: t.id, sede: t.sede,
          originArea, destinationArea: destArea,
        };
        newNotifs.push(notif);
      } else if (prevKey !== snapKey(t)) {
        const [prevStatus, prevDestRaw] = prevKey.split('|');
        const prevDest = prevDestRaw || null;
        const destChanged = (prevDest ?? '') !== (t.destination ?? '');
        const statusChanged = prevStatus !== t.status;

        // A destination change always causes a status recalculation (WAITING_ROOM
        // ↔ IN_TRANSIT depending on whether the new bed was AVAILABLE or PREPARATION).
        // In that case the status-change notif ("Habitacion Lista", etc.) is misleading —
        // the real event is the edit, which is covered by the destination-change notifs
        // below. So: only emit a status-change notif when ONLY the status moved.
        if (statusChanged && !destChanged) {
          const label = statusChangeLabel(prevStatus, t.status);
          if (label) {
            newNotifs.push({
              id: `NOTIF-POLL-${t.id}-${t.status}`, isRead: false,
              timestamp: timestampOfTicketEvent(t),
              type: NotificationType.STATUS_UPDATE,
              title: label.title,
              message: `${t.patientName}: ${t.origin} → ${t.destination ?? '?'}`,
              ticketId: t.id, sede: t.sede,
              originArea, destinationArea: destArea,
            });
          }
        }

        if (destChanged) {
          // ── Destination edited (admin/admision modified the ticket) ──
          const prevDestArea = areaOf(prevDest);
          // Old destination area: traslado no viene más
          if (prevDestArea && prevDestArea !== destArea) {
            newNotifs.push({
              id: `NOTIF-POLL-${t.id}-CANCEL-${prevDest}`, isRead: false,
              timestamp: timestampOfTicketEvent(t),
              type: NotificationType.STATUS_UPDATE,
              title: 'Traslado Cancelado',
              message: `${t.patientName}: el traslado hacia ${prevDest} fue cancelado (destino modificado).`,
              ticketId: t.id, sede: t.sede,
              originArea: prevDestArea, destinationArea: prevDestArea,
            });
          }
          // New destination area: nueva solicitud llega
          if (destArea && destArea !== prevDestArea) {
            newNotifs.push({
              id: `NOTIF-POLL-${t.id}-NEW-${t.destination}`, isRead: false,
              timestamp: timestampOfTicketEvent(t),
              type: NotificationType.NEW_TICKET,
              title: 'Nueva Solicitud de Traslado',
              message: `${t.patientName}: ${t.origin} → ${t.destination ?? '?'}`,
              ticketId: t.id, sede: t.sede,
              originArea, destinationArea: destArea,
            });
          }
          // Origin area: modificación de una solicitud existente
          if (originArea) {
            newNotifs.push({
              id: `NOTIF-POLL-${t.id}-MOD-${t.destination}`, isRead: false,
              timestamp: timestampOfTicketEvent(t),
              type: NotificationType.STATUS_UPDATE,
              title: 'Modificación de Solicitud',
              message: `${t.patientName}: destino cambiado a ${t.destination ?? '?'}.`,
              ticketId: t.id, sede: t.sede,
              originArea, destinationArea: destArea,
            });
          }
        }
      }
    }

    if (newNotifs.length > 0) {
      setNotifications(n => [...newNotifs, ...n]);

      // Create toasts only for relevant notifications (filtered por permiso + área)
      const relevantToasts = newNotifs
        .filter(n => isRelevant(n))
        .map(n => ({ id: `TOAST-${n.id}`, notification: n }));
      if (relevantToasts.length > 0) {
        setToasts(prev => [...relevantToasts, ...prev].slice(0, 5)); // max 5 toasts
        // Play sound once, with cooldown to avoid spam on reload
        if (!soundCooldownRef.current) {
          playNotificationSound();
          soundCooldownRef.current = true;
          setTimeout(() => { soundCooldownRef.current = false; }, 3000);
        }

        // Browser notifications (works even when tab is not in foreground)
        if ('Notification' in window && window.Notification.permission === 'granted') {
          for (const toast of relevantToasts) {
            const n = toast.notification;
            try {
              new window.Notification(n.title, {
                body: n.message,
                icon: '/favicon.ico',
                tag: n.id, // prevents duplicates
              });
            } catch { /* silent — some browsers block from non-secure contexts */ }
          }
        }
      }
    }

    prevTicketSnapshotRef.current = next;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets]);

  // ── SP write helpers ──────────────────────────────────────────────────────────
  // Both helpers can return a `conflict` when the server rejects with 409
  // (cama destino ya tomada por otro traslado activo). Callers must rollback the
  // optimistic update + alert in that case.
  type SpConflict = { error: string; conflictingTicketId?: string };

  const spCreate = async (ticket: Ticket): Promise<{ spItemId?: string; conflict?: SpConflict }> => {
    try {
      // Nombres de área reales (no labels de cama) para que el push de NEW_TICKET
      // filtre por área con la regla de HRA (Sala de Espera) igual que los cambios de estado.
      const originAreaName      = ticket.origin      ? rawBeds.find((b: Bed) => b.label === ticket.origin)?.area      : undefined;
      const destinationAreaName = ticket.destination ? rawBeds.find((b: Bed) => b.label === ticket.destination)?.area : undefined;
      const r = await authFetch('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({ ...ticket, originAreaName, destinationAreaName }),
      });
      if (r.status === 409) {
        const data = await r.json().catch(() => ({} as any));
        return { conflict: { error: data?.error ?? 'Cama destino ya asignada.', conflictingTicketId: data?.conflictingTicketId } };
      }
      if (!r.ok) return {};
      const { spItemId } = await r.json();
      return { spItemId: spItemId as string };
    } catch { return {}; }
  };

  const spUpdate = async (spItemId: string, updates: Partial<Ticket>, ticket?: Ticket): Promise<{ ok: boolean; conflict?: SpConflict }> => {
    try {
      // Include ticket context so push notifications have full info.
      // originArea / destinationArea are the real Gamma area names (not bed labels),
      // used server-side for precise subscriber filtering and for composing the
      // Catering-specific message (room + floor).
      const originArea      = ticket?.origin      ? rawBeds.find((b: Bed) => b.label === ticket.origin)?.area      : undefined;
      const destinationArea = ticket?.destination ? rawBeds.find((b: Bed) => b.label === ticket.destination)?.area : undefined;
      const context = ticket ? {
        id: ticket.id,
        patientName: ticket.patientName,
        origin: ticket.origin,
        destination: ticket.destination,
        originArea,
        destinationArea,
        sede: ticket.sede,
      } : {};
      const r = await authFetch('/api/tickets', {
        method: 'PATCH',
        body:   JSON.stringify({ spItemId, ...context, ...updates }),
      });
      if (r.status === 409) {
        const data = await r.json().catch(() => ({} as any));
        return { ok: false, conflict: { error: data?.error ?? 'Cama destino ya asignada.', conflictingTicketId: data?.conflictingTicketId } };
      }
      return { ok: r.ok };
    } catch { return { ok: false }; /* next poll will reconcile */ }
  };

  const spLogEvent = async (ticketId: string, tipo: string): Promise<void> => {
    try {
      await authFetch('/api/ticket-events', {
        method: 'POST',
        body: JSON.stringify({
          ticketId,
          tipo,
          usuario: currentUser?.name ?? '',
          usuarioId: currentUser?.id ?? '',
        }),
      });
    } catch { /* non-blocking */ }
  };

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 10_000);
      let res: Response;
      try {
        res = await fetch('/api/auth', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ username: loginEmail, password: loginPass }),
          signal:  controller.signal,
        });
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError') {
          setLoginError('Timeout: el servidor no respondió en 10 segundos. ¿Está corriendo "vercel dev --listen 3000"?');
        } else {
          setLoginError(`Error de red: ${fetchErr?.message ?? 'sin conexión al servidor'}`);
        }
        return;
      } finally {
        clearTimeout(timeout);
      }
      const data = await res.json();
      if (!res.ok) {
        // Rate limit (anti brute-force): el server devolvió 429 con retryAfterSeconds.
        if (res.status === 429) {
          const secs = Number(data?.retryAfterSeconds) || 900;
          const wait = secs < 60
            ? `${secs} segundo${secs === 1 ? '' : 's'}`
            : `${Math.ceil(secs / 60)} minuto${Math.ceil(secs / 60) === 1 ? '' : 's'}`;
          setLoginError(`Cuenta bloqueada por seguridad tras varios intentos fallidos. Probá de nuevo en ${wait}.`);
          return;
        }
        setLoginError(data.error ?? 'Credenciales incorrectas');
        return;
      }

      const user: User = data.user;

      // Si el rol filtra por pisos, las áreas asignadas vienen del campo PisosAzafata_u
      // de SP. Convertir el string semicolon-separated a array de Area en el frontend.
      // Sin esto, el filtro inicial de BedsView no se aplica y la suscripción push se
      // registra sin áreas → recibiría notifs de todo el hospital.
      if (user.filterByFloors && (data.user as any).assignedFloors) {
        const floorsStr = String((data.user as any).assignedFloors);
        const areaValues = Object.values(Area) as string[];
        user.assignedAreas = floorsStr
          .split(';')
          .map(s => s.trim())
          .filter(s => areaValues.includes(s)) as Area[];
      }

      // ── Location validation (skip for SUMAR superusers o roles con bypass) ──
      if (user.sede !== 'SUMAR' && !user.bypassLocationCheck) {
        const postValidateLogin = (coords: GeoCoords | null) =>
          fetch('/api/validate-location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
            body: JSON.stringify({ sede: user.sede, lat: coords?.lat, lng: coords?.lng }),
          }).then(r => r.json());

        try {
          // IP-first: reusamos la geo persistida (si vigente) o validamos sin geo, sin pedir
          // permiso. Solo pedimos GPS si la IP no alcanza y falta geo.
          let coords = geoNoPrompt(geoCacheRef);
          let locData = await postValidateLogin(coords);

          if (locData?.allowed === false && locData?.method === 'geo_unavailable' && !coords) {
            coords = await requestFreshGeo(geoCacheRef);
            if (coords) locData = await postValidateLogin(coords);
          }

          if (locData?.allowed === false) {
            setLoginError(locData.reason || 'Ubicación no autorizada para esta sede');
            return;
          }
        } catch {
          console.warn('[login] Location validation unavailable, proceeding');
        }
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY,  JSON.stringify(user));
      setToken(data.token);
      setCurrentUser(user);
      setActiveRole(user.role as Role);
      // Landing view = primer módulo accesible (Acceso_RT del rol). Mapea a ViewMode.
      // Prioridad: Home → Operativa → Mapa de Camas → Historial. Default 'HOME' si el
      // rol no tiene `modules` (legacy / fail-open).
      const mods = (user.modules ?? []);
      const landingView: ViewMode =
        mods.includes('Home') ? 'HOME'
        : mods.includes('Operativa') ? 'REQUESTS'
        : mods.includes('Mapa de Camas') ? 'BEDS'
        : mods.includes('Historial') ? 'HISTORY'
        : 'HOME';
      setCurrentView(landingView);

      // Pre-fetch beds + tickets so HOSTESS view has data immediately
      fetchBeds();
      fetchTickets();

      // Load isolations from SharePoint
      fetchIsolations();

      // Subscribe to Web Push notifications
      if ('Notification' in window) {
        if (window.Notification.permission === 'default') {
          await window.Notification.requestPermission();
        }
        if (window.Notification.permission === 'granted') {
          import('../lib/pushSubscription').then(({ subscribeToPush }) => {
            // Enviamos el NombreRol_RT (no el enum) para que el server-side pueda
            // hacer reverse-lookup contra 99.ABMRoles_Traslados.
            subscribeToPush(data.token, user.id, user.roleName ?? user.role, user.assignedAreas ?? [], user.sede);
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      setLoginError(`Error inesperado: ${err?.message ?? String(err)}`);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = useCallback(() => {
    // Unsubscribe push notifications for this user
    const t = localStorage.getItem(TOKEN_KEY);
    if (t && 'serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready.then(reg => {
        reg.pushManager.getSubscription().then(sub => {
          if (sub) {
            // Delete subscription from SP
            fetch('/api/push-subscribe', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
              body: JSON.stringify({ endpoint: sub.endpoint }),
            }).catch(() => {});
            // Unsubscribe from browser
            sub.unsubscribe().catch(() => {});
          }
        }).catch(() => {});
      }).catch(() => {});
    }

    // Reset refs de detección de cambios. Sin esto, al re-loguear en la misma pestaña
    // el detector de polling compara los tickets nuevos contra el snapshot del usuario
    // anterior y dispara notifs falsas para todos los tickets activos como si fueran
    // recién creados.
    initialLoadDoneRef.current    = false;
    appStartTimeRef.current       = Date.now();
    prevTicketSnapshotRef.current = new Map();
    soundCooldownRef.current      = false;
    ticketsEtagRef.current        = null;
    bedsEtagRef.current           = null;

    // Reset state in-memory para que el próximo login no arranque mostrando
    // dropdown/banner con datos del user anterior por un instante.
    setTickets([]);
    setNotifications([]);
    setToasts([]);
    setUnreadSpNotifications([]);
    setRawBeds([]);

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setCurrentUser(null);
    setExpirySoon(false);
    setMinutesLeft(0);
  }, []);

  // ── Filtered data ─────────────────────────────────────────────────────────────
  // Notificaciones del dropdown (in-app). Mismo criterio que el detector de polling:
  // permiso granular por tipo de notif + filtro por pisos si aplica.
  const filteredNotifications = useMemo<Notification[]>(() => {
    if (!currentUser) return [];
    return notifications.filter((n: Notification) => {
      if (!canReceiveNotif(currentUser, n.type)) return false;
      if (!currentUser.filterByFloors) return true;
      if (!currentUser.assignedAreas?.length) return false;
      // Áreas efectivas: HRA (Sala de Espera) se remapea al piso real del otro extremo.
      const { origin, dest } = effectiveHostessAreas(n.originArea, n.destinationArea);
      const isOrigin = origin && currentUser.assignedAreas?.includes(origin);
      const isDest   = dest   && currentUser.assignedAreas?.includes(dest);
      return Boolean(isOrigin || isDest);
    });
  }, [notifications, currentUser]);

  // Campanita: historial 24h de SP (persistente, sobrevive refresh) + notis en vivo de
  // la sesión que todavía no estén en SP (dedup por ticketId+type → SP gana porque trae
  // el id real para marcar leída). Sin tope de cantidad: se muestran todas las de 24h
  // (el panel ya es scrolleable por max-h, así que no se expande infinito).
  const bellNotifications = useMemo<Notification[]>(() => {
    const seen = new Set(
      notificationHistory.filter(n => n.ticketId).map(n => `${n.ticketId}|${n.type}`),
    );
    const liveExtra = filteredNotifications.filter(
      n => !(n.ticketId && seen.has(`${n.ticketId}|${n.type}`)),
    );
    const history = currentUser
      ? notificationHistory.filter(n => canReceiveNotif(currentUser, n.type)) // defensivo si cambió el rol
      : notificationHistory;
    return [...liveExtra, ...history];
  }, [notificationHistory, filteredNotifications, currentUser]);

  const filteredTickets = useMemo(() => {
    let result = tickets;
    if (currentUser?.sede !== SedeType.SUMAR)
      result = result.filter(t => t.sede === currentUser?.sede);

    // Si el rol filtra por pisos, restringir tickets a las áreas asignadas
    // (igual que ya hacía HOSTESS hardcoded). Catering no llega acá porque no
    // tiene acceso a Operativa (Acceso_RT sin 'Operativa') — pero el filtro queda
    // genérico por filterByFloors para roles nuevos.
    if (currentUser?.filterByFloors && currentUser.assignedAreas?.length) {
      const allAreas = new Set(Object.values(Area) as string[]);
      const hasAll = currentUser.assignedAreas.length >= allAreas.size - 1; // 9 of 10 = effectively all
      // Only filter if azafata has a subset of areas AND beds are loaded to resolve areas
      if (!hasAll && beds.length > 0) {
        // Build a map from area label → set of bed labels for fast lookup
        const areaByLabel = new Map<string, Area>();
        for (const b of beds) if (b.area) areaByLabel.set(b.label, b.area);

        result = result.filter(t => {
          // Try matching by label first, then by area prefix in the ticket origin/destination
          const rawOriginArea = areaByLabel.get(t.origin) ?? beds.find(b => t.origin?.includes(b.area))?.area;
          const rawDestArea   = t.destination ? (areaByLabel.get(t.destination) ?? beds.find(b => t.destination?.includes(b.area))?.area) : undefined;
          // Áreas efectivas: HRA (Sala de Espera) se remapea al piso real del otro
          // extremo, sino la azafata vería traslados desde HRA hacia pisos ajenos.
          const { origin: originArea, dest: destArea } = effectiveHostessAreas(rawOriginArea, rawDestArea);
          const originInArea = originArea ? currentUser.assignedAreas?.includes(originArea) : false;
          const destInArea   = destArea   ? currentUser.assignedAreas?.includes(destArea)   : false;
          return originInArea || destInArea;
        });
      }
      // If beds not loaded yet OR azafata has all areas → show all tickets (no area filter)
    }

    // Base filtered by sede (used for history view, before search/sort)
    const baseFiltered = [...result];

    if (requestsSearchTerm) {
      const term = requestsSearchTerm.toLowerCase();
      result = result.filter(t =>
        t.patientName.toLowerCase().includes(term) ||
        t.origin.toLowerCase().includes(term) ||
        t.destination?.toLowerCase().includes(term),
      );
    }

    return { sorted: [...result].sort((a, b) => {
      const valA = a[sortConfig.key] || '';
      const valB = b[sortConfig.key] || '';
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ?  1 : -1;
      return 0;
    }), baseFiltered };
  }, [tickets, currentUser, requestsSearchTerm, sortConfig, beds]);

  // ── Ticket actions ────────────────────────────────────────────────────────────
  const addNotification = (params: {
    type: NotificationType; title: string; message: string;
    ticketId?: string; sede: SedeType; originArea?: Area; destinationArea?: Area;
  }) => {
    setNotifications(prev => [{
      id: `NOTIF-${Date.now()}`, isRead: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ...params,
    }, ...prev]);
  };

  const handleCreateTicket = async (data: Partial<Ticket> & { isolation?: boolean; reason?: string }) => {
    if (!can(currentUser, 'crear_ticket')) {
      alert('Tu rol no tiene permiso para crear solicitudes.'); return;
    }
    // Traslado Interno requiere siempre un motivo (fusión con cambio de habitación).
    if (data.workflow === WorkflowType.INTERNAL && !(data.reason || data.changeReason)) {
      alert('Debe seleccionar un motivo para el Traslado Interno.'); return;
    }
    setTicketActionLoading(true);
    writingRef.current = true;

    // If isolation requested, activate or update types
    if (data.isolation) {
      const sourceBed = beds.find(b => b.label === data.origin);
      const payloadTypes = (data as any).isolationTypes as IsolationType[] | undefined;
      const payloadType  = (data as any).isolationType  as IsolationType | undefined;
      const requested: IsolationType[] = payloadTypes?.length
        ? payloadTypes
        : payloadType ? [payloadType] : [];
      if (sourceBed?.patientCode) {
        const code = sourceBed.patientCode.trim();
        const current = isolatedPatients.get(code) ?? [];
        const newTypes = requested.length ? requested : [IsolationType.CONTACTO];
        const changed = current.length !== newTypes.length ||
          current.some((t: IsolationType, i: number) => t !== newTypes[i]);
        if (changed) {
          setIsolatedPatients(prev => { const next = new Map(prev); next.set(code, newTypes); return next; });
          authFetch('/api/isolations', {
            method: 'POST',
            body: JSON.stringify({
              patientCode: sourceBed.patientCode,
              patientName: sourceBed.patientName || data.patientName || '',
              userName: currentUser?.name || '',
              tipos: newTypes,
            }),
          }).catch(() => {});
        }
      }
    }

    try { await _createTicket(data); } finally {
      // wait a beat then unlock polling and sync
      setTimeout(async () => {
        writingRef.current = false;
        ticketsEtagRef.current = null; // invalidate ETag to force fresh fetch
        await fetchTickets();
        setTicketActionLoading(false);
      }, 1000);
    }
  };

  const _createTicket = async (data: Partial<Ticket>) => {
    if (!can(currentUser, 'crear_ticket')) return;

    // Block duplicate: no two active transfers for the same origin bed
    const existingActive = tickets.find(t =>
      t.origin === data.origin &&
      t.status !== TicketStatus.COMPLETED &&
      t.status !== TicketStatus.REJECTED
    );
    if (existingActive) {
      alert(`Ya existe un traslado activo para esta cama (${existingActive.id}). Debe finalizar o cancelarse antes de crear otro.`);
      return;
    }

    const sourceBed = beds.find(b => b.label === data.origin);
    const targetBed = beds.find(b => b.label === data.destination);
    if (!sourceBed || sourceBed.status !== BedStatus.OCCUPIED) { alert('Error: La cama de origen debe estar OCUPADA.'); return; }
    if (!targetBed || (targetBed.status !== BedStatus.AVAILABLE && targetBed.status !== BedStatus.PREPARATION)) { alert('Error: La cama de destino debe estar DISPONIBLE o EN PREPARACIÓN.'); return; }

    // ID format: TSL-(UserID)-ddmmyyyyhhmmss
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ticketId = `TSL-${currentUser?.id ?? '0'}-${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    // Dest available → "Habitacion Lista" + dest "Asignada"
    // Dest preparation → "Esperando Habitacion" + dest keeps "En preparación"
    const isDestAvailable = targetBed.status === BedStatus.AVAILABLE;

    const newTicket: Ticket = {
      id:                      ticketId,
      sede:                    currentUser?.sede || SedeType.HPR,
      patientName:             data.patientName || sourceBed.patientName || 'Paciente',
      patientCode:             sourceBed.patientCode,
      origin:                  data.origin!,
      originBedCode:           sourceBed.bedCode,
      originBedStatus:         BedStatus.OCCUPIED,
      destination:             data.destination!,
      destinationBedCode:      targetBed.bedCode,
      destinationBedStatus:    isDestAvailable ? BedStatus.ASSIGNED : BedStatus.PREPARATION,
      workflow:                data.workflow || WorkflowType.INTERNAL,
      status:                  isDestAvailable ? TicketStatus.IN_TRANSIT : TicketStatus.WAITING_ROOM,
      createdAt:               now.toISOString(),
      date:                    now.toISOString().split('T')[0],
      isBedClean:              false,
      isReasonValidated:       true,
      targetBedOriginalStatus: targetBed.status,
      financier:               data.itrSource || sourceBed.institution,
      createdBy:               currentUser?.name,
      createdById:             currentUser?.id,
      itrSource:               data.itrSource,
      // Both NewRequestModal y EditRequestModal mandan el motivo como `reason` en el payload;
      // aceptamos también `changeReason` por compatibilidad con llamadas internas.
      changeReason:            (data as any).reason ?? data.changeReason,
      observations:            data.observations,
      intervenedByHostess:     'NO',
    };

    setTickets(prev => [newTicket, ...prev]);
    addNotification({
      type:            NotificationType.NEW_TICKET,
      title:           targetBed.status === BedStatus.PREPARATION ? 'Traslado en Preparación' : 'Solicitud de Traslado',
      message:         targetBed.status === BedStatus.PREPARATION
        ? `${newTicket.patientName}: ${newTicket.origin} → ${newTicket.destination} (En Preparación)`
        : `Confirmar disponibilidad de ${newTicket.destination} para ${newTicket.patientName}`,
      ticketId: newTicket.id, sede: newTicket.sede,
      originArea: sourceBed.area, destinationArea: targetBed.area,
    });
    setCurrentView('REQUESTS');

    const { spItemId, conflict } = await spCreate(newTicket);
    if (conflict) {
      // Rollback the optimistic insert — another admin grabbed the bed first.
      setTickets((prev: Ticket[]) => prev.filter((t: Ticket) => t.id !== newTicket.id));
      const extra = conflict.conflictingTicketId ? ` (ticket ${conflict.conflictingTicketId})` : '';
      alert(`${conflict.error}${extra}`);
      return;
    }
    if (spItemId) setTickets(prev => prev.map(t => t.id === newTicket.id ? { ...t, spItemId } : t));
    spLogEvent(newTicket.id, 'Solicitud Creada');
  };

  const handleRoomReady = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket?.destination || ticket.status === TicketStatus.IN_TRANSIT) return;
    const now     = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updates = { status: TicketStatus.IN_TRANSIT, cleaningDoneAt: now, destinationBedStatus: BedStatus.ASSIGNED, intervenedByHostess: 'SI' } as const;
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...updates } : t));
    addNotification({ type: NotificationType.STATUS_UPDATE, title: 'Habitación Lista',
      message: `La habitación ${ticket.destination} está lista. ${ticket.patientName} puede ser trasladado.`,
      ticketId: ticket.id, sede: ticket.sede,
      originArea: rawBeds.find(b => b.label === ticket.origin)?.area,
      destinationArea: rawBeds.find(b => b.label === ticket.destination)?.area,
    });
    if (ticket.spItemId) spUpdate(ticket.spItemId, updates, ticket);
    spLogEvent(ticket.id, 'Habitacion Preparada');
  };

  const handleStartTransport = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || ticket.status === TicketStatus.IN_TRANSPORT) return;
    const now     = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    // originBedStatus → "En preparación": al iniciar el traslado el paciente sale de la
    // cama origen (coherente con mergeBeds). Persistimos el cambio en SP para auditoría.
    const updates = { status: TicketStatus.IN_TRANSPORT, transportStartedAt: now, originBedStatus: BedStatus.PREPARATION, intervenedByHostess: 'SI' } as const;
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...updates } : t));
    addNotification({ type: NotificationType.STATUS_UPDATE, title: 'Traslado en Curso',
      message: `${ticket.patientName} está en camino hacia ${ticket.destination}.`,
      ticketId: ticket.id, sede: ticket.sede,
      originArea: rawBeds.find(b => b.label === ticket.origin)?.area,
      destinationArea: rawBeds.find(b => b.label === ticket.destination)?.area,
    });
    if (ticket.spItemId) spUpdate(ticket.spItemId, updates, ticket);
    spLogEvent(ticket.id, 'Inicio Traslado');
  };

  const handleConfirmReception = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket?.destination) return;
    if (ticket.status !== TicketStatus.IN_TRANSPORT && ticket.status !== TicketStatus.IN_TRANSIT) return;
    const now     = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updates = { status: TicketStatus.WAITING_CONSOLIDATION, receptionConfirmedAt: now, destinationBedStatus: BedStatus.OCCUPIED, intervenedByHostess: 'SI' } as const;
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...updates } : t));
    addNotification({ type: NotificationType.STATUS_UPDATE, title: 'Recepción Confirmada',
      message: `${ticket.patientName} ha sido recibido en ${ticket.destination}. Pendiente consolidar en PROGAL.`,
      ticketId: ticket.id, sede: ticket.sede,
      originArea: rawBeds.find(b => b.label === ticket.origin)?.area,
      destinationArea: rawBeds.find(b => b.label === ticket.destination)?.area,
    });
    if (ticket.spItemId) spUpdate(ticket.spItemId, updates, ticket);
    spLogEvent(ticket.id, 'Paciente Recibido');
  };

  const handleConsolidate = async (ticketId: string) => {
    if (!can(currentUser, 'consolidar')) {
      alert('Tu rol no tiene permiso para consolidar.'); return;
    }
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || ticket.status === TicketStatus.COMPLETED) return;
    const updates = { status: TicketStatus.COMPLETED, completedAt: new Date().toISOString(), originBedStatus: BedStatus.PREPARATION } as const;
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...updates } : t));
    // Isolation follows the patient automatically (derived from patientCode + beds)
    addNotification({ type: NotificationType.STATUS_UPDATE, title: 'Traslado Finalizado',
      message: `El traslado de ${ticket.patientName} ha sido consolidado en PROGAL.`,
      ticketId: ticket.id, sede: ticket.sede,
      originArea: rawBeds.find(b => b.label === ticket.origin)?.area,
      destinationArea: rawBeds.find(b => b.label === ticket.destination)?.area,
    });
    if (ticket.spItemId) await spUpdate(ticket.spItemId, updates, ticket);
    spLogEvent(ticket.id, 'Consolidado Progal');
    // Refresh beds immediately + again after a few seconds (Gamma/PROGAL may take a moment)
    fetchBeds();
    ticketsEtagRef.current = null;
    fetchTickets();
    setTimeout(() => { fetchBeds(); fetchTickets(); }, 5000);
  };

  const handleRejectTicket = async (ticketId: string, reason: string) => {
    // Solo Admisión/Admin pueden cancelar, en cualquier etapa activa y sin importar si la
    // azafata ya intervino. Rol fijo + permiso (cinturón de seguridad sobre la config de SP).
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) {
      alert('Solo Admisión o Admin pueden cancelar traslados.'); return;
    }
    if (!can(currentUser, 'cancelar_ticket')) {
      alert('Tu rol no tiene permiso para cancelar traslados.'); return;
    }
    if (!reason || !reason.trim()) {
      alert('La observación es obligatoria para cancelar el traslado.'); return;
    }
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || ticket.status === TicketStatus.REJECTED || ticket.status === TicketStatus.COMPLETED) return;
    const updates = { status: TicketStatus.REJECTED, rejectionReason: reason, completedAt: new Date().toISOString() };
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...updates } : t));
    addNotification({ type: NotificationType.STATUS_UPDATE, title: 'Traslado Cancelado',
      message: `El traslado de ${ticket.patientName} ha sido cancelado. Motivo: ${reason}`,
      ticketId: ticket.id, sede: ticket.sede,
      originArea: rawBeds.find(b => b.label === ticket.origin)?.area,
      destinationArea: rawBeds.find(b => b.label === ticket.destination)?.area,
    });
    if (ticket.spItemId) await spUpdate(ticket.spItemId, updates, ticket);
    spLogEvent(ticket.id, `Cancelado: ${reason}`);
  };

  // ── Edit ticket (Admission/Admin, only while no hostess intervention) ───────
  //
  // Bed liberation is implicit: `mergeBeds()` rebuilds bed state from active tickets
  // every render, so removing a ticket's overlay from the old destination automatically
  // returns that bed to its Gamma-level status (AVAILABLE or PREPARATION).
  //
  // Notifications:
  //   · If destination changed across areas:
  //       old-dest area → "Traslado Cancelado" (the ticket is no longer coming)
  //       new-dest area → "Nueva Solicitud"
  //       origin area   → "Modificación de Solicitud"
  //   · Otherwise, a single "Modificación de Solicitud" goes to origin + destination areas.
  const handleEditTicket = async (payload: {
    ticketId: string;
    destination: string;
    workflow: WorkflowType;
    reason?: string;
    itrSource?: string;
    observations?: string;
    isolation: boolean;
    isolationTypes: IsolationType[];
    modificationReason: string;
  }) => {
    if (!can(currentUser, 'editar_ticket')) {
      alert('Tu rol no tiene permiso para editar traslados.'); return;
    }
    const ticket = tickets.find((t: Ticket) => t.id === payload.ticketId);
    if (!ticket) return;
    if (ticket.canCancel === false) {
      alert('No se puede editar: la azafata ya intervino en este traslado.'); return;
    }
    if (!payload.modificationReason.trim()) {
      alert('El motivo de la modificación es obligatorio.'); return;
    }

    const changes: string[] = [];
    const updates: Partial<Ticket> = {};

    // ── Workflow ────────────────────────────────────────────────────────────
    if (payload.workflow !== ticket.workflow) {
      changes.push(`Escenario: ${ticket.workflow} → ${payload.workflow}`);
      updates.workflow = payload.workflow;
    }

    // ── Motivo del traslado (aplica al workflow INTERNAL — fusionado con ROOM_CHANGE) ──
    const normalizedReason = payload.workflow === WorkflowType.INTERNAL ? (payload.reason ?? '') : '';
    if ((ticket.changeReason ?? '') !== normalizedReason) {
      changes.push(`Motivo: "${ticket.changeReason ?? '—'}" → "${normalizedReason || '—'}"`);
      updates.changeReason = normalizedReason;
    }

    // ── ITR source / financier (only applies if workflow is ITR_TO_FLOOR) ───
    const normalizedItr = payload.workflow === WorkflowType.ITR_TO_FLOOR ? (payload.itrSource ?? '') : '';
    if ((ticket.itrSource ?? '') !== normalizedItr) {
      changes.push(`Financiador: "${ticket.itrSource ?? '—'}" → "${normalizedItr || '—'}"`);
      updates.itrSource = normalizedItr;
      updates.financier = normalizedItr || ticket.financier;
    }

    // ── Observations ────────────────────────────────────────────────────────
    const normalizedObs = payload.observations ?? '';
    if ((ticket.observations ?? '') !== normalizedObs) {
      changes.push(`Observaciones: "${ticket.observations ?? '—'}" → "${normalizedObs || '—'}"`);
      updates.observations = normalizedObs;
    }

    // ── Destination (most complex — bed state inferred from rawBeds) ────────
    const destChanged = payload.destination !== (ticket.destination ?? '');
    let newDestArea: Area | undefined;
    const oldDestArea: Area | undefined = ticket.destination
      ? (rawBeds.find((b: Bed) => b.label === ticket.destination)?.area as Area | undefined)
      : undefined;

    if (destChanged) {
      // Validate against merged beds (excludes beds assigned to other active tickets)
      const newDestBed = beds.find((b: Bed) => b.label === payload.destination);
      if (!newDestBed) {
        alert(`La cama ${payload.destination} no existe.`); return;
      }
      if (newDestBed.status !== BedStatus.AVAILABLE && newDestBed.status !== BedStatus.PREPARATION) {
        alert(`La cama ${payload.destination} ya no está disponible (estado: ${newDestBed.status}).`); return;
      }

      // Gamma-level status (without overlay) drives the new ticket status
      const rawDest = rawBeds.find((b: Bed) => b.label === payload.destination);
      const rawStatus = (rawDest?.status ?? newDestBed.status) as BedStatus;
      const isDestAvailable = rawStatus === BedStatus.AVAILABLE;

      updates.destination            = payload.destination;
      updates.destinationBedCode     = newDestBed.bedCode;
      updates.destinationBedStatus   = isDestAvailable ? BedStatus.ASSIGNED : BedStatus.PREPARATION;
      updates.targetBedOriginalStatus = rawStatus;
      updates.status                 = isDestAvailable ? TicketStatus.IN_TRANSIT : TicketStatus.WAITING_ROOM;

      newDestArea = newDestBed.area as Area | undefined;
      changes.push(`Destino: ${ticket.destination ?? '—'} → ${payload.destination}`);
    }

    // ── Isolation (applies globally to the patient, not just this ticket) ──
    const patientCode = ticket.patientCode?.trim();
    const currentIsoTypes = patientCode ? (isolatedPatients.get(patientCode) ?? []) : [];
    const nextIsoTypes   = payload.isolation ? payload.isolationTypes : [];
    const sortedCur  = [...currentIsoTypes].sort();
    const sortedNext = [...nextIsoTypes].sort();
    const isoChanged = sortedCur.length !== sortedNext.length
      || sortedCur.some((t: IsolationType, i: number) => t !== sortedNext[i]);
    if (isoChanged) {
      changes.push(`Aislamiento: ${currentIsoTypes.join(', ') || '—'} → ${nextIsoTypes.join(', ') || '—'}`);
      if (patientCode) {
        setIsolatedPatients((prev: Map<string, IsolationType[]>) => {
          const next = new Map(prev);
          if (nextIsoTypes.length === 0) next.delete(patientCode);
          else next.set(patientCode, nextIsoTypes);
          return next;
        });
        authFetch('/api/isolations', {
          method: nextIsoTypes.length === 0 ? 'DELETE' : 'POST',
          body: JSON.stringify({
            patientCode,
            patientName: ticket.patientName,
            userName: currentUser?.name || '',
            tipos: nextIsoTypes,
          }),
        }).catch(() => {});
      }
    }

    if (changes.length === 0) {
      alert('No hay cambios para guardar.'); return;
    }

    // ── Optimistic update + persist ─────────────────────────────────────────
    writingRef.current = true;

    // Pre-seed snapshot BEFORE the state update so the change-detection useEffect
    // never sees a transient diff when it runs for the optimistic update.
    const postKey = `${updates.status ?? ticket.status}|${updates.destination ?? ticket.destination ?? ''}`;
    prevTicketSnapshotRef.current.set(ticket.id, postKey);

    // Snapshot the original ticket so we can rollback if the server rejects the change (409).
    const ticketSnapshot: Ticket = { ...ticket };
    setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, ...updates } : t));

    // ── Local notifications for the editor ──────────────────────────────────
    const originArea = rawBeds.find((b: Bed) => b.label === ticket.origin)?.area as Area | undefined;

    if (destChanged && oldDestArea && oldDestArea !== newDestArea) {
      addNotification({
        type: NotificationType.STATUS_UPDATE, title: 'Traslado Cancelado',
        message: `${ticket.patientName}: el traslado hacia ${ticket.destination} fue cancelado (destino modificado).`,
        ticketId: ticket.id, sede: ticket.sede,
        originArea: oldDestArea, destinationArea: oldDestArea,
      });
    }
    if (destChanged && newDestArea && newDestArea !== oldDestArea) {
      addNotification({
        type: NotificationType.NEW_TICKET, title: 'Nueva Solicitud de Traslado',
        message: `${ticket.patientName}: ${ticket.origin} → ${payload.destination}`,
        ticketId: ticket.id, sede: ticket.sede,
        originArea, destinationArea: newDestArea,
      });
    }
    addNotification({
      type: NotificationType.STATUS_UPDATE, title: 'Modificación de Solicitud',
      message: `${ticket.patientName}: ${changes.join(' · ')}`,
      ticketId: ticket.id, sede: ticket.sede,
      originArea, destinationArea: newDestArea ?? oldDestArea,
    });

    // Persist ticket changes to SP
    if (ticket.spItemId) {
      try {
        const result = await spUpdate(ticket.spItemId, updates, ticket);
        if (result.conflict) {
          // Rollback the optimistic update — another admin grabbed the bed first.
          setTickets((prev: Ticket[]) => prev.map((t: Ticket) => t.id === ticket.id ? ticketSnapshot : t));
          prevTicketSnapshotRef.current.set(
            ticket.id,
            `${ticketSnapshot.status}|${ticketSnapshot.destination ?? ''}`,
          );
          const extra = result.conflict.conflictingTicketId ? ` (ticket ${result.conflict.conflictingTicketId})` : '';
          alert(`${result.conflict.error}${extra}`);
          return;
        }
      } finally {
        setTimeout(() => {
          writingRef.current = false;
          ticketsEtagRef.current = null;
          fetchTickets();
        }, 1000);
        // Segundo refetch diferido: SharePoint tiene latencia de read-after-write, así
        // que el fetch a 1s puede leer el ticket viejo. Reintentamos a ~4.5s (mismo
        // patrón que handleConsolidate) y refrescamos camas para recomputar el mapa.
        setTimeout(() => {
          ticketsEtagRef.current = null;
          fetchTickets();
          fetchBeds();
        }, 4500);
      }
    } else {
      writingRef.current = false;
    }

    // Log a single audit event summarising all changes + the user-entered reason
    spLogEvent(
      ticket.id,
      `Modificacion - ${changes.join(' | ')} - Motivo: ${payload.modificationReason}`,
    );
  };

  const handleUpdateUserAreas = (areas: Area[]) => {
    if (!currentUser) return;
    const updatedUser = { ...currentUser, assignedAreas: areas };
    setCurrentUser(updatedUser);
    localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
  };

  // ── Isolation toggle (Admission/Admin only) ────────────────────────────────
  // nextTypes:
  //   undefined / [] → remove isolation entirely
  //   [t1, t2, ...]  → set the active isolation types (replaces previous set)
  const toggleIsolation = (bedLabel: string, nextTypes?: IsolationType[]) => {
    if (!can(currentUser, 'editar_aislamiento')) return;
    const bed = beds.find(b => b.label === bedLabel);
    if (!bed?.patientCode) return;
    const code = bed.patientCode.trim();
    const prevTypes = isolatedPatients.get(code) ?? [];
    const shouldClear = !nextTypes || nextTypes.length === 0;

    // Optimistic update
    setIsolatedPatients(prev => {
      const next = new Map(prev);
      if (shouldClear) next.delete(code);
      else next.set(code, nextTypes!);
      return next;
    });

    // Persist to SharePoint
    authFetch('/api/isolations', {
      method: shouldClear ? 'DELETE' : 'POST',
      body: JSON.stringify({
        patientCode: code,
        patientName: bed.patientName || '',
        userName: currentUser?.name || '',
        tipos: shouldClear ? [] : nextTypes,
      }),
    }).catch(() => {
      // Rollback on error
      setIsolatedPatients(prev => {
        const next = new Map(prev);
        if (prevTypes.length) next.set(code, prevTypes);
        else next.delete(code);
        return next;
      });
    });
  };

  // Fetch isolations on login
  const fetchIsolations = async () => {
    try {
      const res = await authFetch('/api/isolations');
      if (!res.ok) return;
      const data = await res.json();
      const validTypes = Object.values(IsolationType) as IsolationType[];
      const map = new Map<string, IsolationType[]>();
      for (const i of (data.isolations ?? [])) {
        const raw: string[] = Array.isArray(i.tipos)
          ? i.tipos
          : String(i.tipo ?? '').split(';');
        const tipos = raw
          .map((t: string) => String(t).trim())
          .filter((t: string): t is IsolationType => validTypes.includes(t as IsolationType));
        if (tipos.length) map.set(String(i.patientCode).trim(), tipos as IsolationType[]);
      }
      setIsolatedPatients(map);
    } catch { /* silent */ }
  };

  // Manual full refresh — invalidates caches and refetches everything.
  const refreshAll = useCallback(async () => {
    bedsEtagRef.current = null;
    ticketsEtagRef.current = null;
    await Promise.all([fetchBeds(true), fetchTickets(), fetchIsolations()]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchBeds, fetchTickets]);

  // El server ahora filtra Status_N='Enviada' (no es necesario filtrar en cliente).
  // Solo se aplica el corte por "más de 20 minutos" para decidir qué entra al banner.
  const checkUnreadNotifications = useCallback(async () => {
    try {
      const r = await authFetch('/api/notifications');
      if (!r.ok) return;
      const data = await r.json();
      const twentyMinAgo = Date.now() - 20 * 60 * 1000;
      const old = (data.notifications ?? [])
        // Defensivo: el server ya filtra Status_N='Enviada', pero si el filtro fallara
        // (lista grande / columna no indexada) igual descartamos las ya leídas en cliente.
        .filter((n: any) => n.status === 'Enviada' && new Date(n.fecha).getTime() < twentyMinAgo);
      setUnreadSpNotifications(old);
    } catch (err) {
      console.error('[notifications] check failed:', err);
    }
  }, [authFetch]);

  // Historial 24h desde SP (10.Notificaciones) para la campanita. Persiste tras refresh,
  // a diferencia de las notis en vivo (generadas por polling, se pierden al recargar).
  const fetchNotificationHistory = useCallback(async () => {
    try {
      const r = await authFetch('/api/notifications?window=24h');
      if (!r.ok) return;
      const data = await r.json();
      const mapped: Notification[] = (data.notifications ?? []).map((n: any) => ({
        id: String(n.id),
        type: (n.type || NotificationType.SYSTEM) as NotificationType,
        title: String(n.title ?? ''),
        message: String(n.message ?? ''),
        timestamp: formatDateTime(String(n.fecha ?? '')),
        isRead: String(n.status) === 'Leida',
        ticketId: n.ticketId ? String(n.ticketId) : undefined,
        sede: (currentUser?.sede ?? SedeType.HPR) as SedeType,
      }));
      setNotificationHistory(mapped);
    } catch (err) {
      console.error('[notifications] history fetch failed:', err);
    }
  }, [authFetch, currentUser?.sede]);

  // Local notification IDs are prefixed with "NOTIF-" (generated client-side).
  // SharePoint notifications carry the SP item ID (numeric string).
  // Only SP IDs should hit the PATCH endpoint; local-only ones just flip state.
  const isSpNotificationId = (id: string) => !!id && !id.startsWith('NOTIF-');

  // Le pide al service worker que cierre las notifs del SO (lock screen / bandeja)
  // del ticket. Sin ticketId → cierra todas (caso "marcar todas como leídas").
  // Estilo WhatsApp: leer el hilo limpia sus notifs del celular.
  const closeOsNotifications = useCallback((ticketId?: string) => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready
      .then(reg => reg.active?.postMessage({
        type: 'CLOSE_NOTIFICATIONS',
        ticketId: ticketId ?? '',
      }))
      .catch(() => {});
  }, []);

  // Marca una notif SP por (ticketId, type) — sin necesidad de conocer el spItemId.
  // Útil para:
  //   · click en notif local del dropdown (que tiene ticketId+type pero id local)
  //   · tap en push notification (el SW pasa ticketId+type al cliente)
  const markNotificationByEvent = useCallback(async (ticketId: string, type: string) => {
    if (!ticketId || !type) return;
    try {
      const r = await authFetch('/api/notifications', {
        method: 'PATCH',
        body: JSON.stringify({ ticketId, type }),
      });
      if (!r.ok) {
        console.error('[notifications] mark-by-event failed', r.status, await r.text().catch(() => ''));
      }
      // Refrescar el banner: si la marcamos OK, desaparece; si falló, sigue como estaba.
      checkUnreadNotifications();
    } catch (err) {
      console.error('[notifications] mark-by-event error', err);
    }
    // Cerrar la(s) notif(s) del SO de este ticket aunque el PATCH haya fallado:
    // el objetivo acá es limpiar el lock screen, independiente del estado en SP.
    closeOsNotifications(ticketId);
  }, [authFetch, checkUnreadNotifications, closeOsNotifications]);

  // Marca una notif individual. Acepta:
  //   · Notification completa (con id, ticketId, type) — preferido
  //   · string (id) — backwards-compatible
  // Optimistic update local; si el PATCH a SP falla, refetch para restaurar.
  const handleMarkNotificationRead = async (notifOrId: Notification | string) => {
    const isObject = typeof notifOrId !== 'string';
    const id = isObject ? notifOrId.id : notifOrId;

    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    setNotificationHistory(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));

    if (isSpNotificationId(id)) {
      // Camino legacy: marcar por id explícito (notifs del banner SP).
      setUnreadSpNotifications(prev => prev.filter(n => n.id !== id));
      try {
        const r = await authFetch('/api/notifications', {
          method: 'PATCH',
          body: JSON.stringify({ notificationId: id }),
        });
        if (!r.ok) {
          console.error('[notifications] PATCH failed', r.status, await r.text().catch(() => ''));
          checkUnreadNotifications();
        }
      } catch (err) {
        console.error('[notifications] PATCH error:', err);
        checkUnreadNotifications();
      }
      // Cerrar la notif del SO de este ticket.
      if (isObject && notifOrId.ticketId) {
        closeOsNotifications(notifOrId.ticketId);
      }
      return;
    }

    // Notif local (NOTIF-*): linkear con su contrapartida SP por (ticketId, type).
    // Requiere que el caller pase el objeto completo — si solo pasó id, no hay forma.
    if (isObject && notifOrId.ticketId && notifOrId.type) {
      markNotificationByEvent(notifOrId.ticketId, notifOrId.type);
    }
  };

  // Marca TODAS las notifs Enviada del user en SP (no solo el top-50 visible del
  // banner) — sino, con backlog grande (típico del Admin que recibe todo) el banner
  // nunca se vaciaba. El server hace lookup paginado + PATCH masivo; si quedó backlog
  // (`remaining`), repetimos. Optimistic local; refetch final para sincronizar.
  const handleMarkAllNotificationsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setNotificationHistory(prev => prev.map(n => ({ ...n, isRead: true })));
    // Limpiar TODAS las notifs del SO (lock screen / bandeja).
    closeOsNotifications();
    // Optimistic: limpiamos el banner. Si falla, el refetch lo restaura.
    setUnreadSpNotifications([]);

    try {
      // El backlog puede superar el tope por llamada → repetir mientras queden.
      for (let i = 0; i < 5; i++) {
        const r = await authFetch('/api/notifications', {
          method: 'PATCH',
          body: JSON.stringify({ markAllForUser: true }),
        });
        if (!r.ok) {
          console.error(`[notifications] markAll failed: ${r.status} ${await r.text().catch(() => '')}`);
          break;
        }
        const data = await r.json().catch(() => ({} as any));
        if (!data?.remaining) break; // no quedó backlog
      }
    } catch (err) {
      console.error('[notifications] markAll error:', err);
    } finally {
      // Sincronizar el banner con la verdad de SP (lo que sí se marcó desaparece).
      checkUnreadNotifications();
    }
  };

  // Al abrir la campanita: refrescar el historial 24h y marcar todo como leído.
  // El badge se limpia, pero los ítems quedan visibles (en gris) en el historial.
  const handleOpenNotifications = async () => {
    await fetchNotificationHistory();
    handleMarkAllNotificationsRead();
  };

  const handleDismissToast = (id: string) => {
    // Find the notification associated with this toast and mark it as read.
    // Pasamos el objeto completo para que mark-by-event funcione en notifs locales.
    const toast = toasts.find(t => t.id === id);
    if (toast?.notification) {
      handleMarkNotificationRead(toast.notification);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // ── Unread SP notifications check (for banner) ────────────────────────────
  const [unreadSpNotifications, setUnreadSpNotifications] = useState<{ id: string; title: string; message: string; fecha: string }[]>([]);

  useEffect(() => {
    if (!token || !currentUser) return;
    checkUnreadNotifications();
    fetchNotificationHistory();
    const interval = setInterval(() => {
      checkUnreadNotifications();
      fetchNotificationHistory();
    }, 30_000);
    return () => clearInterval(interval);
  }, [token, currentUser, checkUnreadNotifications, fetchNotificationHistory]);

  // ── Revalidación periódica de ubicación (cada 1 min) ─────────────────────────
  // Reemplaza la validación per-request (que generaba kicks por flake de
  // IP/multi-WAN/geo). El contrato sigue: usuario que se va del hospital es
  // expulsado, con ventana de máximo ~2 min (60s cache server + 60s interval).
  //
  // Triggers:
  //   · mount inicial (no esperar el primer tick del interval)
  //   · setInterval cada 60s
  //
  // Decisión: NO usamos `visibilitychange` ni `focus` como triggers porque en
  // móvil esos eventos se disparan demasiado (cada vez que aparece el teclado,
  // scroll fuerte, notificación, etc.) y cada disparo terminaba pidiendo geo →
  // prompt del browser → mala UX. El interval de 60s es suficiente para detectar
  // que un usuario se fue (combinado con cache server-side de 60s, ventana máxima
  // de kick = ~2 min).
  //
  // Cache cliente (geoCacheRef): la posición se reusa por 30 min sin volver a
  // llamar a navigator.geolocation, así no acumulamos prompts de permiso en mobile.
  //
  // Fail-open en errores de red: solo patea cuando el server responde
  // explícitamente allowed:false.
  useEffect(() => {
    if (!token || !currentUser || currentUser.sede === 'SUMAR' || currentUser.bypassLocationCheck) return;

    let cancelled = false;
    const REVALIDATE_MS = 60 * 1000;

    const postValidate = (coords: GeoCoords | null) =>
      fetch('/api/validate-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sede: currentUser.sede, lat: coords?.lat, lng: coords?.lng }),
      }).then(r => r.json().catch(() => ({} as any)));

    const revalidate = async () => {
      try {
        // IP-first: validamos con la geo cacheada (o sin geo) SIN pedir permiso.
        let coords = geoNoPrompt(geoCacheRef);
        let data = await postValidate(coords);
        if (cancelled) return;

        // Solo si la IP no alcanzó y falta geo → pedimos GPS una vez y reintentamos,
        // PERO solo si el permiso ya está concedido (getCurrentPosition es silencioso).
        // Si está en 'prompt'/'denied'/'unknown', NO disparamos un prompt sorpresa estando
        // en background: fail-open (no expulsamos). La validación estricta ya ocurrió en el
        // login; acá esperamos a que el user interactúe o a que la IP vuelva a alcanzar.
        if (data?.allowed === false && data?.method === 'geo_unavailable' && !coords) {
          const perm = await geoPermissionState();
          if (cancelled) return;
          if (perm !== 'granted') return; // no prompt en background, no logout
          coords = await requestFreshGeo(geoCacheRef);
          if (cancelled) return;
          if (coords) { data = await postValidate(coords); if (cancelled) return; }
        }

        if (data?.allowed === false) {
          setLoginError(data?.reason ?? 'Ubicación no autorizada — re-ingresá desde una red autorizada.');
          handleLogout();
        }
      } catch {
        // Fail-open: errores de red NO patean al usuario.
      }
    };

    revalidate(); // chequeo inmediato al mount

    const interval = setInterval(revalidate, REVALIDATE_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [token, currentUser?.id, currentUser?.sede, currentUser?.bypassLocationCheck, handleLogout]);

  // ── Push tap handling: marca como leída la notif SP correspondiente ──────────
  // El SW dispara dos rutas según si la app estaba abierta:
  //   1) Abierta → postMessage {kind:'notification-clicked', ticketId, type}
  //   2) Cerrada → openWindow('/?notifTicketId=X&notifType=Y')
  // Ambas terminan en markNotificationByEvent.
  useEffect(() => {
    if (!currentUser || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (!d || d.kind !== 'notification-clicked') return;
      const ticketId = String(d.ticketId ?? '');
      const type     = String(d.type ?? '');
      if (ticketId && type) markNotificationByEvent(ticketId, type);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [currentUser, markNotificationByEvent]);

  // Si la app se abrió desde una push (cliente estaba cerrado), los query params
  // notifTicketId / notifType disparan el mark-by-event una sola vez y se limpian
  // de la URL para que no se re-disparen al refrescar.
  useEffect(() => {
    if (!currentUser || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ticketId = params.get('notifTicketId');
    const type     = params.get('notifType');
    if (!ticketId || !type) return;
    markNotificationByEvent(ticketId, type);
    params.delete('notifTicketId');
    params.delete('notifType');
    const rest = params.toString();
    window.history.replaceState(null, '', rest ? `${window.location.pathname}?${rest}` : window.location.pathname);
  }, [currentUser, markNotificationByEvent]);

  return {
    state: {
      currentUser, currentView, activeRole, sortConfig, requestsSearchTerm,
      notifications, filteredNotifications, bellNotifications, toasts, tickets,
      filteredTickets: filteredTickets.sorted,
      historyTickets: filteredTickets.baseFiltered,
      loginEmail, loginPass, loginError, loginLoading, bedsLoading, bedsError, ticketActionLoading, beds,
      tokenExpirySoon, tokenMinutesLeft,
      isolatedBeds,
      isolatedPatients,
      unreadSpNotifications,
    },
    actions: {
      setCurrentUser, setCurrentView, setActiveRole, setSortConfig, setRequestsSearchTerm,
      setLoginEmail, setLoginPass,
      handleLogin, handleLogout,
      handleCreateTicket, handleRoomReady, handleConfirmReception, handleConsolidate,
      fetchBeds, enrichBed, refreshAll,
      handleUpdateUserAreas, handleMarkNotificationRead, handleMarkAllNotificationsRead, handleOpenNotifications, handleDismissToast,
      handleStartTransport,
      handleRejectTicket,
      handleEditTicket,
      toggleIsolation,
      handleValidateTicket:    (_id: string) => {},
      handleAssignBedAction:   (_id: string, _bed: string) => {},
      handleHousekeepingAction:(_id: string) => {},
      handleCompleteTransport: (_id: string) => {},
    },
  };
};
