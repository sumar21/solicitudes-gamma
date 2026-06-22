# Convenciones de Código — MediFlow

Convenciones extraídas del código fuente existente. Cada sección incluye ejemplos reales.

---

## 1. Nombrado

### 1.1. Variables y funciones — `camelCase`

Todas las variables, funciones, hooks, parámetros y propiedades usan `camelCase`:

```ts
// hooks/useHospitalState.ts
const [currentUser, setCurrentUser] = useState<User | null>(null);
const [requestsSearchTerm, setRequestsSearchTerm] = useState('');
const [ticketActionLoading, setTicketActionLoading] = useState(false);

// Funciones
function calcAge(fechaNac: string): number | undefined { ... }
function mapEstado(estado: string | undefined): string { ... }
function haversineMeters(lat1: number, lon1: number, ...): number { ... }
```

Los `useRef` llevan el sufijo `Ref`:

```ts
const writingRef = React.useRef(false);
const ticketsEtagRef = React.useRef<string | null>(null);
const prevTicketSnapshotRef = React.useRef<Map<string, string>>(new Map());
const soundCooldownRef = React.useRef(false);
const initialLoadDoneRef = React.useRef(false);
```

Las constantes de configuración usan `UPPER_SNAKE_CASE`:

```ts
// hooks/useHospitalState.ts
const POLL_TICKETS_MS = 8_000;
const POLL_BEDS_MS    = 60_000;
const WARNING_MINUTES = 15;
const TOKEN_KEY       = 'mediflow_token';
const USER_KEY        = 'mediflow_user';

// api/validate-location.ts
const GEO_RADIUS_METERS = 100;

// lib/constants.ts
const ROOM_CHANGE_REASONS = [ ... ];
const ITR_SOURCES = [ ... ];
```

Los IDs de listas SharePoint usan `UPPER_SNAKE_CASE` para el nombre y un string literal para el GUID:

```ts
// api/tickets.ts
const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = 'c7417674-9084-416d-a955-7024161a3194'; // 07.Traslados
```

### 1.2. Interfaces y tipos — `PascalCase`

Las interfaces usan `PascalCase`. Los nombres de props de componentes siguen el patrón `<Componente>Props`:

```ts
// types.ts
export interface Bed { ... }
export interface Ticket { ... }
export interface User { ... }
export interface Notification { ... }
export interface SortConfig { ... }

// components/modals/RejectionModal.tsx
interface RejectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}

// components/dashboard/StatCard.tsx
interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  className?: string;
}
```

Las interfaces internas de API (datos de SharePoint) llevan el prefijo `SP` o `Gamma`:

```ts
// api/beds.ts
interface GammaBed { ... }
interface GammaPatient { ... }
interface GammaRoom { ... }
interface GammaSector { ... }
interface GammaEvent { ... }

// views/UserManagementView.tsx
interface SPUser { ... }

// views/RoleManagementView.tsx
interface SPRole { ... }
```

### 1.3. Enums — `PascalCase` con valores en español

Los enums usan `PascalCase` para el nombre, `UPPER_SNAKE_CASE` para las claves, y **strings en español** como valores (salvo cuando son identificadores internos):

```ts
// types.ts
export enum TicketStatus {
  WAITING_ROOM = 'Esperando Habitacion',
  IN_TRANSIT = 'Habitacion Lista',
  IN_TRANSPORT = 'En Traslado',
  WAITING_CONSOLIDATION = 'Por Consolidar',
  COMPLETED = 'Consolidado',
  REJECTED = 'Cancelado',
}

export enum BedStatus {
  AVAILABLE = 'Disponible',
  DISABLED = 'Inhabilitada',
  OCCUPIED = 'Ocupada',
  PREPARATION = 'En preparación',
  ASSIGNED = 'Asignada',
}

// Excepción: enums de identidad interna usan strings en inglés
export enum Role {
  COORDINATOR = 'COORDINATOR',
  ADMISSION = 'ADMISSION',
  ADMIN = 'ADMIN',
}
```

### 1.4. Componentes React — `PascalCase`

```ts
export const StatusBadge: React.FC<Props> = ({ status }) => { ... };
export const NotificationToasts: React.FC<...> = ({ toasts, onDismiss, onTap }) => { ... };
export const GammaLogo: React.FC<GammaLogoProps> = ({ className, size }) => { ... };
export const StatCard: React.FC<StatCardProps> = ({ title, value, ... }) => { ... };
```

El componente raíz usa `export default function`:

```ts
// App.tsx
export default function App() { ... }
```

Todos los demás componentes usan `export const` con `React.FC<Props>`.

### 1.5. Archivos y carpetas

| Tipo de archivo | Convención | Ejemplo |
|----------------|------------|---------|
| Componente React | `PascalCase.tsx` | `StatusBadge.tsx`, `NotificationToast.tsx` |
| Componente UI genérico | `kebab-case.tsx` | `searchable-select.tsx`, `card.tsx` |
| Vista (página) | `PascalCase + View.tsx` | `DashboardView.tsx`, `BedsView.tsx` |
| Modal | `PascalCase + Modal.tsx` | `RejectionModal.tsx`, `NewRequestModal.tsx` |
| API endpoint | `kebab-case.ts` | `ticket-events.ts`, `push-subscribe.ts` |
| Hook | `camelCase.ts` (prefijo `use`) | `useHospitalState.ts` |
| Utilidades/lib | `kebab-case.ts` | `real-beds-data.ts`, `mock-api-data.ts` |
| Tipos | `camelCase.ts` | `types.ts` |

Los componentes de dominio usan `PascalCase`, mientras que los componentes del directorio `ui/` (estilo shadcn) usan `kebab-case`.

### 1.6. Callbacks y handlers

Los handlers de eventos siguen el patrón `handle<Verbo><Sustantivo>`:

```ts
// hooks/useHospitalState.ts
const handleLogin = async (e: React.FormEvent) => { ... };
const handleLogout = useCallback(() => { ... });
const handleCreateTicket = async (data: ...) => { ... };
const handleValidateTicket = async (id: string) => { ... };
const handleAssignBedAction = async (id: string, bed: string) => { ... };
const handleHousekeepingAction = async (id: string) => { ... };
const handleStartTransport = async (id: string) => { ... };
const handleConfirmReception = async (id: string) => { ... };
const handleConsolidate = async (id: string) => { ... };
const handleRejectTicket = async (id: string, reason: string) => { ... };
const handleMarkNotificationRead = (id: string) => { ... };
const handleDismissToast = (id: string) => { ... };
```

Los callbacks de props usan el prefijo `on`:

```ts
// RequestsView props
onNewRequest: () => void;
onValidateReason: (id: string) => void;
onAssignBed: (id: string) => void;
onStartTransport: (id: string) => void;
onConsolidate: (id: string) => void;
onReject: (id: string) => void;
onSort: (key: SortKey) => void;
```

---

## 2. Estructura de carpetas

```
solicitudes-gamma/
├── api/           → Serverless functions (un archivo = un endpoint)
├── components/
│   ├── ui/        → Componentes genéricos reutilizables (shadcn-style)
│   ├── modals/    → Modales de acción específicos del dominio
│   ├── dashboard/ → Componentes exclusivos del DashboardView
│   └── *.tsx      → Componentes de nivel intermedio (StatusBadge, Icons, etc.)
├── hooks/         → Custom hooks (solo useHospitalState por ahora)
├── views/         → "Páginas" — un archivo por vista principal
├── lib/           → Utilidades, constantes, helpers compartidos
├── src-sw/        → Service Worker source
├── docs/          → Documentación del proyecto
└── *.tsx/ts       → Archivos raíz (App, index, types)
```

**Reglas observadas:**

- Un archivo por componente. No hay archivos que exporten múltiples componentes no relacionados (excepto `components/ui/card.tsx` que exporta `Card`, `CardHeader`, `CardContent`, etc., que son partes de un mismo componente compuesto).
- Los `views/` son componentes de nivel superior que reciben datos como props. No importan hooks globales ni hacen fetch directo.
- Los `api/` son autocontenidos: cada archivo importa `graph.ts`, `jwt.ts`, y los tipos que necesita.
- El directorio `lib/` contiene helpers puros (sin side effects) y constantes.

---

## 3. Patrones repetidos

### 3.1. Estructura de un componente React

Todos los componentes siguen esta estructura:

```tsx
// 1. Imports
import React from 'react';
import { TipoDesdeTypes } from '../types';
import { Icono } from '../components/Icons';
import { ComponenteUI } from '../components/ui/componente';
import { cn } from '../lib/utils';

// 2. Interfaz de props
interface MiComponenteProps {
  dato: string;
  onAccion: (id: string) => void;
  className?: string;
}

// 3. Constantes locales (si las hay)
const CONFIG_MAP: Record<string, { ... }> = { ... };

// 4. Componente como arrow function con React.FC<Props>
export const MiComponente: React.FC<MiComponenteProps> = ({ dato, onAccion, className }) => {
  // hooks locales
  const [state, setState] = useState('');

  // handlers locales
  const handleClick = () => { ... };

  // render
  return ( ... );
};
```

Ejemplo real (`StatusBadge.tsx`):

```tsx
import React from 'react';
import { TicketStatus } from '../types';
import { Badge } from './ui/badge';

interface Props {
  status: TicketStatus;
}

const statusConfig: Record<TicketStatus, { label: string; variant: ... }> = {
  [TicketStatus.WAITING_ROOM]: { label: 'Esperando Habitación', variant: 'warning' },
  // ...
};

export const StatusBadge: React.FC<Props> = ({ status }) => {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} className="whitespace-nowrap shadow-sm">
      {config.label}
    </Badge>
  );
};
```

### 3.2. Estructura de un componente UI (shadcn-style)

Los componentes en `components/ui/` siguen el patrón shadcn:

```tsx
import * as React from "react"
import { cn } from "../../lib/utils"

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-lg border border-slate-200 bg-white ...", className)}
      {...props}
    />
  )
)
Card.displayName = "Card"

export { Card, CardHeader, CardFooter, ... }
```

Características:
- Usan `React.forwardRef` para permitir refs.
- Establecen `displayName` manualmente.
- Aceptan `className` y lo mergean con clases base via `cn()`.
- Spread `...props` para pasar atributos HTML nativos.
- Exportan con named exports (no default).

### 3.3. Estructura de un modal

Los modales siguen un patrón consistente:

```tsx
interface ModalProps {
  open: boolean;                         // ← siempre controlado externamente
  onOpenChange: (open: boolean) => void; // ← siempre este nombre
  onConfirm: (...args) => void;          // ← acción principal
}

export const Modal: React.FC<ModalProps> = ({ open, onOpenChange, onConfirm }) => {
  const [localState, setLocalState] = useState('');

  // Limpiar estado al cerrar
  React.useEffect(() => {
    if (!open) { setLocalState(''); }
  }, [open]);

  const handleConfirm = () => {
    onConfirm(localState);
    setLocalState('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] rounded-3xl">
        <DialogHeader>
          <DialogTitle>...</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">...</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirm}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
```

### 3.4. Estructura de un endpoint API (serverless function)

Todos los endpoints en `api/` siguen esta estructura:

```ts
/**
 * JSDoc con:
 * - Métodos HTTP soportados
 * - Descripción corta
 * - Body/query params esperados
 * - Qué retorna
 */

import { graphFetch } from './graph.js';     // ← siempre con .js extension
import { requireAuth } from './jwt.js';

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = 'guid-de-la-lista';  // Comentario con nombre legible

// Funciones helper privadas
function spToModel(item: Record<string, unknown>): Model { ... }
function modelToFields(m: Partial<Model>): Record<string, unknown> { ... }

// Handler principal
async function handler(req: any, res: any) {
  // 1. Headers CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 2. Preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 3. Validación de config
  if (!SITE_ID) return res.status(503).json({ error: 'SHAREPOINT_SITE_ID not configured' });

  try {
    // 4. Switch por método HTTP
    if (req.method === 'GET') { ... }
    if (req.method === 'POST') { ... }
    if (req.method === 'PATCH') { ... }
    if (req.method === 'DELETE') { ... }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    // 5. Error handler global
    console.error('[api/nombre]', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

// 6. Export con requireAuth wrapper
export default requireAuth(handler);
```

Observaciones:
- Todos los imports de archivos locales usan extensión `.js` (para compatibilidad ESM en Node): `from './graph.js'`.
- CORS se configura manualmente en cada handler (no hay middleware global).
- El dispatch por método HTTP usa `if` encadenados, no `switch`.
- El `catch` final captura cualquier error no manejado.
- El handler recibe `req: any, res: any` (sin tipos fuertes de Vercel).

### 3.5. Funciones de mapeo SP ↔ modelo

Cada endpoint que interactúa con SharePoint tiene un par de funciones de transformación:

```ts
// SP → modelo de la app
function spToTicket(item: Record<string, unknown>): Ticket {
  const f = item.fields as Record<string, unknown>;
  return {
    id:          String(f.IDUnivocoTraslado_T ?? ''),
    patientName: String(f.Paciente_T ?? ''),
    status:      (f.Status_T as TicketStatus) ?? TicketStatus.WAITING_ROOM,
    // ...
  };
}

// Modelo → campos SP (solo campos definidos, safe para PATCH)
function ticketToFields(t: Partial<Ticket>): Record<string, unknown> {
  const map: [keyof Ticket, string][] = [
    ['id',          'IDUnivocoTraslado_T'],
    ['patientName', 'Paciente_T'],
    ['status',      'Status_T'],
    // ...
  ];
  return Object.fromEntries(
    map.filter(([key]) => t[key] !== undefined)
       .map(([key, spKey]) => [spKey, t[key]]),
  );
}
```

Este patrón se repite en `tickets.ts`, `users.ts` y `auth.ts`. Las funciones de mapeo:
- Usan `String(f.Campo ?? '')` para valores que siempre deben ser strings.
- Usan `f.Campo ? String(f.Campo) : undefined` para valores opcionales.
- Castean con `as TipoEnum` para enums.
- El campo `Title` siempre se setea a `'[sumar]'` en los writes.

### 3.6. Patrón de acción de ticket en `useHospitalState`

Todas las acciones de ticket siguen el mismo flujo:

