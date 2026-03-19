
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
  institution?: string;
  attendingPhysician?: string;
}

export enum ChannelType {
  ROLE = 'ROLE',
  STATUS = 'STATUS',
  PUBLIC = 'PUBLIC'
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  description: string;
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

export interface ChatMessage {
  id: string;
  sender: string;
  role: Role;
  sede: SedeType;
  text: string;
  timestamp: string;
  channelId: string;
  isSystem?: boolean;
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
  WAITING_ROOM = 'WAITING_ROOM',         // Dest en preparación, esperando que Azafata destino marque "Habitación Lista"
  IN_TRANSIT = 'IN_TRANSIT',             // Habitación lista / disponible, esperando que Azafata origen inicie traslado
  IN_TRANSPORT = 'IN_TRANSPORT',         // Traslado iniciado por Azafata origen, esperando confirmación de recepción
  WAITING_CONSOLIDATION = 'WAITING_CONSOLIDATION', // Recepción OK, esperando que Admisión consolide en PROGAL
  COMPLETED = 'COMPLETED',               // Consolidado
  REJECTED = 'REJECTED',
}

export interface Ticket {
  id: string;
  sede: SedeType;
  patientName: string;
  origin: string; // Bed ID
  destination: string | null; // Bed ID
  workflow: WorkflowType;
  status: TicketStatus;
  createdAt: string;
  date?: string;
  bedAssignedAt?: string;
  cleaningDoneAt?: string;
  transportStartedAt?: string;
  receptionConfirmedAt?: string;
  completedAt?: string;
  itrSource?: string;
  changeReason?: string;
  rejectionReason?: string;
  isBedClean: boolean;
  isReasonValidated: boolean;
  targetBedOriginalStatus?: BedStatus; // To track if it was Available or Prep
  observations?: string;
}
