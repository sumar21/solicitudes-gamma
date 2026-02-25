
import { MOCK_API_RESPONSE, transformApiDataToBeds } from "./mock-api-data";
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
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8, Area.UCO, Area.UTI, Area.ITR
];

// Mock Beds (Progal Map) - Transformed from API Mock
export const MOCK_BEDS: Bed[] = transformApiDataToBeds(MOCK_API_RESPONSE);

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
  { id: 'USR-SUMAR', name: 'Equipo Sumar', email: 'admin@sumar.com', role: Role.ADMIN, sede: SedeType.SUMAR, avatar: 'SU', lastLogin: 'Ahora' },
  { id: 'USR-IG', name: 'Admin IG', email: 'adm@ig.com', role: Role.COORDINATOR, sede: SedeType.IG, avatar: 'IG', lastLogin: 'Hace 5 min' },
  { id: 'USR-HPR', name: 'Admin HPR', email: 'adm@hpr.com', role: Role.COORDINATOR, sede: SedeType.HPR, avatar: 'HP', lastLogin: 'Hace 10 min' },
  // New Roles
  { id: 'USR-ADM', name: 'Admisión Central', email: 'admision@hpr.com', role: Role.ADMISSION, sede: SedeType.HPR, avatar: 'AD', lastLogin: 'Hace 1 min' },
  { id: 'USR-AZA-1', name: 'Azafata Piso 4', email: 'azafata4@hpr.com', role: Role.HOSTESS, sede: SedeType.HPR, avatar: 'A4', lastLogin: 'Hace 2 min' },
  { id: 'USR-AZA-2', name: 'Azafata UCO', email: 'azafatauco@hpr.com', role: Role.HOSTESS, sede: SedeType.HPR, avatar: 'AU', lastLogin: 'Hace 3 min' },
  // Read Only Users
  { id: 'USR-MUC', name: 'Mucama Piso 4', email: 'mucama@hpr.com', role: Role.READ_ONLY, sede: SedeType.HPR, avatar: 'MU', lastLogin: 'Hace 5 min' },
  { id: 'USR-CAT', name: 'Catering', email: 'catering@hpr.com', role: Role.READ_ONLY, sede: SedeType.HPR, avatar: 'CA', lastLogin: 'Hace 10 min' },
  { id: 'USR-ENF-COORD', name: 'Coord. Enfermería', email: 'coord.enf@hpr.com', role: Role.READ_ONLY, sede: SedeType.HPR, avatar: 'CE', lastLogin: 'Hace 15 min' },
];

export const MOCK_TICKETS: Ticket[] = [];
