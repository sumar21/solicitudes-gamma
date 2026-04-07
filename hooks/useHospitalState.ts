
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  WorkflowType, Role, SedeType, Ticket, TicketStatus, User, Area,
  Notification, NotificationType, ViewMode, SortConfig, Bed, BedStatus,
} from '../types';
import { MOCK_TICKETS, MOCK_BEDS } from '../lib/constants';

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
const POLL_BEDS_MS        = 60_000;  // beds: poll every 60s (Gamma API, changes less)

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
    const saved = sessionStorage.getItem(USER_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  const [currentView, setCurrentView] = useState<ViewMode>(() => {
    const saved = sessionStorage.getItem(USER_KEY);
    if (saved) {
      const user = JSON.parse(saved);
      if (user.role === Role.HOSTESS) return 'REQUESTS';
    }
    return 'HOME';
  });

  const [activeRole, setActiveRole] = useState<Role>(() => {
    const saved = sessionStorage.getItem(USER_KEY);
    return saved ? (JSON.parse(saved).role as Role) : Role.ADMISSION;
  });

  // ── Token state ───────────────────────────────────────────────────────────────
  const [token, setToken]                 = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [tokenExpirySoon, setExpirySoon]  = useState(false);
  const [tokenMinutesLeft, setMinutesLeft]= useState(() => getTokenMinutesLeft(sessionStorage.getItem(TOKEN_KEY)));

  // Check token expiry every minute
  useEffect(() => {
    const check = () => {
      const t    = sessionStorage.getItem(TOKEN_KEY);
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
    const t = sessionStorage.getItem(TOKEN_KEY);
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
  const soundCooldownRef = React.useRef(false); // prevent sound spam
  const [rawBeds, setRawBeds]                      = useState<Bed[]>([]);
  const [tickets, setTickets]                      = useState<Ticket[]>(MOCK_TICKETS);
  // Isolation: stored by patientCode, derived to bed labels via beds data
  const [isolatedPatients, setIsolatedPatients]    = useState<Set<string>>(new Set()); // patientCodes with active isolation

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
  const fetchBeds = useCallback(async () => {
    setBedsLoading(true);
    setBedsError(null);
    try {
      console.log('[fetchBeds] GET /api/beds ...');
      const r = await authFetch('/api/beds');
      console.log('[fetchBeds] status:', r.status);
      if (r.status === 401) { handleLogout(); return; }
      const text = await r.text();
      console.log('[fetchBeds] body:', text.slice(0, 500));
      if (!r.ok) {
        setBedsError(`HTTP ${r.status} — ${text.slice(0, 200)}`);
        setRawBeds(MOCK_BEDS);
        return;
      }
      let data: { beds: Bed[]; error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        setBedsError(`Respuesta no es JSON válido — ${text.slice(0, 200)}`);
        setRawBeds(MOCK_BEDS);
        return;
      }
      if (data.error) { setBedsError(`API error: ${data.error}`); setRawBeds(MOCK_BEDS); return; }
      if (Array.isArray(data.beds) && data.beds.length > 0) {
        console.log('[fetchBeds] camas recibidas:', data.beds.length);
        setBedsError(null);
        setRawBeds(data.beds);
      } else {
        setBedsError(`API devolvió ${data.beds?.length ?? 0} camas (array vacío o nulo)`);
        setRawBeds(MOCK_BEDS);
      }
    } catch (e: any) {
      console.error('[fetchBeds] error:', e);
      setBedsError(`Fetch falló: ${e?.message || e}`);
      setRawBeds(MOCK_BEDS);
    }
    finally { setBedsLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const ticketPoll = setInterval(fetchTickets, POLL_TICKETS_MS);
    const bedPoll    = setInterval(fetchBeds, POLL_BEDS_MS);
    return () => { clearInterval(ticketPoll); clearInterval(bedPoll); };
  }, [token, fetchBeds, fetchTickets]);

  // ── Change detection — generate notifications from polling updates ───────────
  useEffect(() => {
    if (!currentUser || writingRef.current) return;

    const prev = prevTicketSnapshotRef.current;
    const next = new Map(tickets.map(t => [t.id, t.status]));

    // Skip first load — don't spam notifications for existing tickets
    if (!initialLoadDoneRef.current) {
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
      const prevStatus = prev.get(t.id);

      // Skip tickets the current user created (they already got a local notification)
      if (t.createdById && String(t.createdById) === String(currentUser.id)) continue;

      // Skip tickets that are already closed — no need to notify about old/finished tickets
      if (t.status === TicketStatus.COMPLETED || t.status === TicketStatus.REJECTED) continue;

      const originArea = areaOf(t.origin);
      const destArea   = areaOf(t.destination);

      if (prevStatus === undefined) {
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
      } else if (prevStatus !== t.status) {
        // ── Status changed ──────────────────────────────────────────────
        const label = statusChangeLabel(prevStatus, t.status);
        if (label) {
          const notif: Notification = {
            id: `NOTIF-POLL-${t.id}-${t.status}`, isRead: false,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: NotificationType.STATUS_UPDATE,
            title: label.title,
            message: `${t.patientName}: ${t.origin} → ${t.destination ?? '?'}`,
            ticketId: t.id, sede: t.sede,
            originArea, destinationArea: destArea,
          };
          newNotifs.push(notif);
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
  const spCreate = async (ticket: Ticket): Promise<string | undefined> => {
    try {
      const r = await authFetch('/api/tickets', { method: 'POST', body: JSON.stringify(ticket) });
      if (!r.ok) return undefined;
      const { spItemId } = await r.json();
      return spItemId as string;
    } catch { return undefined; }
  };

  const spUpdate = async (spItemId: string, updates: Partial<Ticket>): Promise<void> => {
    try {
      await authFetch('/api/tickets', {
        method: 'PATCH',
        body:   JSON.stringify({ spItemId, ...updates }),
      });
    } catch { /* next poll will reconcile */ }
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
      if (!res.ok) { setLoginError(data.error ?? 'Credenciales incorrectas'); return; }

      const user: User = data.user;

      // If azafata, parse assignedFloors (semicolon-separated) into assignedAreas
      if (user.role === Role.HOSTESS && (data.user as any).assignedFloors) {
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
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
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

      sessionStorage.setItem(TOKEN_KEY, data.token);
      sessionStorage.setItem(USER_KEY,  JSON.stringify(user));
      setToken(data.token);
      setCurrentUser(user);
      setActiveRole(user.role as Role);
      setCurrentView(user.role === Role.HOSTESS ? 'REQUESTS' : 'HOME');

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
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setCurrentUser(null);
    setExpirySoon(false);
    setMinutesLeft(0);
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

  const handleCreateTicket = async (data: Partial<Ticket> & { isolation?: boolean }) => {
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) {
      alert('Solo Admisión o Admin pueden crear solicitudes.'); return;
    }
    setTicketActionLoading(true);
    writingRef.current = true;

    // If isolation requested AND patient not already isolated, activate it
    if (data.isolation) {
      const sourceBed = beds.find(b => b.label === data.origin);
      if (sourceBed?.patientCode && !isolatedPatients.has(sourceBed.patientCode)) {
        setIsolatedPatients(prev => new Set(prev).add(sourceBed.patientCode!));
        authFetch('/api/isolations', {
          method: 'POST',
          body: JSON.stringify({
            patientCode: sourceBed.patientCode,
            patientName: sourceBed.patientName || data.patientName || '',
            userName: currentUser?.name || '',
          }),
        }).catch(() => {});
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
      changeReason:            data.changeReason,
      observations:            data.observations,
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

    const spItemId = await spCreate(newTicket);
    if (spItemId) setTickets(prev => prev.map(t => t.id === newTicket.id ? { ...t, spItemId } : t));
    spLogEvent(newTicket.id, 'Solicitud Creada');
  };

  const handleRoomReady = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket?.destination || ticket.status === TicketStatus.IN_TRANSIT) return;
    const now     = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updates = { status: TicketStatus.IN_TRANSIT, cleaningDoneAt: now, destinationBedStatus: BedStatus.ASSIGNED } as const;
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...updates } : t));
    addNotification({ type: NotificationType.STATUS_UPDATE, title: 'Habitación Lista',
      message: `La habitación ${ticket.destination} está lista. ${ticket.patientName} puede ser trasladado.`,
      ticketId: ticket.id, sede: ticket.sede,
      originArea: rawBeds.find(b => b.label === ticket.origin)?.area,
      destinationArea: rawBeds.find(b => b.label === ticket.destination)?.area,
    });
    if (ticket.spItemId) spUpdate(ticket.spItemId, updates);
    spLogEvent(ticket.id, 'Habitacion Preparada');
  };

  const handleStartTransport = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || ticket.status === TicketStatus.IN_TRANSPORT) return;
    const now     = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updates = { status: TicketStatus.IN_TRANSPORT, transportStartedAt: now } as const;
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...updates } : t));
    addNotification({ type: NotificationType.STATUS_UPDATE, title: 'Traslado en Curso',
      message: `${ticket.patientName} está en camino hacia ${ticket.destination}.`,
      ticketId: ticket.id, sede: ticket.sede,
      originArea: rawBeds.find(b => b.label === ticket.origin)?.area,
      destinationArea: rawBeds.find(b => b.label === ticket.destination)?.area,
    });
    if (ticket.spItemId) spUpdate(ticket.spItemId, updates);
    spLogEvent(ticket.id, 'Inicio Traslado');
  };

  const handleConfirmReception = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket?.destination) return;
    if (ticket.status !== TicketStatus.IN_TRANSPORT && ticket.status !== TicketStatus.IN_TRANSIT) return;
    const now     = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updates = { status: TicketStatus.WAITING_CONSOLIDATION, receptionConfirmedAt: now, destinationBedStatus: BedStatus.OCCUPIED } as const;
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, ...updates } : t));
    addNotification({ type: NotificationType.STATUS_UPDATE, title: 'Recepción Confirmada',
      message: `${ticket.patientName} ha sido recibido en ${ticket.destination}. Pendiente consolidar en PROGAL.`,
      ticketId: ticket.id, sede: ticket.sede,
      originArea: rawBeds.find(b => b.label === ticket.origin)?.area,
      destinationArea: rawBeds.find(b => b.label === ticket.destination)?.area,
    });
    if (ticket.spItemId) spUpdate(ticket.spItemId, updates);
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
    if (ticket.spItemId) await spUpdate(ticket.spItemId, updates);
    spLogEvent(ticket.id, 'Consolidado Progal');
    // Refresh beds immediately + again after a few seconds (Gamma/PROGAL may take a moment)
    fetchBeds();
    ticketsEtagRef.current = null;
    fetchTickets();
    setTimeout(() => { fetchBeds(); fetchTickets(); }, 5000);
  };

  const handleUpdateUserAreas = (areas: Area[]) => {
    if (!currentUser) return;
    const updatedUser = { ...currentUser, assignedAreas: areas };
    setCurrentUser(updatedUser);
    sessionStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
  };

  // ── Isolation toggle (Admission/Admin only) ────────────────────────────────
  const toggleIsolation = (bedLabel: string) => {
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) return;
    const bed = beds.find(b => b.label === bedLabel);
    if (!bed?.patientCode) return;
    const code = bed.patientCode;
    const isActive = isolatedPatients.has(code);

    // Optimistic update
    setIsolatedPatients(prev => {
      const next = new Set(prev);
      isActive ? next.delete(code) : next.add(code);
      return next;
    });

    // Persist to SharePoint
    authFetch('/api/isolations', {
      method: isActive ? 'DELETE' : 'POST',
      body: JSON.stringify({
        patientCode: code,
        patientName: bed.patientName || '',
        userName: currentUser?.name || '',
      }),
    }).catch(() => {
      // Rollback on error
      setIsolatedPatients(prev => {
        const next = new Set(prev);
        isActive ? next.add(code) : next.delete(code);
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
      const codes = new Set<string>((data.isolations ?? []).map((i: any) => i.patientCode));
      setIsolatedPatients(codes);
    } catch { /* silent */ }
  };

  const handleMarkNotificationRead      = (id: string) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  const handleMarkAllNotificationsRead  = ()            => setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  const handleDismissToast              = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

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
    },
    actions: {
      setCurrentUser, setCurrentView, setActiveRole, setSortConfig, setRequestsSearchTerm,
      setLoginEmail, setLoginPass,
      handleLogin, handleLogout,
      handleCreateTicket, handleRoomReady, handleConfirmReception, handleConsolidate,
      fetchBeds,
      handleUpdateUserAreas, handleMarkNotificationRead, handleMarkAllNotificationsRead, handleDismissToast,
      handleStartTransport,
      toggleIsolation,
      handleValidateTicket:    (_id: string) => {},
      handleAssignBedAction:   (_id: string, _bed: string) => {},
      handleHousekeepingAction:(_id: string) => {},
      handleCompleteTransport: (_id: string) => {},
    },
  };
};
