
import { MOCK_API_RESPONSE, transformApiDataToBeds, generateMockTickets } from "./mock-api-data";
import { Area, Bed, BedStatus, CirugiaEstado, Role, SedeType, Ticket, TicketStatus, User, WorkflowType } from "../types";

// ── Cirugía: label + color de la pill "Cx" por estado ────────────────────────
// Fuente única compartida (BedsView pinta la pill de la celda, CirugiasView agrupa la cola).
// Colores tomados del plan (docs/planes/plan-traslados-cirugia.html):
//   listo=ámbar · en camino=naranja · en traslado=amarillo · en cirugía=cyan · volviendo=violeta.
// Las clases van como literales para que el JIT de Tailwind las incluya en el build.
export const CIRUGIA_ESTADO_LABEL: Record<CirugiaEstado, string> = {
  LISTO_PARA_CIRUGIA: 'Listo para cirugía',
  VAN_A_BUSCAR:       'Búsqueda para cirugía',
  EN_TRASLADO:        'En traslado a cirugía',
  EN_CIRUGIA:         'En cirugía',
  EN_DEVOLUCION:      'Regreso de cirugía',
  TOLERANCIA_EVALUADA: 'Iniciar dieta',
  CANCELADO:          'Cancelada',
};

// Label corto para la pill de la celda del mapa (con prefijo "Cx").
export const CIRUGIA_ESTADO_SHORT: Record<CirugiaEstado, string> = {
  LISTO_PARA_CIRUGIA: 'Listo',
  VAN_A_BUSCAR:       'Búsqueda',
  EN_TRASLADO:        'En traslado',
  EN_CIRUGIA:         'En cirugía',
  EN_DEVOLUCION:      'Regreso',
  TOLERANCIA_EVALUADA: 'Dieta',
  CANCELADO:          'Cancelada',
};

// Clases Tailwind (fondo + texto) de la pill por estado.
export const CIRUGIA_PILL_CLASS: Record<CirugiaEstado, string> = {
  LISTO_PARA_CIRUGIA: 'bg-amber-100 text-amber-700 border-amber-200',
  VAN_A_BUSCAR:       'bg-orange-100 text-orange-700 border-orange-200',
  EN_TRASLADO:        'bg-yellow-100 text-yellow-800 border-yellow-200',
  EN_CIRUGIA:         'bg-cyan-100 text-cyan-700 border-cyan-200',
  EN_DEVOLUCION:      'bg-violet-100 text-violet-700 border-violet-200',
  TOLERANCIA_EVALUADA: 'bg-green-100 text-green-800 border-green-300',
  CANCELADO:          'bg-red-100 text-red-700 border-red-200',
};

// Color sólido del punto/indicador (celda del mapa).
export const CIRUGIA_DOT_CLASS: Record<CirugiaEstado, string> = {
  LISTO_PARA_CIRUGIA: 'bg-amber-500',
  VAN_A_BUSCAR:       'bg-orange-500',
  EN_TRASLADO:        'bg-yellow-500',
  EN_CIRUGIA:         'bg-cyan-500',
  EN_DEVOLUCION:      'bg-violet-500',
  TOLERANCIA_EVALUADA: 'bg-green-600',
  CANCELADO:          'bg-red-500',
};

export const AREAS = [
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8, Area.HIT, Area.HSS, Area.HUC, Area.HUQ, Area.HUT
];

// Mock Beds (Progal Map) - Transformed from API Mock
export const MOCK_BEDS: Bed[] = transformApiDataToBeds();

export const HOSPITAL_LOCATIONS = MOCK_BEDS.map(b => b.label);

// Etiquetas humanas por workflow. Fuente única compartida (HistoryView, AuditModal,
// PatientJourney, BedsView) para no redefinir el mapa en cada consumidor.
export const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  [WorkflowType.INTERNAL]: 'Traslado Interno',
  // ITR_TO_FLOOR antes era "Ingreso ITR" pero el origen real es la sala de espera
  // de Admisión (HRA). Renombrado en 2026-05 para reflejar la semántica real.
  [WorkflowType.ITR_TO_FLOOR]: 'Sala de Espera Admisión',
  [WorkflowType.INGRESO_A_ITR]: 'Ingreso de ITR',
  // Pre-ticket: pedido de cama de la Coordinadora. Mantiene el label "Pre-Ticket" en el badge
  // aun después de que Admisión configura el destino, para trazar el origen del traslado.
  [WorkflowType.PRE_TICKET]: 'Pre-Ticket',
  // Tickets legacy creados como "Cambio de Habitación" → se muestran como "Traslado
  // Interno" porque ambos workflows fueron fusionados.
  [WorkflowType.ROOM_CHANGE]: 'Traslado Interno',
};

// ── Pre-ticket de traslado (Coordinadora) ────────────────────────────────────
// Ver docs/planes/pre-ticket.md. Un solo desplegable = el "movimiento" (queda en motivo_cambio).
// Área crítica se desglosa en UCO y UTI como opciones separadas.
export const MOVIMIENTOS_PRETICKET = [
  "Destino Internación General",
  "Destino Área Crítica - UTI",
  "Destino Área Crítica - UCO",
];

// Requisitos de la nueva cama (checkboxes). Se guardan estructurados en requisitos_cama (para medir)
// y además compuestos como texto en observaciones (lo que ve/edita Admisión). "Sin requerimiento"
// es EXCLUYENTE: al tildarlo se destildan los otros y viceversa (lógica en el modal).
export const REQUISITO_SIN = "Sin requerimiento";
export const REQUISITOS_CAMA = [
  "Con colchón",
  "Frente al office de enfermería",
  "Diálisis",
  "Intento autólisis",
  REQUISITO_SIN,
];

export const ROOM_CHANGE_REASONS = [
  "Solicitud familiar",
  "Asilamiento / Infectologia",
  "Mantenimiento edificio",
  "Cambio de area",
  "Requerimiento Interno",
  "Solicita Upgrade"
];

export const ITR_SOURCES = [
  "OSDE", "PAMI", "GALENO", "SWISS MEDICAL", "GUARDIA EXTERNA", "URGENCIAS / TRASLADO EXTERNO", "PARTICULAR / OTRO"
];

export const INITIAL_USERS: User[] = [
  // Admin — acceso completo
  { id: 'USR-ADMIN', name: 'Administrador', email: 'admin@hpr.com', role: Role.ADMIN, sede: SedeType.HPR, avatar: 'AD', lastLogin: 'Ahora' },
  // Admisión — acceso completo
  { id: 'USR-ADM', name: 'Admisión Central', email: 'admision@hpr.com', role: Role.ADMISSION, sede: SedeType.HPR, avatar: 'AM', lastLogin: 'Hace 1 min' },
  // Azafata — Operativa + Mapa de Camas
  { id: 'USR-AZA', name: 'Azafata', email: 'azafata@hpr.com', role: Role.HOSTESS, sede: SedeType.HPR, avatar: 'AZ', lastLogin: 'Hace 2 min' },
  // Enfermería — solo Mapa de Camas
  { id: 'USR-ENF', name: 'Enfermería', email: 'enfermeria@hpr.com', role: Role.NURSING, sede: SedeType.HPR, avatar: 'EN', lastLogin: 'Hace 3 min' },
];

export const MOCK_TICKETS: Ticket[] = generateMockTickets();
