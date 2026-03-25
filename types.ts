
export enum WorkflowType {
  INTERNAL = 'INTERNAL',
  ITR_TO_FLOOR = 'ITR_TO_FLOOR',
  ROOM_CHANGE = 'ROOM_CHANGE',
}

export enum SedeType {
  IG = 'IG',
  HPR = 'HPR',
  SUMAR = 'SUMAR', // Superuser / Admin
}

export enum Role {
  COORDINATOR = 'COORDINATOR',
  ADMISSION = 'ADMISSION',
  HOUSEKEEPING = 'HOUSEKEEPING',
  NURSING = 'NURSING',
  ADMIN = 'ADMIN',
  HOSTESS = 'HOSTESS', // Azafata
  READ_ONLY = 'READ_ONLY', // Mucamas, Catering, etc.
}

export enum Area {
  PISO_4 = 'Internacion 4° Piso HPR',
  PISO_5 = 'Internacion 5° Piso HPR',
  PISO_6 = 'Internacion 6° Piso HPR',
  PISO_7 = 'Internacion 7° Piso HPR',
  PISO_8 = 'Internacion 8° Piso HPR',
  HIT = 'Internación Transitoria HPR',
  HSS = 'Servicio de Neurofisiologia (Sueño) HPR',
  HUC = 'Unidad Coronaria HPR',
  HUQ = 'Unidad Recuperaciòn Postquirùrgica',
  HUT = 'Unidad de Terapia Intensiva HPR',
}

export enum BedStatus {
  AVAILABLE = 'Disponible',
  DISABLED = 'Inhabilitada',
  OCCUPIED = 'Ocupada',
  PREPARATION = 'En preparación',
  ASSIGNED = 'Asignada', // Internal app state only
}

export interface Bed {
  id: string;
  label: string;
  area: Area;
  status: BedStatus;
  patientName?: string; // If occupied
  roomCode?: string;
  bedCode?: string;
  eventOrigin?: string;
  eventNumber?: number;
  patientCode?: string;
  institution?: string;  // Financiador / obra social
  attendingPhysician?: string;
  dni?: string;
  age?: number;
  sex?: 'M' | 'F';
}

export type ViewMode = 'HOME' | 'REQUESTS' | 'USERS' | 'HISTORY' | 'BEDS';
export type SortKey = 'status' | 'patientName' | 'origin' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  key: SortKey;
  direction: SortDirection;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  sede: SedeType;
  avatar: string;
  lastLogin: string;
  assignedAreas?: Area[]; // For Hostesses
}

export enum NotificationType {
  NEW_TICKET = 'NEW_TICKET',
  STATUS_UPDATE = 'STATUS_UPDATE',
  ROLE_CHANGE = 'ROLE_CHANGE',
  SYSTEM = 'SYSTEM',
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
  ticketId?: string;
  sede: SedeType;
  originArea?: Area;
  destinationArea?: Area;
}

export enum TicketStatus {
  WAITING_ROOM = 'Esperando Habitacion',
  IN_TRANSIT = 'Habitacion Lista',
  IN_TRANSPORT = 'En Traslado',
  WAITING_CONSOLIDATION = 'Por Consolidar',
  COMPLETED = 'Consolidado',
  REJECTED = 'Cancelado',
}

export interface Ticket {
  id: string;
  spItemId?: string;        // SharePoint List item ID — set after first SP write
  sede: SedeType;
  patientName: string;
  patientCode?: string;     // Codigo paciente Gamma
  origin: string;           // Cama origen label
  originBedCode?: string;   // Codigo cama origen
  originBedStatus?: string; // Status cama origen (Ocupada → En preparación)
  destination: string | null; // Cama destino label
  destinationBedCode?: string;   // Codigo cama destino
  destinationBedStatus?: string; // Status cama destino (Prep/Disponible → Asignada → Ocupada)
  workflow: WorkflowType;
  status: TicketStatus;
  createdAt: string;        // FechaInicio_T
  completedAt?: string;     // FechaFin_T (cuando se consolida)
  financier?: string;       // Financiador / Obra Social
  createdBy?: string;       // ConcatName_Usr del usuario que crea
  createdById?: string;     // ID del usuario que crea
  date?: string;
  bedAssignedAt?: string;
  cleaningDoneAt?: string;
  transportStartedAt?: string;
  receptionConfirmedAt?: string;
  itrSource?: string;
  changeReason?: string;
  rejectionReason?: string;
  isBedClean: boolean;
  isReasonValidated: boolean;
  targetBedOriginalStatus?: BedStatus;
  observations?: string;
}
