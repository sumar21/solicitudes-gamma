
import { MOCK_API_RESPONSE, transformApiDataToBeds, generateMockTickets } from "./mock-api-data";
import { Area, Bed, BedStatus, Role, SedeType, Ticket, TicketStatus, User, WorkflowType } from "../types";

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
  [WorkflowType.INGRESO_A_ITR]: 'Ingreso a ITR',
  // Tickets legacy creados como "Cambio de Habitación" → se muestran como "Traslado
  // Interno" porque ambos workflows fueron fusionados.
  [WorkflowType.ROOM_CHANGE]: 'Traslado Interno',
};

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