```ts
const handleAlgunaAccion = async (id: string) => {
  // 1. Buscar ticket
  const ticket = tickets.find(t => t.id === id);
  if (!ticket?.spItemId) return;

  // 2. Activar loading + bloquear polls
  setTicketActionLoading(true);
  writingRef.current = true;

  // 3. Actualizar estado local (optimistic update)
  setTickets(prev => prev.map(t =>
    t.id === id ? { ...t, status: TicketStatus.NUEVO_ESTADO, campo: valor } : t
  ));

  // 4. Notificación local
  addNotification({ type: ..., title: '...', message: '...', ... });

  // 5. Escribir en SharePoint (en paralelo: ticket + evento)
  await Promise.all([
    spUpdate(ticket.spItemId, { status: TicketStatus.NUEVO_ESTADO, ... }, ticket),
    spLogEvent(ticket.id, 'Nombre del Evento'),
  ]);

  // 6. Desbloquear: esperar 1s, invalidar ETag, re-fetch, quitar loading
  setTimeout(async () => {
    writingRef.current = false;
    ticketsEtagRef.current = null;
    await fetchTickets();
    setTicketActionLoading(false);
  }, 1000);
};
```

El `setTimeout` de 1 segundo es un delay deliberado para darle tiempo a SharePoint a propagar los cambios antes de re-leer.

### 3.7. Carga en dos fases (fast + enrich)

El endpoint `api/beds.ts` y su fetcher en `useHospitalState` siguen un patrón de carga en dos fases:

```ts
// useHospitalState.ts — fetchBeds
const fetchBeds = useCallback(async () => {
  // Fase 1: rápida (mapa + ocupadas, siempre)
  const r = await authFetch('/api/beds');
  // ...parsear y setear rawBeds...

  // Fase 2: enriquecimiento, UNA SOLA VEZ por sesión
  if (!bedsEnrichedRef.current) {
    bedsEnrichedRef.current = true;
    authFetch('/api/beds?enrich=1').then(async (r2) => {
      // ...parsear y reemplazar rawBeds con datos enriquecidos...
    }).catch(() => {}); // silencioso — conservar datos de Fase 1
  }
}, [authFetch]);
```

```ts
// api/beds.ts — handler
const enrich = url.searchParams.get('enrich') === '1';

// Fase 1: siempre (2 tokens, 2 llamadas)
const [tokenMap, tokenOcc] = await Promise.all([...]);
const beds = transformBeds(mapData, occData);

// Fase 2: solo si ?enrich=1 (2 tokens + N llamadas por cama ocupada)
if (enrich) {
  const [tokenPat, tokenEvt] = await Promise.all([...]);
  // ...enriquecer cada cama ocupada con datos de paciente y evento...
}
```

Características del patrón:
- El `ref` booleano (`bedsEnrichedRef`) asegura que el enriquecimiento solo ocurra una vez por sesión.
- La Fase 2 es fire-and-forget (`.then().catch()`), no bloquea la UI.
- Si la Fase 2 falla, se conservan los datos de Fase 1 sin error visible.

### 3.8. Uso de `Record<Enum, Config>` para mapeos de configuración

Los mapeos de enum a UI se hacen con `Record` tipado:

```ts
// components/StatusBadge.tsx
const statusConfig: Record<TicketStatus, { label: string; variant: string }> = {
  [TicketStatus.WAITING_ROOM]: { label: 'Esperando Habitación', variant: 'warning' },
  [TicketStatus.COMPLETED]:    { label: 'Consolidado',          variant: 'success' },
  // ...
};

// views/HistoryView.tsx
const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  [WorkflowType.INTERNAL]:     'Traslado Interno',
  [WorkflowType.ITR_TO_FLOOR]: 'Ingreso ITR',
  [WorkflowType.ROOM_CHANGE]:  'Cambio Habitación',
};

// views/BedsView.tsx
const AREA_LABELS: Record<string, string> = {
  [Area.PISO_4]: 'Piso 4',
  [Area.PISO_5]: 'Piso 5',
  // ...
};
```

### 3.9. Composición de clases con `cn()`

Todas las clases condicionales se componen con `cn()` (alias de `clsx` + `twMerge`):

```tsx
// App.tsx — sidebar link activo
<Button
  variant="ghost"
  className={cn(
    "w-full justify-start gap-3 h-10 rounded-lg text-sm",
    state.currentView === 'HOME'
      ? 'bg-white/15 text-white font-bold'
      : 'text-white/70 hover:bg-white/10 hover:text-white'
  )}
/>

// NotificationToast.tsx — tipo de notificación
className={cn(
  'relative w-full max-w-sm rounded-xl shadow-lg border ...',
  'transition-all duration-300 ease-out',
  visible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0',
  bgFor(n.type),
)}
```

---

## 4. Manejo de errores

### 4.1. Backend — try/catch con `console.error` y tag

Todos los endpoints wrappean la lógica en un `try/catch` con un tag de identificación:

```ts
// api/tickets.ts
} catch (err: any) {
  console.error('[api/tickets]', err);
  return res.status(500).json({ error: err.message ?? 'Internal error' });
}

// api/beds.ts
} catch (err: any) {
  console.error('[api/beds]', err);
  return res.status(500).json({ error: err.message ?? 'Internal error' });
}

// api/isolations.ts
} catch (err: any) {
  console.error('[isolations] POST error:', err);
  return res.status(500).json({ error: err.message });
}
```

El tag siempre es `[api/nombre]` o `[nombre]`, entre corchetes.

### 4.2. Frontend — errores silenciosos en operaciones no críticas

Las operaciones de polling y logging usan catches vacíos o silenciosos:

```ts
// useHospitalState.ts — polling de tickets
} catch { /* keep mock/current data */ }

// useHospitalState.ts — logging de eventos
} catch { /* non-blocking */ }

// useHospitalState.ts — write helpers
} catch { /* next poll will reconcile */ }
```

Las acciones de push se disparan sin esperar resultado:

```ts
sendPushToSubscribers({ ... }).catch(() => {});
```

### 4.3. Frontend — errores visibles en operaciones de usuario

Las operaciones de login muestran errores al usuario:

```ts
// handleLogin
setLoginError('Timeout: el servidor no respondió en 10 segundos...');
setLoginError(`Error de red: ${fetchErr?.message ?? 'sin conexión al servidor'}`);
setLoginError(data.error ?? 'Credenciales incorrectas');
setLoginError(`Error inesperado: ${err?.message ?? String(err)}`);
```

Los errores de carga de camas se almacenan en estado (mensajes breves, sin volcar body):

```ts
setBedsError(`HTTP ${r.status}`);
setBedsError('Respuesta no válida');
setBedsError(`API error: ${data.error}`);
setBedsError(`Error: ${e?.message || e}`);
```

En caso de error, se conservan los datos anteriores de camas (no se borran ni se reemplazan con mock). El enriquecimiento (Fase 2) falla silenciosamente con `catch(() => {})` y se conservan los datos de Fase 1.

### 4.4. Tipo de error — `err: any`

Todo el proyecto usa `catch (err: any)` o `catch (e: any)` para errores. No hay tipos de error custom. Se accede a `.message` sin verificar si existe:

```ts
} catch (err: any) {
  console.error('[api/users]', err);
  return res.status(500).json({ error: err.message ?? 'Internal error' });
}
```

---

## 5. Logging

### 5.1. `console.log` con tags entre corchetes

Todo el logging usa `console.log` / `console.error` / `console.warn` con un tag entre corchetes:

```ts
console.log('[dev-server] .env.local loaded');
console.log('[dev-server] API running on http://localhost:3000');
console.error('[fetchBeds] error:', e);
console.warn('[login] Location validation unavailable, proceeding');
console.warn('[api/beds] Non-JSON response:', text.slice(0, 100));
console.error('[api/beds]', err);
console.log(`[push-utils] Sending push to ${relevant.length} subscriber(s) for: ${params.title}`);
console.log(`[validate-location] sede=${sede} ip=${clientIp} lat=${lat} lng=${lng}`);
```

> **Nota:** los logs verbose de `fetchBeds` (status, body, cantidad de camas) fueron removidos. El frontend ahora loguea solo errores, no el flujo normal.

**Tags observados:**
- `[dev-server]` — servidor de desarrollo
- `[fetchBeds]`, `[fetchTickets]` — fetchers del frontend
- `[api/beds]`, `[api/tickets]`, `[api/auth]`, `[api/users]` — endpoints
- `[push-utils]`, `[push-subscribe]` — sistema de push
- `[validate-location]` — validación de ubicación
- `[isolations]`, `[roles]`, `[notifications]` — otros endpoints
- `[login]` — proceso de login
- `[push]` — suscripción push client-side

### 5.2. Sin framework de logging

No se usa Winston, Pino, ni ningún framework. Todo es `console.*` directo. No hay niveles configurables ni structured logging.

---

## 6. Estilo de comentarios

### 6.1. JSDoc en cabecera de endpoints

Cada archivo en `api/` comienza con un bloque JSDoc que describe los métodos HTTP, el body esperado y lo que retorna:

```ts
/**
 * POST /api/auth
 * Login contra la lista SharePoint "00.Usuarios".
 * Condiciones: Aplicacion_U = "Traslados" AND Status_U = "Activo"
 *
 * Body:    { username: string, password: string }
 * Returns: { user, token }  — token JWT con 8h de vida
 */
```

```ts
/**
 * Vercel serverless function — CRUD for the "Traslados" SharePoint List.
 *
 * GET  /api/tickets          → all non-completed/rejected tickets (active)
 * GET  /api/tickets?all=1    → full history
 * POST /api/tickets          → create ticket  { ...Ticket fields }
 * PATCH /api/tickets         → update ticket  { spItemId, ...fields to update }
 */
```

### 6.2. Secciones delimitadas con líneas de `─`

Las secciones dentro de un archivo se separan con comentarios de línea:

```ts
// ── Token cache (survives warm invocations) ──────────────────────────────────
// ── Gamma response types ─────────────────────────────────────────────────────
// ── Patient helpers ──────────────────────────────────────────────────────────
// ── BedStatus string values (mirrors types.ts enum) ──────────────────────────
// ── Transform Gamma data → app Bed[] ────────────────────────────────────────
// ── Handler ──────────────────────────────────────────────────────────────────
```

En `useHospitalState.ts`:

```ts
// ── Session init ─────────────────────────────────────────────────────────────
// ── Token state ───────────────────────────────────────────────────────────────
// ── App state ─────────────────────────────────────────────────────────────────
// ── Data fetchers ─────────────────────────────────────────────────────────────
// ── Polling ───────────────────────────────────────────────────────────────────
// ── SP write helpers ──────────────────────────────────────────────────────────
// ── Auth ──────────────────────────────────────────────────────────────────────
// ── Filtered data ─────────────────────────────────────────────────────────────
// ── Ticket actions ────────────────────────────────────────────────────────────
```

### 6.3. Comentarios en español para lógica de negocio

Los comentarios que explican reglas de negocio están en español:

```ts
// Espera media real: promedio de tiempo total de tickets consolidados
// Admin y Admisión: acceso completo (Monitor, Operativa, Historial, Mapa de Camas)
// Solo Admin: Configuración / Usuarios
// Azafata: Operativa + Mapa de Camas
// Banner de notificaciones sin leer
// Banner de sesión por vencer
```

### 6.4. Comentarios en inglés para lógica técnica

Los comentarios técnicos y de implementación están en inglés:

```ts
// Step 1 — auth code
// Step 2 — access token
// Build lookup by "sectorCode-roomCode-bedCode"
// ETag: simple hash of ids + statuses so client can skip unchanged data
// Skip first load — don't spam notifications for existing tickets
// Subscription expired — clean up
```

### 6.5. Comentarios de campo SP

Los campos de SharePoint se documentan inline con un comentario que indica su significado:

```ts
const LIST_ID = 'c7417674-9084-416d-a955-7024161a3194'; // 07.Traslados

// ── SP column names (07.Traslados) ──────────────────────────────────────────
// Title                  → (auto, not used)
// IDUnivocoTraslado_T    → ticket id (TKT-xxx)
// TipoTraslado_T         → workflow type
// CodigoCamaO_T          → origin bed code
```

Los campos del modelo `Ticket` también se documentan:

```ts
export interface Ticket {
  spItemId?: string;        // SharePoint List item ID — set after first SP write
  patientCode?: string;     // Codigo paciente Gamma
  origin: string;           // Cama origen label
  originBedCode?: string;   // Codigo cama origen
  createdAt: string;        // FechaInicio_T
  completedAt?: string;     // FechaFin_T (cuando se consolida)
  financier?: string;       // Financiador / Obra Social
}
```

---

## 7. Convenciones de Git

### 7.1. Mensajes de commit — Conventional Commits (laxo)

Los commits siguen el formato `tipo: descripción` pero sin scope ni body obligatorio:

```
feat: add role management functionality with CRUD operations for roles
fix: syntax error in push-utils.ts (missing closing parenthesis)
feat: add rejection functionality for tickets with confirmation modal
feat: add PWA support with Web Push notifications and notification history
feat: enhance NewRequestModal to handle isolated patients
feat: add isolation system, notification sound, improved location validation
feat: implement advanced filtering and PDF export for BedsView
```

Observaciones:
- Casi todos los commits son `feat:`. Los `fix:` son raros.
- No se usan scopes: `feat(api): ...` no aparece en el historial.
- Las descripciones son en inglés.
- No hay body ni footer en los commits (single-line).
- Un commit tiene solo `-` como mensaje (`184625c -`), lo cual es una excepción.

### 7.2. Ramas

```
main        ← rama principal, despliega a producción
develop     ← rama de desarrollo
demo-sanatorio ← rama de demo para otro cliente
```

Se observa un merge de `develop` a `main` en el historial (`Merge branch 'develop'`). El flujo es `develop → main` vía merge.

### 7.3. `.gitignore`

Excluye lo estándar:

```
node_modules/
dist/
.env
.env.local
.env.*.local
*.log
npm-debug.log*
.DS_Store
.vercel
```

No se excluye `dev-dist/` (que está trackeado como untracked en el status actual).

---

## 8. Convenciones de Tailwind / CSS

