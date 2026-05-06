
export enum IsolationType {
  NEUTROPENICO = 'Neutropénico',
  TRASPLANTE = 'Trasplante',
  RESPIRATORIO = 'Respiratorio',
  GOTAS = 'Por Gotas',
  COVID = 'Covid',
  ENTOMOLOGICO = 'Entomológico/Dengue',
  CONTACTO = 'Contacto',
  CD = 'CD',
}

export enum WorkflowType {
  INTERNAL = 'INTERNAL',
  ITR_TO_FLOOR = 'ITR_TO_FLOOR',
  /** @deprecated fusionado con INTERNAL — ya no se ofrece al crear nuevos tickets;
   *  los tickets viejos en SP con este valor siguen leyéndose y se renderizan como "Traslado Interno". */
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
  CATERING = 'CATERING', // Catering — mismos permisos de lectura que READ_ONLY + push al confirmar recepción
  READ_ONLY = 'READ_ONLY', // Mucamas, etc. — solo vista, sin push
}

export enum Area {
  PISO_4 = 'Internacion 4° Piso HPR',
  PISO_5 = 'Internacion 5° Piso HPR',
  PISO_6 = 'Internacion 6° Piso HPR',
  PISO_7 = 'Internacion 7° Piso HPR',
  PISO_8 = 'Internacion 8° Piso HPR',
  HIT = 'Internación Transitoria HPR',
  HRA = 'Recepción Admision y Altas de Internacion HPR', // Sala de espera con sillones — origen exclusivo del workflow Ingreso ITR
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
  diagnosis?: string;
  prescribingPhysician?: string;
  // Nuevos campos enriquecidos desde Gamma (obtenereventointernacion v2):
  admissionType?: string;        // Etiqueta humana ("Clínica", "Quirúrgica", ...)
  admissionTypeCode?: string;    // Código crudo ("C", "Q", "T", "K", "H", "O")
  admissionDate?: string;        // ISO string — fecha/hora de ingreso
  expectedSurgeryDate?: string;  // ISO string — fecha probable de cirugía
  authorizedDays?: number;       // Días autorizados por la OS
  // Plan médico del paciente. `medicalPlanCode` y `medicalPlan` vienen en cada poll
  // (camas ocupadas), `medicalPlanDescription` solo tras el enrich (IPM_DESCRIPCION).
  medicalPlan?: string;
  medicalPlanCode?: string;
  medicalPlanDescription?: string;
  // Motivo de inhabilitación de la cama (campo `observaciones` en obtenermapacamas).
  disabledReason?: string;
  diets?: { descripcion: string; respuesta: string }[]; // Respuestas crudas del form de dieta
  dietTags?: string[];           // Chips resumen (condiciones activas / tipo)
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
  assignedAreas?: Area[]; // For Hostesses and Catering
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
  canCancel?: boolean;          // true while no hostess action has touched this ticket
  intervenedByHostess?: 'SI' | 'NO'; // IntervinoAzafata_T in SP — "NO" at creation, "SI" after first hostess action
}
