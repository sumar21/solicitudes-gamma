
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  WorkflowType, Role, SedeType, Ticket, TicketStatus, User, Area,
  Notification, NotificationType, ViewMode, SortConfig, Bed, BedStatus, IsolationType,
} from '../types';
import { MOCK_TICKETS } from '../lib/constants';

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
function mergeBeds(gammaBeds: Bed[], activeTickets: Ticket[]): Bed[] {
  const result = gammaBeds.map(b => ({ ...b }));
  for (const ticket of activeTickets) {
    const origin = result.find(b => b.label === ticket.origin);
    const dest   = ticket.destination ? result.find(b => b.label === ticket.destination) : null;
    switch (ticket.status) {
      case TicketStatus.WAITING_ROOM:
        if (dest) dest.status = BedStatus.PREPARATION;
        break;
      case TicketStatus.IN_TRANSIT:
      case TicketStatus.IN_TRANSPORT:
        if (dest) dest.status = BedStatus.ASSIGNED;
        break;
      case TicketStatus.WAITING_CONSOLIDATION:
        if (dest)   { dest.status = BedStatus.OCCUPIED;     dest.patientName = ticket.patientName; }
        if (origin) { origin.status = BedStatus.PREPARATION; origin.patientName = undefined; }
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
const WARNING_MINUTES     = 15;
const TOKEN_KEY           = 'mediflow_token';
const USER_KEY            = 'mediflow_user';

export const useHospitalState = () => {

  // ── Session init ─────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(USER_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  const [currentView, setCurrentView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(USER_KEY);
    if (saved) {
      const user = JSON.parse(saved);
      if (user.role === Role.HOSTESS) return 'REQUESTS';
      // Catering y READ_ONLY solo acceden al Mapa de Camas — arrancar allí
      // tras recargar la app con sesión persistida (si no, quedan en HOME
      // que no les renderiza nada y verían pantalla en blanco).
      if (user.role === Role.CATERING || user.role === Role.READ_ONLY) return 'BEDS';
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
  const authFetch = useCallback((url: string, options?: RequestInit): Promise<Response> => {
    const t = localStorage.getItem(TOKEN_KEY);
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...(options?.headers ?? {}),
      },
    });
  }, []);

  // ── App state ─────────────────────────────────────────────────────────────────
  const [sortConfig, setSortConfig]                = useState<SortConfig>({ key: 'createdAt', direction: 'desc' });
  const [requestsSearchTerm, setRequestsSearchTerm]= useState('');
  const [notifications, setNotifications]          = useState<Notification[]>([]);
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
  const [rawBeds, setRawBeds]                      = useState<Bed[]>([]);
  const [tickets, setTickets]                      = useState<Ticket[]>(MOCK_TICKETS);
  // Isolation: stored by patientCode, derived to bed labels via beds data
  // A patient may have multiple isolation types active at once (e.g. Covid + Contacto).
  const [isolatedPatients, setIsolatedPatients]    = useState<Map<string, IsolationType[]>>(new Map()); // patientCode → isolation types

  const beds = useMemo(() => {
    const active = tickets.filter(t => t.status !== TicketStatus.COMPLETED && t.status !== TicketStatus.REJECTED);
    return mergeBeds(rawBeds, active);
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

    // Check if this notification is relevant for the current user's assigned areas
    const isRelevant = (originArea?: Area, destArea?: Area) => {
      if (currentUser.role !== Role.HOSTESS) return true; // admin/admission see all
      if (!currentUser.assignedAreas?.length) return false;
      return (originArea && currentUser.assignedAreas.includes(originArea)) ||
             (destArea   && currentUser.assignedAreas.includes(destArea));
    };

    const newNotifs: Notification[] = [];

    for (const t of tickets) {
      const prevKey = prev.get(t.id);

      // Skip tickets the current user created (they already got a local notification)
      if (t.createdById && String(t.createdById) === String(currentUser.id)) continue;

      // Skip tickets that are already closed — no need to notify about old/finished tickets
      if (t.status === TicketStatus.COMPLETED || t.status === TicketStatus.REJECTED) continue;

      const originArea = areaOf(t.origin);
      const destArea   = areaOf(t.destination);

      if (prevKey === undefined) {
        // ── New ticket appeared ─────────────────────────────────────────
        const notif: Notification = {
          id: `NOTIF-POLL-${t.id}`, isRead: false,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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

      // Create toasts only for relevant notifications (filtered by area)
      const relevantToasts = newNotifs
        .filter(n => isRelevant(n.originArea, n.destinationArea))
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
      const r = await authFetch('/api/tickets', { method: 'POST', body: JSON.stringify(ticket) });
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

      // Hostess y Catering tienen áreas asignadas en el campo PisosAzafata_u de SP.
      // Convertir el string semicolon-separated a array de Area en el frontend.
      // Sin esto, el filtro inicial de BedsView no se aplica para Catering y la
      // suscripción push se registra sin áreas → recibiría notifs de todo el hospital.
      if (
        (user.role === Role.HOSTESS || user.role === Role.CATERING) &&
        (data.user as any).assignedFloors
      ) {
        const floorsStr = String((data.user as any).assignedFloors);
        const areaValues = Object.values(Area) as string[];
        user.assignedAreas = floorsStr
          .split(';')
          .map(s => s.trim())
          .filter(s => areaValues.includes(s)) as Area[];
      }

      // ── Location validation (skip for SUMAR superusers) ──────────────────
      if (user.sede !== 'SUMAR') {
        let userLat: number | undefined;
        let userLng: number | undefined;
        try {
          const coords = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
            if (!navigator.geolocation) { resolve(null); return; }
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
              () => resolve(null),
              // 15s gives users enough time to accept the browser's permission prompt
              // without timing out when they're actually on-site.
              { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
            );
          });
          if (coords) { userLat = coords.lat; userLng = coords.lng; }
        } catch { /* geo unavailable, IP check will be used */ }

        try {
          const locRes = await fetch('/api/validate-location', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${data.token}`,
            },
            body: JSON.stringify({ sede: user.sede, lat: userLat, lng: userLng }),
          });
          const locData = await locRes.json();
          if (locData.allowed === false) {
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
      // Landing view depends on role.
      //   HOSTESS        → Operativa (sus tickets activos)
      //   CATERING / R/O → Mapa de Camas (única vista que ven)
      //   otros          → Monitor
      const landingView =
        user.role === Role.HOSTESS ? 'REQUESTS'
        : (user.role === Role.CATERING || user.role === Role.READ_ONLY) ? 'BEDS'
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
            subscribeToPush(data.token, user.id, user.role, user.assignedAreas ?? [], user.sede);
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

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setCurrentUser(null);
    setExpirySoon(false);
    setMinutesLeft(0);
    bedsEtagRef.current = null;
  }, []);

  // ── Filtered data ─────────────────────────────────────────────────────────────
  const filteredNotifications = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role !== Role.HOSTESS) return notifications;
    return notifications.filter(n => {
      const isOrigin = n.originArea && currentUser.assignedAreas?.includes(n.originArea);
      const isDest   = n.destinationArea && currentUser.assignedAreas?.includes(n.destinationArea);
      return isOrigin || isDest;
    });
  }, [notifications, currentUser]);

  const filteredTickets = useMemo(() => {
    let result = tickets;
    if (currentUser?.sede !== SedeType.SUMAR)
      result = result.filter(t => t.sede === currentUser?.sede);

    if (currentUser?.role === Role.HOSTESS && currentUser.assignedAreas?.length) {
      const allAreas = new Set(Object.values(Area) as string[]);
      const hasAll = currentUser.assignedAreas.length >= allAreas.size - 1; // 9 of 10 = effectively all
      // Only filter if azafata has a subset of areas AND beds are loaded to resolve areas
      if (!hasAll && beds.length > 0) {
        // Build a map from area label → set of bed labels for fast lookup
        const areaByLabel = new Map<string, Area>();
        for (const b of beds) if (b.area) areaByLabel.set(b.label, b.area);

        result = result.filter(t => {
          // Try matching by label first, then by area prefix in the ticket origin/destination
          const originArea = areaByLabel.get(t.origin) ?? beds.find(b => t.origin?.includes(b.area))?.area;
          const destArea   = t.destination ? (areaByLabel.get(t.destination) ?? beds.find(b => t.destination?.includes(b.area))?.area) : undefined;
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
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) {
      alert('Solo Admisión o Admin pueden crear solicitudes.'); return;
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
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) return;

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
    const updates = { status: TicketStatus.IN_TRANSPORT, transportStartedAt: now, intervenedByHostess: 'SI' } as const;
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
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) {
      alert('Solo Admisión o Admin pueden consolidar en PROGAL.'); return;
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
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) {
      alert('Solo Admisión o Admin pueden cancelar traslados.'); return;
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
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) {
      alert('Solo Admisión o Admin pueden editar traslados.'); return;
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
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) return;
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

  const checkUnreadNotifications = useCallback(async () => {
    try {
      const r = await authFetch('/api/notifications');
      if (!r.ok) return;
      const data = await r.json();
      const unread = (data.notifications ?? []).filter((n: any) => n.status === 'Enviada');
      const twentyMinAgo = Date.now() - 20 * 60 * 1000;
      const old = unread.filter((n: any) => new Date(n.fecha).getTime() < twentyMinAgo);
      setUnreadSpNotifications(old);
    } catch { /* silent */ }
  }, [authFetch]);

  // Local notification IDs are prefixed with "NOTIF-" (generated client-side).
  // SharePoint notifications carry the SP item ID (numeric string).
  // Only SP IDs should hit the PATCH endpoint; local-only ones just flip state.
  const isSpNotificationId = (id: string) => !!id && !id.startsWith('NOTIF-');

  const handleMarkNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    if (!isSpNotificationId(id)) return; // local-only notification — nothing to persist
    authFetch('/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ notificationId: id }),
    }).then(() => setTimeout(checkUnreadNotifications, 1500)).catch(() => {});
  };
  const handleMarkAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadSpNotifications([]); // clear immediately for instant UI feedback
    // Mark all in SP, then verify after delay
    Promise.all(
      unreadSpNotifications
        .filter((n: { id: string }) => isSpNotificationId(n.id))
        .map((n: { id: string }) =>
          authFetch('/api/notifications', {
            method: 'PATCH',
            body: JSON.stringify({ notificationId: n.id }),
          }).catch(() => {})
        )
    ).then(() => setTimeout(checkUnreadNotifications, 1500));
  };
  const handleDismissToast = (id: string) => {
    // Find the notification associated with this toast and mark it as read
    const toast = toasts.find(t => t.id === id);
    if (toast?.notification) {
      handleMarkNotificationRead(toast.notification.id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // ── Unread SP notifications check (for banner) ────────────────────────────
  const [unreadSpNotifications, setUnreadSpNotifications] = useState<{ id: string; title: string; message: string; fecha: string }[]>([]);

  useEffect(() => {
    if (!token || !currentUser) return;
    checkUnreadNotifications();
    const interval = setInterval(checkUnreadNotifications, 30_000);
    return () => clearInterval(interval);
  }, [token, currentUser, checkUnreadNotifications]);

  return {
    state: {
      currentUser, currentView, activeRole, sortConfig, requestsSearchTerm,
      notifications, filteredNotifications, toasts, tickets,
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
      handleUpdateUserAreas, handleMarkNotificationRead, handleMarkAllNotificationsRead, handleDismissToast,
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