### 8.1. Clases directas, sin CSS modules ni styled-components

Todo el estilo se aplica con clases de Tailwind directamente en JSX. No hay archivos `.module.css`, no se usa `styled-components`, no hay CSS-in-JS.

### 8.2. Paleta de colores recurrente

| Color | Uso |
|-------|-----|
| `#022C22` / `gamma-600` | Fondo de sidebar, botones primarios |
| `emerald-*` | Acentos, estados positivos, bordes de inputs |
| `slate-*` | Texto, fondos neutros, bordes |
| `red-*` | Errores, rechazo, destrucción |
| `amber-*` | Warnings (sesión por vencer) |
| `blue-*` | Notificaciones de nuevo ticket |

### 8.3. Tamaños de UI recurrentes

```
h-10, h-12          → altura de botones/inputs
rounded-xl, rounded-3xl → bordes redondeados
text-[10px], text-xs → texto pequeño / labels
font-bold, font-black → pesos de fuente dominantes
tracking-widest, tracking-[0.15em] → labels uppercase
```

### 8.4. Breakpoint custom

Se define un breakpoint `xs: 400px` en `tailwind.config.js` para pantallas muy pequeñas.

---

## 9. Imports

### 9.1. Orden de imports

No hay un linter que fuerce el orden, pero el patrón observado es:

```tsx
// 1. React
import React, { useState, useEffect, useMemo } from 'react';

// 2. Tipos del proyecto
import { Ticket, TicketStatus, WorkflowType } from '../types';

// 3. Iconos
import { Search, Plus, Timer } from '../components/Icons';

// 4. Componentes UI
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';

// 5. Componentes de dominio
import { StatusBadge } from '../components/StatusBadge';

// 6. Utilidades
import { cn, formatDateTime } from '../lib/utils';
```

### 9.2. Icons centralizados

Los iconos de `lucide-react` se re-exportan desde `components/Icons.tsx`. Los componentes importan iconos desde `'../components/Icons'`, no directamente de `lucide-react`.

Excepción: algunos componentes nuevos (como `BedsView.tsx`) importan directamente de `lucide-react` en vez de pasar por `Icons.tsx`:

```tsx
// BedsView.tsx — rompe la convención
import { BedDouble, User as UserIcon, ... ShieldAlert } from 'lucide-react';
```

### 9.3. Extensión `.js` en imports del backend

Los imports dentro de `api/` usan extensión `.js` para compatibilidad ESM:

```ts
import { graphFetch } from './graph.js';
import { requireAuth } from './jwt.js';
import { Ticket, TicketStatus } from '../types.js';
```

Los imports del frontend no usan extensión (Vite los resuelve automáticamente):

```tsx
import { useHospitalState } from './hooks/useHospitalState';
import { cn } from '../lib/utils';
```

---

## Nuevos patrones (2026-04-13)

### Cache server-side en endpoints

Los endpoints que consultan APIs externas lentas usan cache module-level con TTL:

```ts
// api/beds.ts — cache de 45s
let bedsCache: { beds: any[]; etag: string; timestamp: number } | null = null;
const BEDS_CACHE_TTL = 45_000;

// api/bed-enrich.ts — cache de 10min por paciente
const enrichCache = new Map<string, { data: EnrichResult; exp: number }>();
const ENRICH_TTL = 10 * 60 * 1000;
```

### ETag en endpoints de polling

Los endpoints que se pollan frecuentemente soportan `If-None-Match` / `304 Not Modified`:

```ts
// En el handler:
const ifNoneMatch = req.headers?.['if-none-match'];
if (bedsCache && ifNoneMatch === bedsCache.etag) return res.status(304).end();

// En el cliente:
const headers: Record<string, string> = {};
if (bedsEtagRef.current) headers['If-None-Match'] = bedsEtagRef.current;
const r = await authFetch('/api/beds', { headers });
if (r.status === 304) return; // no changes
```

### On-demand enrichment con spinner

Para datos costosos de obtener, se cargan al click del usuario con un estado de loading:

```tsx
// State
const [enrichedBed, setEnrichedBed] = useState<Bed | null>(null);
const [enrichLoading, setEnrichLoading] = useState(false);

// Effect al abrir modal
React.useEffect(() => {
  if (!selectedBed || !onEnrichBed) return;
  setEnrichLoading(true);
  onEnrichBed(selectedBed).then(setEnrichedBed).finally(() => setEnrichLoading(false));
}, [selectedBed?.id]);

// Display: usar enrichedBed si disponible
const displayBed = enrichedBed ?? selectedBed;
// Campos con spinner:
{enrichLoading ? <Spinner /> : displayBed?.dni || '—'}
```

### Módulos compartidos entre endpoints (gamma-client.ts)

Cuando múltiples endpoints necesitan las mismas funciones (token cache, fetch helpers), se extraen a un módulo compartido en `api/`:

```ts
// api/gamma-client.ts — usado por beds.ts y bed-enrich.ts
export function getToken(scope: string): Promise<string> { ... }
export function fetchPatientDetails(token: string, code: string): Promise<GammaPatient | null> { ... }
```

### Supresión de notificaciones al inicio

Para evitar spam de notificaciones al abrir la app (todos los tickets parecen "nuevos"):

```ts
const appStartTimeRef = React.useRef(Date.now());
// En el efecto de detección de cambios:
if (Date.now() - appStartTimeRef.current < 15_000) {
  prevTicketSnapshotRef.current = next; // seedear snapshot sin notificar
  return;
}
```

---

## Nuevos patrones (2026-04-22)

### Snapshot compuesto para detectar múltiples cambios en polling

El snapshot del change-detection pasó de `Map<ticketId, status>` a `Map<ticketId, "${status}|${destination}">`. Esto permite detectar cambios de destino (edición) además de cambios de status, y disparar notifs distintas para cada caso.

```ts
const snapKey = (t: Ticket) => `${t.status}|${t.destination ?? ''}`;
const next = new Map(tickets.map(t => [t.id, snapKey(t)]));

// Dentro del loop por ticket:
if (prevKey !== snapKey(t)) {
  const [prevStatus, prevDestRaw] = prevKey.split('|');
  const destChanged   = (prevDestRaw ?? '') !== (t.destination ?? '');
  const statusChanged = prevStatus !== t.status;
  // ... emitir notifs según qué cambió
}
```

**Regla:** si `destChanged && statusChanged`, NO emitir la notif de status (es consecuencia técnica de la edición; las tres notifs distinguidas de destino ya cubren el evento).

### Pre-seed del snapshot antes del `setTickets` optimistic

Cuando una acción del usuario actualiza un ticket de forma optimistic y queremos que el change-detector NO vea el cambio como novedad (para no emitir notifs al editor), pre-semillamos el ref **antes** del setState:

```ts
// ── Optimistic update + persist ───────────────────────────────
writingRef.current = true;

// Pre-seed snapshot BEFORE the state update so the change-detection useEffect
// never sees a transient diff when it runs for the optimistic update.
const postKey = `${updates.status ?? ticket.status}|${updates.destination ?? ticket.destination ?? ''}`;
prevTicketSnapshotRef.current.set(ticket.id, postKey);

setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, ...updates } : t));
```

**Por qué antes del setState y no después:** React puede ejecutar el useEffect de change-detection entre el `setState` y la próxima línea del handler. Si el ref está desactualizado en ese momento, el detector ve cambio y notifica falsamente.

### Multi-select de enums via toggle en Set/Array

Para campos multi-valor (como tipos de aislamiento):

```ts
const [isolationTypes, setIsolationTypes] = useState<IsolationType[]>([]);

const toggleType = (t: IsolationType) => {
  setIsolationTypes(prev =>
    prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
  );
};
```

**UI:** botones con `aria-pressed={selected}` y background condicional. Cuando `aria-pressed` no alcanza (por accesibilidad en producción), agregar también `checkbox hidden` detrás.

### Serializar lista en campo SP de texto con separador `;`

Para listas cortas y finitas (como tipos de aislamiento):

```ts
// Backend: serializar al escribir
const tipoStr = tipos.join(';'); // e.g. "Covid;Contacto"

// Backend: parsear al leer, filtrando valores inválidos
const parseTipos = (raw: unknown): string[] =>
  String(raw ?? '').split(';').map(s => s.trim()).filter(Boolean);

// Validar contra el enum antes de exponer al frontend:
const validTypes = Object.values(IsolationType);
const filtered = parsed.filter((t): t is IsolationType =>
  validTypes.includes(t as IsolationType)
);
```

**Backward-compat:** los registros viejos con un solo valor se leen como array de un elemento sin cambios.

### Header `X-Beds-Stale` para indicar datos cacheados

Cuando `/api/beds` no puede validar el estado actual en Gamma (upstream 504, etc.) pero tiene caché previo, devuelve ese caché con:

```ts
res.setHeader('X-Beds-Stale', '1');
return res.status(200).json({ beds: bedsCache.beds, stale: true });
```

**Nombre del header:** `X-Beds-Stale`. Convención interna del proyecto.

**Alternativa a 503:** si no hay caché previo, sí devolver 503 para que el frontend conserve su estado actual sin sobrescribir.

### Fetch en tandas para no saturar SharePoint

Cuando hay que traer datos de N items con endpoints que aceptan solo uno a la vez (ej: eventos de auditoría por ticket en el export de Excel):

```ts
const BATCH_SIZE = 10;
for (let i = 0; i < items.length; i += BATCH_SIZE) {
  const batch = items.slice(i, i + BATCH_SIZE);
  const results = await Promise.all(batch.map(item =>
    fetch(`/api/...?id=${item.id}`).then(r => r.json()).catch(() => null)
  ));
  // process results
}
```

**Por qué 10:** balance entre latencia total y presión sobre SP. SP aguanta bien 10 en paralelo; 50+ empieza a lanzar throttling.

### Tag de push único por evento

```ts
// Backend (api/push-utils.ts)
const uniqueTag = `${ticketId ?? 'nt'}-${type ?? 'evt'}-${Date.now()}`;
const payload = JSON.stringify({ title, body, ticketId, type, tag: uniqueTag, timestamp: Date.now() });
```

```ts
// Service Worker (src-sw/sw.ts)
const notifTag = data.tag ?? `${data.ticketId}-${data.type}-${Date.now()}`;
self.registration.showNotification(title, { tag: notifTag, /* ... */ });
```

**Por qué no reusar `ticketId`:** Android colapsa silenciosamente notifs con tag repetido, aunque `renotify: true` debería forzarlo. Un tag único por evento garantiza heads-up en cada notif.

### Convención: nunca usar `sessionStorage` para el token

El token JWT SIEMPRE se lee de `localStorage` bajo la clave `'mediflow_token'`:

```ts
// ✓ correcto
const token = localStorage.getItem('mediflow_token');

// ✗ error — el login nunca escribe acá
const token = sessionStorage.getItem('mediflow_token');
```

**Ideal:** usar el `authFetch` del hook `useHospitalState` en vez de armar headers manualmente. Duplicar la lectura del token en múltiples archivos es fuente conocida de bugs (pasó con `UserManagementView`, `RoleManagementView` y `AuditModal` en la sesión 2026-04-22).

### Formato del evento de modificación en `08.DetalleTraslados`

Los eventos de edición de traslado se persisten como un único `TicketEvent` con `tipo` serializado:

```
Modificacion - {cambio1} | {cambio2} | ... - Motivo: {motivo del usuario}
```

Ejemplo: `"Modificacion - Destino: Cama 401 → Cama 509 | Aislamiento: — → Covid, CD - Motivo: Paciente no subió a la cama"`

**Parser en el frontend** (`AuditModal.tsx`):

```ts
function parseModification(tipo: string): { changes: string[]; motivo: string } | null {
  if (!tipo.startsWith('Modificacion')) return null;
  const content = tipo.replace(/^Modificacion\s*-\s*/, '');
  const motivoIdx = content.lastIndexOf(' - Motivo:');
  const changesStr = motivoIdx >= 0 ? content.slice(0, motivoIdx) : content;
  const motivo     = motivoIdx >= 0 ? content.slice(motivoIdx + ' - Motivo:'.length).trim() : '';
  return { changes: changesStr.split(' | ').map(s => s.trim()).filter(Boolean), motivo };
}
```

**Por qué un único registro y no uno por campo cambiado:** una edición humana es una decisión unitaria con un motivo único. Más prolijo en la auditoría y sigue permitiendo ver qué cambió (lista de changes).

---

## Nuevos patrones (2026-04-27)

### Helpers SP-write con resultado tipado para detectar 409

Cuando un endpoint de escritura puede rechazar por conflicto operacional (no error técnico), los helpers de write retornan un objeto en vez de un valor escalar:

```ts
type SpConflict = { error: string; conflictingTicketId?: string };

const spCreate = async (ticket: Ticket): Promise<{ spItemId?: string; conflict?: SpConflict }> => {
  try {
    const r = await authFetch('/api/tickets', { method: 'POST', body: JSON.stringify(ticket) });
    if (r.status === 409) {
      const data = await r.json().catch(() => ({} as any));
      return { conflict: { error: data?.error ?? '...', conflictingTicketId: data?.conflictingTicketId } };
    }
    if (!r.ok) return {};
    const { spItemId } = await r.json();
    return { spItemId };
  } catch { return {}; }
};

const spUpdate = async (...): Promise<{ ok: boolean; conflict?: SpConflict }> => { ... };
```

**Por qué objeto y no `string | null`:** permite distinguir 3 estados (éxito, fallo silencioso, conflicto operacional con info) sin overload de tipos primitivos.

### Rollback de optimistic update ante 409

Pre-snapshot del ticket antes del `setTickets` optimistic, para poder restaurarlo si el server rechaza el cambio:

```ts
// En handleEditTicket
const ticketSnapshot: Ticket = { ...ticket };
setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, ...updates } : t));

// Persist
const result = await spUpdate(ticket.spItemId, updates, ticket);
if (result.conflict) {
  // Rollback al snapshot pre-cambio
  setTickets(prev => prev.map(t => t.id === ticket.id ? ticketSnapshot : t));
  prevTicketSnapshotRef.current.set(ticket.id, `${ticketSnapshot.status}|${ticketSnapshot.destination ?? ''}`);
  alert(`${result.conflict.error}${conflictingTicketId ? ` (ticket ${conflictingTicketId})` : ''}`);
  return;
}
```

