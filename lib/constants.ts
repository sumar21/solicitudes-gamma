
import { MOCK_API_RESPONSE, transformApiDataToBeds, generateMockTickets } from "./mock-api-data";
import { Area, Bed, BedStatus, Channel, ChannelType, Role, SedeType, Ticket, TicketStatus, User, WorkflowType } from "../types";

export const CHANNELS: Channel[] = [
  { id: 'CH-GEN', name: 'Canal Central', type: ChannelType.PUBLIC, description: 'Comunicaciones generales' },
  { id: 'CH-COORD', name: 'Coordinación', type: ChannelType.ROLE, description: 'Log de solicitudes y validaciones' },
  { id: 'CH-ADM', name: 'Admisión', type: ChannelType.ROLE, description: 'Gestión de camas y censo' },
  { id: 'CH-HIG', name: 'Higiene', type: ChannelType.ROLE, description: 'Checklist de limpieza' },
  { id: 'CH-ENF', name: 'Enfermería', type: ChannelType.ROLE, description: 'Traslados y altas operativas' },
  { id: 'CH-AZA', name: 'Azafatas', type: ChannelType.ROLE, description: 'Gestión de hotelería' },
];

export const AREAS = [
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8, Area.HIT, Area.HSS, Area.HUC, Area.HUQ, Area.HUT
];

// Mock Beds (Progal Map) - Transformed from API Mock
export const MOCK_BEDS: Bed[] = transformApiDataToBeds();

export const HOSPITAL_LOCATIONS = MOCK_BEDS.map(b => b.label);

export const ROOM_CHANGE_REASONS = [
  "Solicitud familiar",
  "Asilamiento / Infectologia",
  "Mantenimiento edificio",
  "Pase a piso",
  "Cambio de area"
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
