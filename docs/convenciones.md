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