**Para POST optimistic:** el rollback es remover el ticket recién agregado:

```ts
if (conflict) {
  setTickets((prev: Ticket[]) => prev.filter((t: Ticket) => t.id !== newTicket.id));
  alert(...);
  return;
}
```

**Importante:** restaurar también `prevTicketSnapshotRef` para que el change-detector no vea el rollback como un cambio nuevo y dispare notificación falsa.

### Validación de unicidad server-side antes de write

Patrón en `api/tickets.ts` para chequear que no haya conflicto antes del POST/PATCH:

```ts
// POST: chequear duplicado de destino
if (ticket.destination) {
  const escaped = String(ticket.destination).replace(/'/g, "''");
  const conflictUrl = `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$top=5`
    + `&$filter=fields/CamaDestino_T eq '${escaped}'`
    + ` and fields/Status_T ne '${TicketStatus.COMPLETED}'`
    + ` and fields/Status_T ne '${TicketStatus.REJECTED}'`;
  const conflictRes = await graphFetch(conflictUrl, {
    headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as any,
  });
  if (conflictRes.ok) {
    const data = await conflictRes.json();
    if ((data.value ?? []).length > 0) {
      const cf = data.value[0].fields;
      return res.status(409).json({
        error: 'Cama destino ya asignada a otro traslado activo.',
        conflictingTicketId: cf.IDUnivocoTraslado_T ? String(cf.IDUnivocoTraslado_T) : undefined,
      });
    }
  }
}

// PATCH: misma query + ` and id ne ${spItemId}` para excluir el ticket actual
```

**Reglas:**
- Escapar las comillas simples del valor con `'` → `''` antes de meterlo en `$filter`.
- Siempre incluir el header `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly` en queries no indexadas.
- Si la query falla (no entra al `if (conflictRes.ok)`), se sigue adelante con el write — fail-open en validaciones que no son de seguridad sino operativas.

## Nuevos patrones (2026-05-27)

### Worker pool para enrich masivo

Cuando hay que fetchear data de Gamma para N camas en paralelo, usar un pool de 5 workers async sobre una queue compartida. El patrón evita saturar Gamma con 60+ requests simultáneos:

```ts
const queue = [...toEnrich];
const worker = async () => {
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    try {
      const data = await getEventCached(token, item.origin, item.number);
      if (data) applyData(item, data);
    } catch { /* log + continue */ }
  }
};
await Promise.all(Array.from({ length: 5 }, worker));
```

Usado en: `api/beds.ts` (enrich upfront), `api/cron-diet-changes.ts`.

### Cache compartido módulo-nivel con TTL

Para data que se accede desde múltiples endpoints serverless en la misma invocación warm, exportar un cache Map desde un módulo compartido:

```ts
// gamma-client.ts
const eventCache = new Map<string, { data: T | null; exp: number }>();
const TTL = 60_000;

export async function getCached(key: string, fetcher: () => Promise<T>): Promise<T | null> {
  const cached = eventCache.get(key);
  if (cached && cached.exp > Date.now()) return cached.data;
  const data = await fetcher();
  eventCache.set(key, { data, exp: Date.now() + TTL });
  return data;
}
```

Ventaja: `/api/beds` y `/api/bed-enrich` comparten el mismo cache de eventos. Evita doble fetch cuando el mapa carga y el user clickea una cama.

### Helpers de parseo extraídos a archivos propios

Cuando la misma lógica de transformación se usa en 2+ endpoints, extraer a un archivo helper en `api/`:

| Helper | Función | Consumers |
|---|---|---|
| `api/diet-tags.ts` | `parseDiets(DIETAS)` | beds.ts, bed-enrich.ts |
| `api/ayunos.ts` | `summarizeFasting(AYUNOS)` | beds.ts, bed-enrich.ts |

Los helpers van en `api/` (no en `lib/`) porque solo se usan server-side. Los imports usan extensión `.js` como todo dentro de `api/`.

### Snapshot de estado original para undo en formularios

Cuando un formulario tiene acciones destructivas (desactivar módulo borra permisos), guardar un snapshot del estado original al abrir el modal. Usar el snapshot para restaurar en caso de reactivación:

```ts
const [originalPerms, setOriginalPerms] = useState<Set<Permission>>(new Set());

const openEdit = (role: SPRole) => {
  const perms = new Set<Permission>(role.permissions ?? []);
  setOriginalPerms(perms);
  setForm({ ...form, selectedPermissions: new Set(perms) });
};

// En toggle: si reactiva, restaurar desde originalPerms
```

### Log de diagnóstico con razón de descarte

En funciones de filtrado server-side (push-utils `isRelevant`, location-check), loguear **por qué** cada candidato fue descartado, no solo el conteo final. Formato: `[módulo]  ✗ id=X — razón (contexto)` y `[módulo]  ✓ id=X — aprobado`.

```ts
if (!roleCfg.permissions.includes(reqPerm)) {
  console.log(`[push-utils]  ✗ user=${sub.userId} — missing ${reqPerm} (has: [${roleCfg.permissions}])`);
  return false;
}
console.log(`[push-utils]  ✓ user=${sub.userId} — relevant`);
return true;
```

Invaluable para diagnosticar "por qué no me llegó la push" sin reproducir el escenario completo.

### Filtros condicionales por workflow en modales de ticket

Cuando un dropdown depende del valor de otro select (ej: filtrar camas por workflow), construir el filtro como composición de `.filter()` y resetear el campo dependiente al cambiar el padre:

```tsx
const isItrFlow = workflow === WorkflowType.ITR_TO_FLOOR;

const availableOrigins = beds
  .filter(b => b.status === BedStatus.OCCUPIED)
  .filter(b => isItrFlow ? b.area === Area.HIT : b.area !== Area.HIT)
  .sort(sortByAreaThenLabel);

const availableDestinations = beds
  .filter(b => b.status === BedStatus.AVAILABLE || b.status === BedStatus.PREPARATION)
  .filter(b => b.area !== Area.HIT)
  .filter(b => !activeTransferDestinations.has(b.label))
  .sort(sortByAreaThenLabel);

// Reset al cambiar workflow
const handleWorkflowChange = (next: WorkflowType) => {
  setWorkflow(next);
  setOrigin('');
  setReason('');
  // ...
};
```

**En EditRequestModal**, además de filtrar por `activeTransferDestinations`, preservar el destino actual del propio ticket en la lista (el ticket que estamos editando ya está en el set, pero su destino debe seguir siendo válido):

```tsx
.filter(b => b.label === ticket.destination || !activeTransferDestinations.has(b.label))
```

### Tabs internos en modal con `useState` + reset al abrir distinto item

Cuando un modal de detalle muestra varias secciones de info, organizar con tabs locales:

```tsx
const [detailTab, setDetailTab] = useState<'general' | 'internacion' | 'dieta'>('general');

// Reset al abrir un item distinto
React.useEffect(() => {
  setDetailTab('general');
}, [selectedBed?.id]);

// Render
<button onClick={() => setDetailTab('general')} className={cn(...)}>GENERALES</button>
<button onClick={() => setDetailTab('internacion')} className={cn(...)}>INTERNACIÓN</button>
<button onClick={() => setDetailTab('dieta')} className={cn(...)}>DIETA</button>
{detailTab === 'general' && <GeneralFields .../>}
{detailTab === 'internacion' && <InternacionFields .../>}
{detailTab === 'dieta' && <DietaFields .../>}
```

**Regla de UX:** siempre resetear a la primera tab al cambiar de item (no quedar en "Dieta" cuando se abre la cama siguiente).

### Marcar enums deprecated sin removerlos

Cuando un valor de enum deja de usarse pero existen registros viejos en SP que lo contienen, mantenerlo con JSDoc `@deprecated`:

```ts
export enum WorkflowType {
  INTERNAL = 'INTERNAL',
  ITR_TO_FLOOR = 'ITR_TO_FLOOR',
  /** @deprecated fusionado con INTERNAL — ya no se ofrece al crear nuevos tickets;
   *  los tickets viejos en SP con este valor siguen leyéndose y se renderizan como "Traslado Interno". */
  ROOM_CHANGE = 'ROOM_CHANGE',
}
```

**Regla:** nunca borrar valores de enum si hay datos históricos en SP que los contienen — el `as TipoEnum` cast no falla pero la app trata el valor como `undefined` en runtime, rompiendo render. Mejor `@deprecated` + label de UI mapeado a un valor activo.

### Tag de multi-aislamiento como pill en esquina libre

Para destacar un dato secundario sobre una tarjeta sin romper el ring/border principal:

```tsx
{isMultiIso && (
  <div className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 px-1 h-3 md:h-3.5 rounded-full bg-slate-900 text-white text-[7px] md:text-[8px] font-black ring-1 ring-white shadow-sm">
    <span className={cn("w-1.5 h-1.5 rounded-full", (ISOLATION_COLORS[isoTipos[1]] ?? DEFAULT_ISO_COLOR).bg)} />
    <span>{isoTipos.length}</span>
  </div>
)}
```

**Reglas:**
- Esquina libre (no chocar con el indicador primario en `top-left` ni con el dot de status en `top-right`).
- `ring-1 ring-white` para que el badge destaque sobre cualquier color de fondo.
- Tamaños responsive (`w-1.5 h-1.5`, `text-[7px] md:text-[8px]`) para no romper layouts compactos en mobile.

### Anchos mínimos en columnas cortas de tablas para evitar squeeze

Cuando una tabla tiene columnas con contenido corto (como "OCUPADA", "821-01") junto a columnas con contenido largo (Origen ITR completo, Observaciones), el layout `auto` del browser estrecha las cortas hasta romperlas en dos líneas. Solución:

```tsx
<TableHead className="min-w-[110px] whitespace-nowrap">Destino</TableHead>
<TableHead className="min-w-[120px] whitespace-nowrap">Estado Destino</TableHead>
```

Y en las celdas, replicar el `whitespace-nowrap` en el contenido si es propenso a wrap forzoso (ej. códigos con guiones):

```tsx
<div className="text-slate-800 text-sm font-black uppercase tracking-tight whitespace-nowrap">
  {formatBedName(ticket.destination)}
</div>
```

**Regla:** aplicar `min-w-*` solo a las columnas cortas. Las largas se ajustan al contenido restante. `whitespace-nowrap` en el header **y** en la celda — solo en uno no alcanza si el contenido tiene espacios o guiones.

### Push notifications por rol con payload diferenciado

Cuando un rol específico necesita un mensaje human-readable distinto al estándar, agregar campos opcionales al payload de push y resolverlos server-side:

```ts
// api/push-utils.ts
sendPushToSubscribers({
  title: 'Recepción Confirmada',           // título estándar
  body: `${patient}: ${origin} → ${dest}`,  // body estándar
  cateringTitle: 'Traslado concretado',    // override para Catering
  cateringBody: `${patient} pasó de Habitación 401 (Piso 4) a Habitación 509 (Piso 5)`,
  // ...
});

// Server-side al iterar suscriptores
const isCatering = sub.role === 'CATERING';
const payloadTitle = isCatering && cateringTitle ? cateringTitle : title;
const payloadBody  = isCatering && cateringBody  ? cateringBody  : body;
```

**Filtrado natural:** si Catering no debería recibir el evento, simplemente no pasar `cateringBody`. La lógica server-side puede skipear suscriptores Catering cuando ese campo es undefined.

### Campos de contexto adicionales en PATCH para el push

`spUpdate` enriquece el payload con `originArea` / `destinationArea` (nombre legible del área Gamma, no label de cama) para que el server pueda construir mensajes formateados sin tener que resolver labels:

```ts
const originArea      = ticket?.origin      ? rawBeds.find((b: Bed) => b.label === ticket.origin)?.area      : undefined;
const destinationArea = ticket?.destination ? rawBeds.find((b: Bed) => b.label === ticket.destination)?.area : undefined;
const context = ticket ? { id, patientName, origin, destination, originArea, destinationArea, sede } : {};
await authFetch('/api/tickets', {
  method: 'PATCH',
  body: JSON.stringify({ spItemId, ...context, ...updates }),
});
```

**Regla:** los campos de contexto van como spread antes que `updates`, para que cualquier campo de updates pise al contexto si hay overlap (el caso de `destination` cambiando).

---

## Nuevos patrones (2026-05-06)

### Helpers de matching tolerante para áreas Gamma

Cuando el frontend filtra/identifica un sector específico (ITR, HRA, etc.), comparar con el valor del enum Area puede fallar si Gamma envía variaciones de string (con/sin tildes, casing distinto, espacios extra). Convención: **siempre usar un helper en `lib/utils.ts` que normalice antes de comparar**.

```ts
export function isHraArea(area?: string | null): boolean {
  if (!area) return false;
  const normalized = area.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return normalized.includes('recepcion') && normalized.includes('admision');
}
```

**Patrón:**
- `toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')` quita tildes/diacríticos.
- Matchear por **substrings clave** (ej: "transitoria" o "recepcion+admision"), no por igualdad exacta.
- Helper en `lib/utils.ts`, nombre `is{Sector}Area`. Reutilizar en TODOS los modales y filtros.

**Anti-patrón:**
```ts
.filter(b => b.area === Area.HRA) // ❌ frágil: rompe con cualquier variación
```

### Marcar `@deprecated` en enum sin remover el valor

Cuando un workflow / status cambia su semántica pero hay datos históricos en SP que usan el valor viejo, **mantener el valor en el enum con `@deprecated`** y agregar un mapping de label en lugar de borrar:

```ts
export enum WorkflowType {
  INTERNAL = 'INTERNAL',
  ITR_TO_FLOOR = 'ITR_TO_FLOOR',
  /** @deprecated fusionado con INTERNAL */
  ROOM_CHANGE = 'ROOM_CHANGE',
}
```

Y en el render:
```ts
const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  [WorkflowType.INTERNAL]: 'Traslado Interno',
  [WorkflowType.ITR_TO_FLOOR]: 'Ingreso ITR',
  [WorkflowType.ROOM_CHANGE]: 'Traslado Interno', // legacy → mismo label que INTERNAL
};
```

Borrar el valor del enum rompe `as TipoEnum` casts en runtime y queda `undefined` → render rotos.

### Áreas críticas con cubículos físicos: `CRITICAL_AREAS_NO_BLOCK`

```ts
const CRITICAL_AREAS_NO_BLOCK: Area[] = [Area.HUC, Area.HUT, Area.HIT, Area.HRA];
```

Patrón: para reglas que dependen de la **realidad física** del sector (cada cama es independiente vs cama compartida en habitación), mantener una lista hard-coded. No se infiere del response Gamma — es decisión médica/operativa.

Cualquier área nueva que tenga cubículos físicos separados (ej. una nueva sala de aislamiento) se suma manualmente a este array.

### Pipeline de `assignedFloors → assignedAreas` debe cubrir todos los roles operativos

Cuando un rol operativo nuevo entra al sistema y tiene áreas asignadas (Hostess, Catering, etc.), revisar el **handler de login** para que el parseo de `assignedFloors` (string semicolon-separated del backend) a `assignedAreas` (array de `Area`) lo incluya:

```ts
// ❌ frágil: solo HOSTESS, rompe cuando se suma Catering
if (user.role === Role.HOSTESS && data.user.assignedFloors) { ... }

// ✓ explícito por rol
if (
  (user.role === Role.HOSTESS || user.role === Role.CATERING) &&
  data.user.assignedFloors
) { ... }
```

**Pista común de bug:** cualquier `if (role === HOSTESS)` debería revisar si conceptualmente debería ser `if (role === HOSTESS || role === CATERING || ...)`. El comentario `// For Hostesses` en el campo `assignedAreas` del interface User es señal de un patrón que originalmente solo pensó en azafata.

### Endpoint upsert por clave única externa (no por id de SP)

Patrón usado en `/api/push-subscribe`: el id de SharePoint NO es la clave de identidad — el `endpoint` del browser sí lo es. La función:

1. Busca por `Endpoint_PS eq '{endpoint}'`.
2. Si existe → PATCH sobre los campos.
3. Si no existe → POST nuevo.

```ts
const filter = encodeURIComponent(`fields/Endpoint_PS eq '${endpoint.replace(/'/g, "''")}'`);
const existing = await graphFetch(`${basePath}?$expand=fields&$filter=${filter}&$top=1`, { ... });
if (existing.ok) {
  const data = await existing.json();
  if (data.value?.length > 0) {
    await graphFetch(`${basePath}/${data.value[0].id}/fields`, { method: 'PATCH', body: ... });
    return;
  }
}
// fallthrough: POST
```

**Cuándo usarlo:** cuando una entidad tiene una clave externa estable (endpoint del browser, código de paciente Gamma, etc.) y no querés acumular duplicados al re-registrar.

### Doble fuente para un mismo dato (poll rápido + enrich detallado)

Cuando Gamma expone el mismo concepto en dos endpoints — uno barato (poll de 60s) y otro caro (enrich on-click) — mapearlos a campos separados del modelo y dejar que la UI **prioriza** el del poll mientras espera al del enrich:

```ts
// Bed model
medicalPlanCode?: string;        // viene del poll
medicalPlan?: string;            // viene del poll
medicalPlanDescription?: string; // solo del enrich
```

```tsx
{(plan || planCode || planDescription) && (
  <p>
    Plan: {plan ?? planCode}
    {planDescription && ` · ${planDescription}`}
  </p>
)}
```

**Beneficio:** dato visible inmediatamente al abrir modal, descripción larga aparece sin spinner cuando el enrich completa. Sin parpadeo (la condición se cumple desde el primer render).

### Contexto enriquecido en payloads de PUT/PATCH para que el server formatee mensajes

Cuando el server necesita componer un mensaje human-readable que requiere data del cliente (ej: "X pasó de Habitación 401 (Piso 4) a Habitación 509 (Piso 5)"), pasar **el contexto enriquecido** en el body del PATCH para que el server no tenga que volver a resolver labels:

```ts
const context = ticket ? {
  id, patientName, origin, destination,
  originArea,      // ← nombre legible del sector (no label de cama)
  destinationArea,
  sede,
} : {};
await authFetch('/api/tickets', {
  method: 'PATCH',
  body: JSON.stringify({ spItemId, ...context, ...updates }),
});
```

Server-side compone el mensaje sin tener que hacer queries adicionales:
```ts
const fromPart = floorO ? `Habitación ${roomO} (${floorO})` : `Habitación ${roomO}`;
```

### Filtro pre-write en endpoint con `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly`

Cuando el server necesita validar unicidad o duplicación antes de escribir (ej: cama destino ya tomada por otro ticket activo), usar `$filter` contra SP con el header `Prefer`:

```ts
const escaped = String(value).replace(/'/g, "''"); // escape single quotes
const url = `${basePath}?$expand=fields&$top=5&$filter=fields/X eq '${escaped}' and ...`;
const conflictRes = await graphFetch(url, {
  headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as any,
});
if (conflictRes.ok) {
  const data = await conflictRes.json();
  if (data.value?.length > 0) return res.status(409).json({ error, conflictingId: ... });
}
```

**Reglas:**
- Siempre escapar comillas simples del valor: `.replace(/'/g, "''")`.
- Limitar `$top` para no traer todo el listado.
- En PATCH, excluir el item actual con `id ne {spItemId}` para no detectar el propio ticket como conflicto.

### Rate limiting con fallback dual (servicio externo → memoria)

Patrón usado en `api/rate-limit.ts` para todo lo que requiera contadores compartidos sin cargar dependencia obligatoria:

1. **Cliente externo (Upstash) opcional:** lazy-init solo si las envs están seteadas.
2. **Fallback in-memory siempre disponible:** `Map<key, ...>` a nivel módulo.
3. **Circuit breaker:** N fallos consecutivos → cooldown de M minutos durante el cual se usa solo memoria. Reintento automático al expirar.
4. **Doble escritura best-effort:** los writes (`recordFailure`, `resetRateLimit`) tocan memoria PRIMERO, después intentan el servicio externo. Garantiza continuidad ante apertura del breaker.
5. **Timeout corto por operación:** `withTimeout(promise, 1500ms)` para no bloquear al usuario si el servicio externo tarda.

```ts
function activeRedis(): Redis | null {
  if (!isUpstashHealthy()) return null;  // ← circuit breaker check
  return getRedis();
}

export async function recordFailure(key: string): Promise<void> {
  memRecordFailure(key);                  // ← escribe memoria SIEMPRE
  const redis = activeRedis();
  if (!redis) return;
  try {
    await withTimeout(redis.incr(...), 1500, 'incr');
    recordUpstashSuccess();
  } catch (e) {
    recordUpstashError(e?.message ?? 'failed');
  }
}
```

**Cuándo aplicarlo:** cualquier feature que dependa de un servicio externo (Redis, queue, API) donde la falla del servicio NO debe romper la UX. La key es que el fallback nunca queda detrás de un `if (servicioExterno)` — siempre se escribe a memoria primero.

### Inputs autocompletados readonly (no editable a mano)

Patrón para campos que vienen de fuente externa y NO debe modificarse manualmente:

```tsx
<Input
  readOnly
  tabIndex={-1}
  placeholder={origin ? 'Sin valor registrado' : 'Seleccione una cama de origen'}
  value={autoFilledValue}
  className="h-10 rounded-xl bg-slate-50 text-slate-700 cursor-not-allowed focus-visible:ring-0 focus-visible:ring-offset-0"
/>
```

**Reglas:**
- `readOnly` (no `disabled`) para que el valor se envíe en el form submit pero no sea editable.
- `tabIndex={-1}` para sacar el focus del flujo de teclado (no es un input que el usuario deba tocar).
- Estilo gris claro (`bg-slate-50`) y `cursor-not-allowed` para señalizar visualmente que es informativo.
- Placeholder distinto según haya o no fuente: si la fuente está pero no devuelve dato, "Sin X registrado"; si todavía no hay fuente, "Seleccione X primero".

Usado en: campo Paciente y campo Financiador (Origen ITR) de `NewRequestModal.tsx` y `EditRequestModal.tsx`.

### Tooltip nativo dual (multi-condición)

Cuando un mismo elemento puede tener distintas razones de mostrar tooltip (ej: cama inhabilitada con motivo + paciente con multi-aislamiento), encadenar las condiciones por prioridad en un solo `title`:

```tsx
<button
  title={
    bed.status === BedStatus.DISABLED && bed.disabledReason
      ? `Inhabilitada — ${bed.disabledReason}`
      : isMultiIso ? `Aislamientos: ${isoTipos.join(', ')}` : undefined
  }
>
```

**Regla:** `undefined` cuando no hay nada que mostrar (no string vacío — algunos browsers muestran tooltip vacío).

---

## Nuevos patrones (2026-05-11)

### Separación de entornos por columna SP (`Entorno_*`)

Cada lista que debe coexistir entre producción y testing tiene una columna `Entorno_X` (sufijo según la convención de la lista: `_T`, `_A`, `_PS`, `_N`, `_DS`). El backend declara siempre:

```ts
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
```

**Default `'TESTING'`** — fail-closed por diseño. Si la env no está cargada, el deploy no toca prod.

**Patrón en GET**: el `$filter` SIEMPRE incluye `fields/Entorno_X eq '{ENTORNO}'`:
```ts
const filter = encodeURIComponent(
  `fields/Status_A eq 'Activo' and fields/Entorno_A eq '${ENTORNO}'`
);
```

**Patrón en POST nuevo**: estampar el entorno al crear:
```ts
const fieldsPost = { ...spFields, Entorno_T: ENTORNO };
```

**Patrón en PATCH update**: NO incluir `Entorno_X` en los campos actualizados → preserva el entorno original del item. Si el mapping `keyToSpField` no lo tiene, queda preservado automáticamente.

**Patrón en upsert por clave única**: la búsqueda del "ya existe" se acota al entorno actual también:
```ts
// push-subscribe.ts: un mismo endpoint puede tener una sub en testing y otra en prod
const filter = `fields/Endpoint_PS eq '${endpoint}' and fields/Entorno_PS eq '${ENTORNO}'`;
```

### Endpoint cron con shared secret (no JWT)

Para endpoints disparados por GitHub Actions u otros bots, NO usar `requireAuth(handler)` (no hay usuario). Usar validación de header secret:

```ts
const CRON_SECRET = process.env.CRON_SECRET ?? '';

export default async function handler(req, res) {
  // ...
  const provided = String(req.headers?.['x-cron-secret'] ?? '');
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // ... lógica
}
```

**Reglas:**
- El secret va en `process.env.CRON_SECRET` (env var, no hardcoded).
- Si la env no está cargada (`!CRON_SECRET`), rechaza todo → fail-closed.
- Mismo valor del secret en `.env.local`, Vercel envs y GitHub repo Secrets.
- Header en kebab-case (`x-cron-secret`) — Node lowercase headers automáticamente al recibir.

### Workflow YAML de GitHub Actions con curl

Para disparar un endpoint cada N tiempo:

```yaml
on:
  schedule:
    - cron: '*/30 * * * *'  # cada 30 min
  workflow_dispatch:          # disparo manual desde UI

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Call endpoint
        run: |
          set -e
          response=$(curl -fsS -w "\n%{http_code}" -X POST \
            "${{ secrets.MEDIFLOW_URL }}/api/cron-X" \
            -H "X-Cron-Secret: ${{ secrets.CRON_SECRET }}")
          status=$(echo "$response" | tail -n1)
          if [ "$status" != "200" ]; then exit 1; fi
```

**Reglas:**
- Trigger doble (`schedule` + `workflow_dispatch`) → permite disparar manual desde la UI para testing.
- `timeout-minutes: 5` corta el job si se cuelga.
- Capturar status code y fallar el job si no es 200 (sin esto el cron "pasa verde" aunque el endpoint responda 500).
- Usar GitHub Secrets para `MEDIFLOW_URL` (la URL de prod) y `CRON_SECRET`.

### Bootstrap silencioso en cron de detección

Cuando un cron compara estado actual vs snapshot anterior, el **primer ciclo por entidad no debe disparar notificaciones**. Razón: la primera vez no hay snapshot previo, así que TODAS las entidades aparecerían como "cambio nuevo" → spam masivo.

```ts
const existing = snapshots.get(patientCode);
if (!existing) {
  // Primer ciclo para este paciente: crear snapshot SIN notif.
  await upsertSnapshot({ /* ... */ });
  stats.created++;
  return;
}
// Solo a partir del segundo ciclo, comparar y notificar si difiere.
```

**Reglas:**
- Aplica **por entidad**, no global. Cuando un paciente nuevo ingresa al hospital después del cron ya activo, también pasa por bootstrap silencioso individual.
- El cleanup por TTL (`LastChecked` > N días) se hace en el mismo ciclo: snapshots no vistos en X días → `Status = 'Inactivo'`.

### Hash estable para detección de cambios

Al comparar arrays/objetos que pueden venir con orden distinto de una fuente externa (Gamma), ordenar antes de hashear:

```ts
function hashTags(tags: string[]): string {
  return simpleHash([...tags].sort().join('|'));
}
```

Sin esto, dos respuestas del mismo dato con orden distinto generan hashes distintos → falsos positivos de "cambió". El `simpleHash` (DJB2) ya existe en [api/gamma-client.ts](api/gamma-client.ts).

### Bulk read + workers paralelos para procesar N entidades

Cuando hay que procesar N items contra una API externa (Gamma) y comparar contra estado guardado (SP), patrón:

```ts
// 1) UN solo read inicial para todo el estado guardado.
const snapshots = await fetchSnapshots(); // bulk GET con $top=500

// 2) Traer la lista de entidades a procesar.
const items = await fetchItemsFromExternal();

// 3) Workers paralelos limitados (NO Promise.all sobre todo el array).
const queue = [...items];
const workers = Array.from({ length: 5 }, async () => {
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) return;
    try { await processOne(item, snapshots); }
    catch (err) { stats.errors++; }
  }
});
await Promise.all(workers);
```

**Reglas:**
- Concurrencia 5 es un buen balance para Gamma (no satura, baja latencia total).
- `Promise.all(items.map(processOne))` sin límite saturaría la API externa.
- Errores individuales no rompen el batch — se cuentan en `stats.errors`.

### Logging persistente en Service Worker vía IndexedDB

El SW no tiene `localStorage`. Para registrar eventos diagnóstico que sobrevivan reload:

```ts
function openLogDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mediflow-push-log', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) {
        db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function logEvent(entry: Record<string, unknown>): Promise<void> {
  try {
    const db = await openLogDb();
    const tx = db.transaction('entries', 'readwrite');
    tx.objectStore('entries').add({ ...entry, ts: Date.now() });
    // Cleanup: TTL + cap.
    // ...
  } catch { /* no-op: logging nunca debe romper el flujo principal */ }
}
```

**Reglas:**
- Wrappear en `try/catch` vacío — el logging es accesorio, no debe romper el push handler.
- TTL + cap de entradas (ej. 24h o 50 entries) para no crecer indefinido.
- Documentar al final del archivo el snippet JS que el cliente puede correr en la consola del browser para leer el log.

### LIST_ID hardcoded por convención

Los GUIDs de listas SP se hardcodean en cada `api/*.ts` con un comentario al lado del nombre legible:

```ts
const LIST_ID = 'c7417674-9084-416d-a955-7024161a3194'; // 07.Traslados
```

**Reglas:**
- NO leer `LIST_ID` desde env. Los GUIDs son constantes estructurales, no secretos ni configurables por entorno.
- El `SITE_ID` SÍ es env (`SHAREPOINT_SITE_ID`) — varía según deploy.
- Cuando se crea una lista nueva en SP, agregar el GUID hardcoded en el archivo que la consume + comentario del nombre legible.

### Secret generation crypto-safe en PowerShell (Windows)

Cuando `openssl` no está disponible (default en Windows), usar:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Equivalente a `openssl rand -base64 32`. Genera 44 caracteres base64. Usado para `CRON_SECRET`, `JWT_SECRET`, etc.

### Cache split por TTL diferenciado para datos heterogéneos

Cuando un endpoint cachea datos de distintas fuentes con frecuencia de cambio muy diferente, dos caches separados con TTLs apropiados:

```ts
// Datos estables (no cambian en una sesión/internación)
const patientCache = new Map<string, { data: ...; exp: number }>();
const PATIENT_TTL  = 10 * 60 * 1000; // 10 min

// Datos volátiles (cambian en vivo desde fuente externa)
const eventCache = new Map<string, { data: ...; exp: number }>();
const EVENT_TTL  = 30 * 1000; // 30 segundos
```

Al fetchear: si paciente está fresh, reusarlo sin re-consultar `consultarpacientecodigo`. Si evento está stale, sí ir a `obtenereventointernacion`.

**Bonus pattern: bypass on demand con query param**:
```ts
const fresh = url.searchParams.get('fresh') === '1';
const eventFresh = !fresh && cachedEvent && cachedEvent.exp > now;
```

El frontend pasa `?fresh=1` solo en interacciones donde se requiere data garantizada al toque (modal abre, click). Otros consumers (PDFs, batch processing) NO lo pasan → mantienen el cache.

### `isRelevant` por rol explícito (no por exclusión)

Anti-patrón:
```ts
// ❌ Frágil — todo lo que NO sea HOSTESS pasa, incluyendo roles nuevos
const isRelevant = (originArea, destArea) => {
  if (currentUser.role !== Role.HOSTESS) return true;
  // ...
};
```

Patrón:
```ts
// ✓ Explícito — cada rol declara su política
const isRelevant = (originArea, destArea) => {
  if (currentUser.role === Role.ADMIN || currentUser.role === Role.ADMISSION) return true;
  if (currentUser.role === Role.HOSTESS) {
    if (!currentUser.assignedAreas?.length) return false;
    return matchArea(originArea, destArea);
  }
  // Otros roles (CATERING, READ_ONLY, NURSING): nada por defecto
  return false;
};
```

**Por qué:** cuando se agrega un rol nuevo al sistema (CATERING en su momento, READ_ONLY antes), el "ve todo por exclusión" lo incluye silenciosamente. Cada rol nuevo debe declarar explícitamente su política — `return false` por default es fail-closed (no recibe nada hasta declararlo).

**Bug histórico (2026-05-11)**: Catering recibía `new window.Notification(...)` con título "Nueva Solicitud" porque caía en la rama `!== HOSTESS → return true`. El push del server SÍ filtraba correctamente, pero el detector local del polling no. Mismo patrón debería revisarse en cualquier `if (role !== X)` para validar que es realmente lo que se quiere.

### Notifs in-app vs push del server: separación de responsabilidades

El frontend tiene un detector de cambios en `useHospitalState` que dispara:
1. Toast in-app (visible solo si la tab está abierta y en foreground).
2. `new window.Notification(title, options)` (banner del SO desde el browser, funciona en background si la tab está abierta).

Esto convive con el push del server (`api/push-utils.ts`) que llega via Web Push API → SW → notif del SO.

**Regla:** para roles donde el server ya cubre los eventos con filtros precisos (ej. Catering: `RECEPTION_CONFIRMED` + `DIET_CHANGE` filtrados por área), **bloquear el detector local** para evitar duplicados. Solo dejar el detector local activo en roles donde el push del server NO cubre el caso de uso (HOSTESS necesita ver cambios in-app de su piso aunque no estén modelados como push de tipo específico).

---

## Nuevos patrones (2026-05-13)

### Gates de acción con helper `can(user, 'permiso')` — no `role === Role.X`

**Patrón:** Cualquier gate de acción (botón visible/oculto, mutación bloqueada/permitida) usa el helper `can(user, 'codigo_permiso')` de [lib/permissions.ts](lib/permissions.ts) en vez de comparar el enum `Role` directamente.

```ts
// ✗ Antes — frágil, requiere deploy para cambiar permisos
if (currentUser?.role === Role.ADMIN || currentUser?.role === Role.ADMISSION) {
  return <Button>Nueva Solicitud</Button>;
}

// ✓ Ahora — config desde SP, sin deploy
import { can } from '../lib/permissions';
if (can(currentUser, 'crear_ticket')) {
  return <Button>Nueva Solicitud</Button>;
}
```

**Por qué:** El catálogo de 12 permisos vive en `PERMISSIONS as const` en [types.ts](types.ts), tipado como `Permission`. Cada rol declara sus permisos en `Permisos_RT` (SP). El helper retorna `false` si `user.permissions` está undefined o vacío (safe-default = solo lectura).

**Cuándo NO usar `can()`:** Para casos puntuales que no son permisos sino comportamientos (filtro por área, render de tabs de admin "actuando como"), seguir usando `user.filterByFloors` o el enum `Role`. La regla: si el comportamiento es configurable desde el ABM de Roles, usar `can()`. Si es una mecánica fija del sistema, usar `user.role` o flags específicos.

**Acceso a vistas (módulos):** `hasModule(user, 'Operativa')` cumple el rol equivalente para `Acceso_RT` (qué vistas ve el rol).

### Cache server-side en memoria con TTL para datos relativamente estáticos

**Patrón:** Crear un módulo `*-cache.ts` por dominio. Patrón canónico en [api/role-cache.ts](api/role-cache.ts):

```ts
let cache: { data: T[]; exp: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function getCached(): Promise<T[]> {
  const now = Date.now();
  if (cache && cache.exp > now) return cache.data;
  const data = await fetchFromSP();
  cache = { data, exp: now + TTL_MS };
  return data;
}

export function invalidateCache(): void {
  cache = null;
}
```

**Convenciones:**
- Exportar `invalidate*Cache()` para ser llamado tras mutaciones POST/PATCH/DELETE en el endpoint correspondiente.
- TTL típico: 5 min para datos que cambian raramente vía ABM (roles, GeoIPs). Más corto si el dato es más sensible al staleness.
- Memoria por function instance (Vercel serverless): el cache vive en el cold start del worker. No es global. Para clientes vinculados a UN endpoint (push-utils, auth) el cache es suficiente. Si el dato lo necesitan múltiples endpoints, todos comparten siempre que el módulo se importe en cada uno.

### Logout silencioso para migrar tokens viejos

**Patrón:** Cuando un campo del `User` se agrega y el frontend lo necesita, agregar un useEffect en `App.tsx` (boot) que detecte la ausencia y dispare `handleLogout()`:

```tsx
useEffect(() => {
  const u = state.currentUser;
  if (u && (!Array.isArray(u.permissions) || !Array.isArray(u.modules))) {
    console.log('[App] User without permissions/modules — forcing re-login to pick up role config');
    actions.handleLogout();
  }
}, [state.currentUser?.id]);
```

**Por qué:** evita un estado degradado donde el user tiene token válido pero le faltan campos derivados. El re-login los sincroniza sin migration endpoint. Se justifica solo cuando agregar la migration on-the-fly sería más complejo.

### `as const` arrays para catálogos cerrados con tipos derivados

**Patrón:** Cuando el catálogo tiene un set conocido y cerrado (permisos, módulos), declararlo como `as const` y derivar el tipo:

```ts
export const PERMISSIONS = [
  'crear_ticket','editar_ticket','cancelar_ticket','asignar_cama',
  'confirmar_limpieza','iniciar_traslado','confirmar_recepcion','consolidar',
  'editar_aislamiento',
  'abm_usuarios','abm_roles',
  'recibe_push',
] as const;
export type Permission = typeof PERMISSIONS[number];
```

**Por qué:** TypeScript narrowea cada string a su literal, y `Permission` es la unión de todos. Si agregás un permiso al array, los tipos del helper `can(user, perm: Permission)` lo aceptan automáticamente. Si tipeás mal el código en un caller (`can(user, 'crear_tikcet')`) → error de compilación.

**Alternativa descartada — enum:** los enums TypeScript son más pesados (generan código JS) y menos flexibles para iterar. Para catálogos puramente declarativos, `as const` arrays + `typeof[number]` es más idiomático.

### Service Worker → cliente vía `postMessage` (acción que requiere JWT desde un contexto sin JWT)

**Patrón:** Cuando una acción originada en el SW (`notificationclick`, `push`, etc.) requiere autenticación, NO hacer fetch desde el SW. Delegar al cliente:

```ts
// En [src-sw/sw.ts](src-sw/sw.ts)
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data ?? {};
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.postMessage({ kind: 'notification-clicked', ...data });
      } else {
        // App cerrada: pasar datos por query params
        const params = new URLSearchParams();
        if (data.ticketId) params.set('notifTicketId', data.ticketId);
        if (data.type) params.set('notifType', data.type);
        self.clients.openWindow(`/?${params.toString()}`);
      }
    })
  );
});
```

```ts
// En el hook del cliente
useEffect(() => {
  if (!currentUser || !('serviceWorker' in navigator)) return;
  const onMessage = (event: MessageEvent) => {
    if (event.data?.kind !== 'notification-clicked') return;
    // dispar el fetch autenticado acá (cliente tiene JWT)
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}, [currentUser, ...]);

// Reader de query params al mount (caso app cerrada al momento del tap)
useEffect(() => {
  if (!currentUser) return;
  const params = new URLSearchParams(window.location.search);
  const ticketId = params.get('notifTicketId');
  if (!ticketId) return;
  // dispar el fetch
  // Limpiar URL para que no se re-dispare en refresh
  window.history.replaceState(null, '', window.location.pathname);
}, [currentUser]);
```

**Por qué:** el SW vive en un contexto separado, sin acceso a localStorage del browser (donde está el JWT). Mandar el JWT al SW vía IndexedDB rompe el aislamiento de sesión. `postMessage` + query params delega la responsabilidad al cliente que ya tiene auth completa.

### Endpoint con múltiples shapes de body (single + bulk + by-attributes)

**Patrón:** Un endpoint REST puede aceptar varias formas de body que disparen distintos comportamientos:

```ts
// PATCH /api/notifications
// 1) { notificationId: "123" }                  → single by id
// 2) { notificationIds: ["123","456"] }         → bulk by ids
// 3) { ticketId: "T-1", type: "STATUS_UPDATE" } → lookup + bulk by attrs
```

```ts
if (req.method === 'PATCH') {
  const body = req.body ?? {};
  // Modo 3: por atributos (lookup + bulk)
  if (body.ticketId !== undefined || body.type !== undefined) {
    // query SP, luego PATCH a cada match
    return res.status(200).json({ ok, updated, failed });
  }
  // Modos 1 y 2: por id explícito
  const ids = Array.isArray(body.notificationIds)
    ? body.notificationIds.map(String).filter(Boolean)
    : body.notificationId ? [String(body.notificationId)] : [];
  if (ids.length === 0) return res.status(400).json({ error: 'bad body' });
  // PATCH bulk
}
```

**Cuándo:** evita proliferar endpoints (`/api/notifications/by-id`, `/api/notifications/by-event`) que comparten 90% del código. Útil cuando los modos son del mismo dominio y la respuesta tiene el mismo shape (`{ok, updated, failed}`).

**Reglas:**
- Detectar el modo por la PRESENCIA de campos, no por un discriminador explícito (`mode: 'by-event'`) — más natural para callers.
- Documentar las formas válidas en el JSDoc del archivo + en el cuerpo de error 400.
- Si los modos crecen (>3) o divergen mucho en la lógica interna, conviene partir en endpoints separados.

### Endpoint mark-by-event con scope server-side al user logueado

**Patrón:** Para entidades que el cliente identifica por atributos de negocio (no por el SP item id), aceptar `{atributo1, atributo2}` en el body y resolver el id server-side:

```ts
// PATCH /api/notifications con { ticketId, type }:
// 1. GET filtrado en SP: TicketId_N + Type_N + UserId_N (req.user) + Status_N=Enviada
// 2. PATCH cada match
// 3. Devolver { ok, updated, failed }
```

**Cuándo:** cuando el cliente NO conoce el SP item id porque:
- La entidad fue creada server-side fire-and-forget (push notification).
- El cliente solo tiene una referencia abstracta (un push payload, un evento de polling).
- El SW pasa atributos por postMessage sin chance de hacer lookup.

**Seguridad:** el filtro DEBE incluir `UserId_N eq ${req.user.id}` server-side para que el caller no pueda marcar entidades ajenas. Aplicar el mismo patrón para cualquier endpoint que use atributos de negocio: el server reduce el scope al user logueado.

## Nuevos patrones (mapa de camas, notifs, ayunos, geo)

### `$batch` de Microsoft Graph para operaciones masivas SP

Cuando hay que mutar muchas filas de SharePoint (PATCH de cientos/miles), individuales son inviables (~150-300ms × N). Usar el endpoint `/v1.0/$batch` con hasta **20 requests por batch**:

```ts
// api/graph.ts
export async function graphBatchPatchFields(
  itemsBasePath: string,
  items: { id: string; fields: Record<string, unknown> }[],
): Promise<{ updated: number; failed: number }> {
  let updated = 0, failed = 0;
  for (let i = 0; i < items.length; i += 20) {
    const chunk = items.slice(i, i + 20);
    const body = {
      requests: chunk.map((it, idx) => ({
        id: String(idx), method: 'PATCH',
        url: `${itemsBasePath}/${it.id}/fields`,
        headers: { 'Content-Type': 'application/json' },
        body: it.fields,
      })),
    };
    const res = await graphFetch('/$batch', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) { failed += chunk.length; continue; }
    const data = await res.json();
    for (const r of data.responses ?? []) {
      if (r.status >= 200 && r.status < 300) updated++; else failed++;
    }
  }
  return { updated, failed };
}
```

Las `url` de cada request son **relativas a `/v1.0`** (sin host); `graphFetch('/$batch', ...)` ya prepende el host.

**Cuándo:** `markAllForUser` en notifs, `cron-cleanup-notifs`. Pasa de minutos a segundos para >1000 items.

### Cron pattern para detectar cambios y notificar

Para detectar cambios de un atributo entre ciclos y disparar push, el patrón es siempre el mismo:

1. **Lookup del estado anterior** desde SP (snapshot list o `Payload_EC` parseado).
2. **Bootstrap silencioso** la primera vez (sin push) para no spamear al deploy/primer ciclo.
3. **Hash estable** del estado (ordenado + `simpleHash`) y comparar viejo vs nuevo.
4. **Push si cambia** + persistir el estado nuevo.

```ts
// Patrón aplicado en cron-enrich-beds (fasting) y cron-diet-changes (dieta):
const existing = rows.get(eventKey);
const newHash = hashOfX(payload.x);

if (!existing) {
  await upsert({ ... });  // bootstrap silencioso, sin push
  continue;
}
const oldHash = hashOfX(existing.oldX);
if (oldHash !== newHash) {
  console.log(`[cron-X] CHANGE patient=${b.patientCode} old=${oldHash} new=${newHash}`);
  await sendPushToSubscribers({ type: 'X_CHANGE', ... });
}
await upsert({ ... });
```

**Decisión clave:** la detección vive en el cron que **escribe** el atributo, no en otro cron que lo replica. Sino se duplica estado y se necesitan columnas extra.

### Hash estable de estructuras: `sort + join + simpleHash`

Para hashear listas que pueden venir en orden no determinístico (Gamma a veces reordena `DIETAS`, `AYUNOS`), el patrón es:

```ts
function hashTags(tags: string[]): string {
  return simpleHash([...tags].sort().join('|'));
}

function hashFastingSummary(s: FastingSummary | undefined): string {
  if (!s?.indications?.length) return 'none';  // centinela explícito
  const sig = s.indications
    .map(i => `${i.indicationId}:${i.hours.join(',')}:${i.startISO}:${i.totalOccurrences ?? 'n'}`)
    .sort()
    .join('|');
  return simpleHash(sig);
}
```

- `sort()` antes del join garantiza estabilidad ante reordenamientos.
- Un **centinela explícito** (`'none'`, distinto de `''` o de un hash real) permite distinguir "no inicializado" de "sin datos" — usado en bootstrap silencioso vs cambio real.

### Logging del diff cuando se dispara un evento ruidoso

Cuando un cron emite push pero hay sospecha de falsos positivos, agregar log del diff antes de mandar:

```ts
if (existing.hash !== newHash) {
  console.log(`[cron-X] CHANGE patient=${b.patientCode}`);
  console.log(`  prev hash=${existing.hash} tags=${existing.tags}`);
  console.log(`  new  hash=${newHash} tags=${tags.join(';')}`);
  await sendPush(...);
}
```

Si `prev` y `new` son visualmente idénticos pero el hash difiere → hash inestable / dato corrupto. Si difieren → cambio real. Diagnóstico explícito en Vercel logs sin tener que reproducir.

### Helpers compartidos en `api/` (no en `lib/`)

Lógica server-only se extrae a `api/<nombre>.ts` (no `lib/`), porque `lib/` lo importa el frontend y se bundlea al client. Ejemplos:

- `api/enrich-core.ts` — `buildPatientData`, `buildEventData`, `buildEnrich` (compartido por `bed-enrich` y `cron-enrich-beds`).
- `api/diet-tags.ts` — `parseDiets` (compartido por `beds.ts` legacy y `enrich-core`).
- `api/ayunos.ts` — `summarizeFasting`, `fastingHash` (cron-side).

Imports con extensión `.js` (`from './enrich-core.js'`) como el resto del backend.

### Hora Argentina explícita (UTC-3) cuando el momento importa

Argentina no tiene DST → UTC-3 es fijo. Si el código corre en runtimes con TZ distinta (Vercel UTC, devices con TZ no-Argentina), construir/mostrar timestamps con offset explícito:

```ts
// Build: construir epoch en hora ART sin depender del runtime
const epoch = Date.UTC(Y, M - 1, D + d, H + 3, 0, 0);

// Display: mostrar en ART sin depender del device
new Date(epoch).toLocaleString('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  hour: '2-digit', minute: '2-digit',
  hour12: false,   // ← clave: es-AR puede default a 12h con a.m./p.m.
});
```

**Trampa típica:** `new Date('2026-05-28T09:57:00')` (string naive sin Z) lo interpreta como **local time** del runtime. En Vercel (UTC) eso es 09:57Z. Para parsear como ART, **extraer las partes con regex** y reconstruir con `Date.UTC(..., h+3, ...)` — no usar `new Date(naive)`.

### `min-w-0` en hijos de CSS grid (y children dentro de DialogContent)

Un CSS grid item tiene `min-width: auto` por default, así que **no encoge por debajo de su contenido** y puede desbordar el grid. Cuando hijos del grid puedan tener contenido ancho (palabras largas, sub-grids), agregar `min-w-0` al hijo:

```tsx
<DialogContent>  {/* base usa `grid gap-4` en su contenedor scrollable */}
  <div className="min-w-0">  {/* ← clave para que el contenido respete el ancho */}
    ...sección con grid de chips, texto largo, etc...
  </div>
</DialogContent>
```

Sin esto, en mobile el contenido desbordaba y se veía cortado a un lado por el `overflow: clip` del modal.

### Tab bar scrolleable horizontal

Cuando una botonera de tabs no entra en el ancho (mobile), no comprimir con `flex-1` (genera desborde / botón activo cortado). Mejor: `overflow-x-auto` en el contenedor + `shrink-0 whitespace-nowrap` en cada tab. En desktop, los 4 tabs entran y se ven igual; en mobile, scrollean.

```tsx
<div className="flex gap-1 bg-slate-100 rounded-xl p-1 overflow-x-auto">
  {tabs.map(tab => (
    <button className={cn(
      "shrink-0 px-3 py-1.5 rounded-lg whitespace-nowrap ...",
      isActive ? "bg-white shadow-sm" : "..."
    )}>...</button>
  ))}
</div>
```

### Persistencia con TTL en localStorage + ref en memoria

Cuando el valor (geo, etc.) debe sobrevivir recargas del SW (`autoUpdate`), guardarlo en `localStorage` además del `useRef`. La función de lectura prioriza ref → localStorage → fetch fresh:

```ts
function readPersistedX(): { v: T; ts: number } | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const p = JSON.parse(raw);
  if (Date.now() - p.ts >= TTL) return null;  // expirado
  return p;
}

function getXNoFetch(ref: Ref): T | null {
  if (ref.current.v && Date.now() - ref.current.ts < TTL) return ref.current.v;
  const p = readPersistedX();
  if (p) { ref.current = p; return p.v; }     // hidrata el ref tras un remount
  return null;
}
```

El ref vive en memoria (rápido); localStorage es el fallback persistente. Sirve para evitar prompts repetidos de permisos del browser tras un re-mount.

### Comunicación cliente ↔ Service Worker vía `postMessage`

Cuando el cliente necesita que el SW haga algo (cerrar notifs del SO, skip waiting), usar `postMessage` con un envelope `{ type: '...', ...args }`:

```ts
// cliente
navigator.serviceWorker.ready.then(reg =>
  reg.active?.postMessage({ type: 'CLOSE_NOTIFICATIONS', ticketId })
);

// sw.ts
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type === 'CLOSE_NOTIFICATIONS') {
    event.waitUntil(closeMatchingNotifications(msg.ticketId));
  }
});
```

Usar `serviceWorker.ready` (no `.controller`) para garantizar SW activo. El envelope `type` debe coexistir con otros (`SKIP_WAITING` ya estaba) → branch explícito.

### Constantes canónicas de campos cuando hay 3+ helpers que iteran lo mismo

Si tenés tres o más helpers que copian/limpian/extraen el mismo subset de propiedades de un objeto (ej. `Bed`), DRY-ear a través de una tupla `as const`:

```ts
const ENRICH_FIELDS = [
  'dni', 'age', 'sex', 'diagnosis', 'fasting', 'dietTags', /* ... */ 'enriched',
] as const;

type EnrichField = typeof ENRICH_FIELDS[number];
type EnrichSnapshot = Pick<Bed, EnrichField>;

function clearEnrich(b: Bed): void {
  const r = b as unknown as Record<string, unknown>;
  for (const f of ENRICH_FIELDS) r[f] = undefined;
}

function extractEnrich(b: Bed): EnrichSnapshot {
  const src = b as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of ENRICH_FIELDS) out[f] = src[f];
  return out as EnrichSnapshot;
}
```

**Por qué:** las tres listas literales (`clear`, `copy`, `extract`) divergen con el tiempo — un campo nuevo se agrega en dos lugares y se olvida en el tercero. Con la tupla, el tipo `EnrichSnapshot` también se deriva automáticamente. Los casts `as unknown as Record<string, unknown>` son necesarios porque `Bed` no tiene index signature; el doble-cast vía `unknown` es el patrón canónico de TS.

Aplicado en `clearPatientFromBed` / `copyPatientToBed` / `extractEnrichSnapshot` / `reapplyEnrichFromMap` en [hooks/useHospitalState.ts](hooks/useHospitalState.ts).

### Mapa cliente-side `useRef` para snapshots que sobreviven polls

Cuando un valor debe acumularse entre polls pero no debe disparar re-renders en cada update (ej. el snapshot de enrich por `patientCode`), usar `useRef<Map<K, V>>(new Map())` y mutarlo in-place. El re-render se dispara desde el `useState` que ya cambia por otra razón (`setRawBeds`), y el `useMemo` lee el ref actualizado:

```ts
const snapshotMapRef = useRef<Map<string, EnrichSnapshot>>(new Map());

// En el handler que actualiza estado:
for (const bed of data.beds) {
  if (bed.patientCode && bed.enriched === true) {
    snapshotMapRef.current.set(bed.patientCode, extractEnrichSnapshot(bed));
  }
}
setRawBeds(data.beds);  // este sí dispara re-render

// En el useMemo derivado:
const beds = useMemo(() => {
  const merged = mergeBeds(rawBeds, active);
  return reapplyEnrichFromMap(merged, snapshotMapRef.current);
}, [rawBeds, tickets]);
```

**Importante**: actualizar el snapshot **solo cuando el server marcó `enriched === true`** (señal de que aplicó enrich válido del cache). Si llega `enriched !== true`, no tocar la entrada — se mantiene el snapshot del poll previo (es el caso "el cron aún no procesó al paciente en su nueva ubicación"; queremos que el dato lo siga). Guardar valores `undefined` explícitos cuando vienen así del enrich, sino una "cancelación" del campo nunca limpiaría la entrada.

### Iconos distintivos en botones cuando el label se oculta en mobile

Cuando una barra de acciones usa `<span className="hidden sm:inline">Label</span>` para ahorrar espacio en mobile, **NO repetir el mismo icono genérico** (ej. tres `<Download />` para tres PDFs distintos): el usuario en mobile no puede distinguirlos. Asignar un icono temático por botón + `title` (tooltip desktop) + `aria-label` (accesibilidad):

```tsx
<Button title="PDF por sector" aria-label="Exportar PDF por sector">
  <FileText className="h-3.5 w-3.5" />
  <span className="hidden sm:inline">PDF</span>
</Button>
<Button title="PDF alfabético por paciente" aria-label="Exportar PDF alfabético">
  <ArrowDownAZ className="h-3.5 w-3.5" />
  <span className="hidden sm:inline">PDF A-Z</span>
</Button>
<Button title="PDF de dietas y ayunos" aria-label="Exportar PDF de dietas">
  <UtensilsCrossed className="h-3.5 w-3.5" />
  <span className="hidden sm:inline">Dietas</span>
</Button>
```

Durante el estado de spinner (export en progreso) sí compartir el mismo spinner — eso indica "trabajando", no la identidad de la acción.

### Respuestas largas vs cortas en formularios: dos secciones distintas

Cuando un formulario incluye preguntas con respuestas mayoritariamente cortas (Sí / No / 1-2 palabras) pero **algunas pocas** de texto libre largo (ej. observaciones), no usar un solo grid 2-col `flex justify-between`: el texto libre revienta el layout, se trunca, y se pierde info crítica.

Patrón: separar la lista en dos al render-time por longitud, y renderizar cada bloque distinto:

```tsx
const LONG_ANSWER_LEN = 25;
const shortItems = items.filter(d => (d.respuesta ?? '').trim().length <= LONG_ANSWER_LEN);
const longItems  = items.filter(d => (d.respuesta ?? '').trim().length >  LONG_ANSWER_LEN);

{shortItems.length > 0 && (
  <div className="bg-slate-50 rounded-xl p-3">
    <p className="text-[8px] font-bold uppercase">Formulario completo</p>
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {shortItems.map(d => (
        <div key={d.descripcion} className="flex items-center justify-between gap-2 min-w-0">
          <span className="truncate">{d.descripcion}</span>
          <span className="shrink-0 font-bold">{d.respuesta}</span>
        </div>
      ))}
    </div>
  </div>
)}

{longItems.length > 0 && (
  <div className="bg-amber-50/40 rounded-xl p-3 space-y-2">
    <p className="text-[8px] font-bold uppercase">Notas</p>
    {longItems.map(d => (
      <div key={d.descripcion} className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase">{d.descripcion}</p>
        <p className="break-words whitespace-pre-wrap leading-snug">{d.respuesta}</p>
      </div>
    ))}
  </div>
)}
```

`break-words` + `whitespace-pre-wrap` permiten wrap correcto sin truncar. El `min-w-0` en cada item del grid corto mitiga overflow lateral en mobile cuando la descripción es larga. Aplicado en el tab DIETA del modal de cama ([views/BedsView.tsx](views/BedsView.tsx)).

### PDF: wrap multilínea en columnas con texto variable

Cuando una columna de un PDF puede tener texto largo (observaciones, notas), no truncar — usar `doc.splitTextToSize(text, maxWidth)` y **ajustar el alto de la fila al máximo entre el rowHBase y el número de líneas wrapeadas × interlineado**:

```ts
const obsLines: string[] = row.obs
  ? doc.splitTextToSize(row.obs, colWidths[OBS_COL_IDX] - 3)
  : [''];
const rowH = Math.max(rowHBase, obsLines.length * 3.2 + 2.5);
ensurePage(rowH);
// dibujar fila con altura `rowH`
obsLines.forEach((line, li) => {
  doc.text(line, colX[OBS_COL_IDX] + 1.5, curY + 3 + li * 3.2);
});
curY += rowH;
```

Las otras columnas se truncan con `…` (helper `truncate(text, colWidth)`) — el doc queda compacto cuando las observaciones son cortas y crece solo donde hace falta. Aplicado en `exportPDFDietas` ([views/BedsView.tsx](views/BedsView.tsx)).

## Nuevos patrones (robustez de upstreams lentos, 2026-06-08)

### `fetch` con timeout (`AbortController`) para upstreams lentos

Cuando un upstream puede colgarse (Gamma VM single-node), envolver `fetch` con un `AbortController` con timeout configurable por env. El `fetch` de Node no tiene timeout útil por default → un request colgado bloquea hasta el `maxDuration` de la función y la mata (status 0).

```ts
export const GAMMA_TIMEOUT_MS = Number(process.env.GAMMA_FETCH_TIMEOUT_MS ?? 30_000);
export async function fetchWithTimeout(url, init = {}, timeoutMs = GAMMA_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}
```

Las funciones que ya envuelven en `try/catch` (devuelven `null`) absorben el `AbortError` como un fallo más. El `timeoutMs` por env permite tunear en prod sin redeploy.

### Presupuesto de tiempo (deadline) en jobs largos

Un job que itera N entidades contra un upstream lento debe cortar antes del `maxDuration` y devolver 200 parcial, en vez de que la plataforma lo mate (status 0, sin diagnóstico):

```ts
const deadline = Date.now() + Number(process.env.CRON_BUDGET_MS ?? 240_000);
const worker = async () => { while (queue.length > 0 && Date.now() < deadline) { /* ... */ } };
// ...tras los workers:
if (queue.length > 0) stats.skippedByBudget = queue.length;
if (Date.now() < deadline) { /* cleanup de stale; se saltea si se agotó el budget */ }
```

Requiere idempotencia (persist-before-notify) para que lo no procesado se retome el ciclo siguiente sin perder ni duplicar efectos.

### Distinguir "fetch falló" de "dato vacío" antes de derivar un evento

Un helper que devuelve `null` para "no hay dato" Y "el fetch falló" es ambiguo: si aguas abajo se deriva un evento (notificación, escritura de cache), un fallo transitorio se confunde con "el dato se borró". Surfacear el fallo explícito:

```ts
// buildEnrich
return { ...data, eventFetchFailed: event === null };
// caller
if (eventFetchFailed) { stats.errors++; continue; } // no upsert, no push
```

Evita notis falsas ("X removido") y que un payload vacío pise el cache bueno.

### Reintento con backoff para escrituras SP transitorias (`graphFetchRetry`)

[api/graph.ts](api/graph.ts) `graphFetchRetry(path, init, opts?)` reintenta **solo** ante 429/503/504 (throttling/transitorios de SharePoint/Graph), honrando el header `Retry-After` o backoff exponencial acotado (`baseDelay 400ms`, `maxDelay 8s`, 3 intentos). Pensado para escrituras (PATCH/POST) dentro de los crons: maximiza que la persistencia salga en la MISMA corrida —y la notificación se mande al toque— en vez de esperar 15 min al próximo ciclo. NO reintenta 4xx de validación. `init.body` debe ser string (no stream) para poder reusarse entre intentos.

### Mobile cards: `break-words` en vez de `truncate`

En tarjetas (no tablas) donde el ancho es limitado, preferir que el texto baje de línea antes que cortarlo con `…`. `truncate` esconde info crítica (ej. el destino de un traslado en mobile); `break-words leading-tight` la muestra completa creciendo en alto. Las tablas de desktop sí mantienen `whitespace-nowrap` a propósito. Aplicado en las tarjetas mobile de [views/RequestsView.tsx](views/RequestsView.tsx) y [views/HistoryView.tsx](views/HistoryView.tsx).

## Nuevos patrones (2026-06-12)

### Dedup de fanout: una escritura lógica aunque el loop recorra N destinatarios

Cuando un loop itera sobre destinatarios de ENTREGA (suscripciones push) pero además persiste un REGISTRO lógico (fila in-app), separar ambas dimensiones: la entrega es por destinatario, el registro es por entidad lógica (usuario). Deduplicar **antes** de la escritura:

```ts
// Entrega: sigue siendo por endpoint (todos los dispositivos reciben el push)
relevant.map(sub => webpush.sendNotification(...));
// Registro: uno por usuario (no por endpoint) — evita N filas idénticas en la campanita
const notifTargets = Array.from(new Map(relevant.map(s => [String(s.userId), s])).values());
notifTargets.map(sub => graphFetch(notifPath, { method: 'POST', ... }));
```

Aplicado en `sendPushToSubscribers` ([api/push-utils.ts](api/push-utils.ts)). Regla general: si dos dimensiones (entregar vs. registrar, notificar vs. auditar) comparten el mismo array por comodidad, revisar si una de ellas necesita dedup por su clave lógica.

### Dedup defensivo en el render por clave de evento (con fallback sin id)

En listas que vienen de SP sin garantía de unicidad lógica, colapsar en el render por una clave de evento estable. Si algunas filas no tienen id natural (ej. `DIET_CHANGE`/`FASTING_CHANGE` sin `ticketId`), usar un fallback por contenido:

```ts
const dedupKey = (n: Notification) => n.ticketId
  ? `${n.ticketId}|${n.type}|${n.timestamp}`
  : `${n.type}|${n.title}|${n.message}|${n.timestamp}`;
```

Conservar el id real de SP (para acciones como marcar-leída) y combinar flags (OR de `isRead`). El bucket temporal sale del string ya truncado a minuto por `formatDateTime`. Aplicado en `bellNotifications` ([hooks/useHospitalState.ts](hooks/useHospitalState.ts)). Es defensa en profundidad: protege al usuario aunque la fuente (write-side) escriba un duplicado.

### Scripts de diagnóstico/limpieza read-only contra SP con dry-run + `--apply`

Para investigar o remediar datos en SharePoint sin depender de la app: scripts `.mjs` standalone en [scripts/](scripts/) que parsean `.env.local` a mano (tsx/node no lo auto-cargan), obtienen token Graph por `client_credentials` y consultan vía REST con `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly`. Convención de seguridad: **read-only por default** (agrupan y reportan); las mutaciones van detrás de un flag explícito `--apply` (sin él, **dry-run** que solo imprime qué haría y un sample de ids). Hora AR = `UTC-3` para alinear con los timestamps que ve el usuario. Ejemplos: `_diag-notif-dupes.mjs` (diagnóstico de duplicados + subs por usuario) y `_cleanup-notif-dupes.mjs` (limpieza conservadora por `Fecha_N` exacto).

## Nuevos patrones (observaciones + UI responsive, 2026-06-18)

### Merge de items heterogéneos en una línea de tiempo por `fecha` (no lookup-map frágil)

Cuando hay que mostrar dos colecciones distintas en una misma línea de tiempo (ej. hitos del ticket + observaciones), **mergearlas en un array discriminado y ordenar por fecha**, en vez de "colgar" una de la otra por una clave de correlación. Esto evita que un item quede huérfano si su "ancla" no existe.

```ts
type TimelineItem =
  | { kind: 'event'; key: string; fecha: string; evt: TicketEvent }
  | { kind: 'obs';   key: string; fecha: string; obs: Observation };

const timeline = useMemo<TimelineItem[]>(() => [
  ...events.map(e => ({ kind: 'event' as const, key: `e-${e.id}`, fecha: e.fecha, evt: e })),
  ...observations.map(o => ({ kind: 'obs' as const, key: `o-${o.id}`, fecha: o.fecha, obs: o })),
].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime()), [events, observations]);
```

Se descartó el mapa previo `EVENT_TIPO_TO_STATUS` que anclaba cada obs al evento de su status (dejaba huérfanas las obs cuyo evento no existía). Aplicado en [components/AuditModal.tsx](components/AuditModal.tsx).

### Append optimista + modal abierto para "cargar y ver en el mismo lugar"

En un modal hilo+redactor, al guardar no cerrar el modal ni re-fetchear: agregar la fila optimista al estado local (con `id` `local-…` y fecha de cliente) y limpiar el input. La fila aparece al instante en el hilo; al reabrir, el fetch trae la versión canónica de SP. Para feedback, scrollear el hilo al fondo **solo tras agregar** (flag `pendingScrollRef`), no en la carga inicial:

```ts
const pendingScrollRef = useRef(false);
useEffect(() => {
  if (pendingScrollRef.current && scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    pendingScrollRef.current = false;
  }
}, [timeline]); // dep en la lista, no en un contador de submits
```

Aplicado en [views/RequestsView.tsx](views/RequestsView.tsx) (Operativa) y [components/AuditModal.tsx](components/AuditModal.tsx).

### Redactor responsive: inline en desktop, botón→modal en mobile

Cuando un composer fijo come demasiado alto en pantallas chicas, partir por breakpoint: `hidden md:block` para el composer inline (desktop, hay espacio) y `md:hidden` para un botón compacto que abre un `<Dialog>` aparte (mobile). Ambos comparten el mismo estado (`obsText`, `submitObs`); el modal se cierra solo en el `submit` exitoso. Patrón en el redactor post-cierre de [components/AuditModal.tsx](components/AuditModal.tsx).

### Modal acotado: zona scrolleable + footer/composer fijo (`flex-col` + `min-h-0`)

Para que dentro de un modal una zona scrollee y otra quede fija, hacer el contenedor `flex flex-col min-h-0` con la zona scrolleable en `flex-1 overflow-y-auto min-h-0` y el footer/composer en `shrink-0`. El alto del modal se sube con `max-h-[92vh]` pasado por className (el `cn`/`twMerge` lo sobreescribe sobre el `max-h-[85vh]` por defecto del `DialogContent` sin tocar el componente compartido). En mobile, además, prevenir overflow horizontal con `min-w-0`/`overflow-x-hidden` en los hijos flex y `flex-wrap` en filas de meta (id/fecha), y apilar pares label/valor largos (origen→destino) en doble fila con `break-words` en vez de `truncate` lado a lado. Aplicado en [components/AuditModal.tsx](components/AuditModal.tsx).

## Nuevos patrones (aislamientos desde enrich, 2026-06-22)

### Helper `summarize*` por cada array del evento Gamma

Cada lista que Gamma agrega al evento (`DIETAS`, `AYUNOS`, ahora `AISLAMIENTOS`) tiene su helper puro en `api/` que la procesa: [api/diet-tags.ts](api/diet-tags.ts) (`parseDiets`), [api/ayunos.ts](api/ayunos.ts) (`summarizeFasting`), [api/isolations-summary.ts](api/isolations-summary.ts) (`summarizeIsolations`). Convención del helper:
- Recibe el array crudo (`GammaEvent['AISLAMIENTOS']`), devuelve la forma procesada o `undefined` si está vacío.
- Normaliza strings con `s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim()` (sin acentos, lower, espacios colapsados) para comparar contra una tabla de mapeo.
- Expone un `*Hash()` estable (campos ordenados + `simpleHash`) para que el cron detecte cambios; devuelve un centinela (`'none'`) cuando no hay datos.
- Se invoca desde `buildEventData` ([api/enrich-core.ts](api/enrich-core.ts)) y el resultado entra a `EnrichResult`.

### Agregar un campo nuevo de enrich = un solo lugar (`ENRICH_FIELDS`)

Para que un dato nuevo del evento "siga al paciente" en los traslados, agregarlo a `ENRICH_FIELDS` ([hooks/useHospitalState.ts](hooks/useHospitalState.ts)) — `clear/copy/snapshot/reapply` se sincronizan solos. Además: campo en `EnrichResult` (api), merge en `applyEnrichToBed` ([api/beds.ts](api/beds.ts)), y campo en `Bed` ([types.ts](types.ts)). No hace falta un poll ni un `Map` aparte: derivá los sets de UI (ej. `isolatedBeds`) de `beds` con `useMemo`.

### Color como clave semántica en el dato; clases Tailwind en el front

El backend devuelve una **clave de color** (`'green'`, `'teal'`, `'fuchsia'`…), no clases CSS. El front tiene un único mapa keyed por esa clave (`ISOLATION_COLORS[color] → { ring, bg, text, dot, pill }`) con las clases como **literales** (para que el JIT de Tailwind las incluya en el build) y un `DEFAULT` de fallback. Así la presentación queda en el front y el mapeo nombre→color en un solo lugar del backend.
