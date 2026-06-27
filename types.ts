
// Aislamiento de un paciente. Desde jun-2026 la fuente única es PROGAL (Gamma): vienen
// en el enrich del evento y se muestran sobre la cama. Ya NO se cargan/editan desde la app.
// `color` es una clave semántica (green/pink/teal/…) que BedsView mapea a clases Tailwind.
// Ver api/isolations-summary.ts (normalización Gamma → nombre canónico + color).
export interface IsolationEntry {
  name: string;
  color: string;
  observation?: string;
}

export enum WorkflowType {
  INTERNAL = 'INTERNAL',
  /** Origen: sala de espera de Admisión (HRA) con paciente registrado. Antes se
   *  llamaba "Ingreso ITR" pero el origen real es HRA, no ITR. Se renombró a
   *  "Sala de Espera Admisión" en la UI; el value SP se mantiene para compat. */
  ITR_TO_FLOOR = 'ITR_TO_FLOOR',
  /** Origen: las 8 camas de HIT (Internación Transitoria). Workflow nuevo (2026-05)
   *  para traslados que salen de ITR hacia pisos. */
  INGRESO_A_ITR = 'INGRESO_A_ITR',
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
  DIRECCION = 'DIRECCION', // Dirección — ve TODO (Home, Operativa, Historial, Mapa) pero no ejecuta acciones ni recibe notificaciones
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
  // True si /api/beds le aplicó el enrich precomputado de SP (12.EnrichCamas).
  // El modal lo usa para no pegar a Gamma on-click cuando ya tiene los datos.
  enriched?: boolean;
  // Ayunos vigentes (no ejecutados) del paciente. La API los devuelve ya resueltos:
  // cada indicación trae su lista de ocurrencias (fecha/hora exacta). `hasUpcoming`
  // controla el ícono de la tarjeta. Ver api/ayunos.ts (summarizeFasting).
  fasting?: {
    hasUpcoming: boolean;
    nextAt?: string;
    indications: Array<{
      indicationId: number;
      occurrences: string[];  // PAT_FECHA_HORA (ISO ART), ordenadas asc
    }>;
  };
  // Aislamientos prescriptos al paciente (PROGAL). Vienen en el enrich y "siguen" al
  // paciente como el resto del enrich (ENRICH_FIELDS en useHospitalState).
  isolations?: IsolationEntry[];
  // Limpieza marcada por una azafata (overlay de la lista 14.Limpiezas sobre una cama
  // que PROGAL reporta "En preparación"). mergeBeds la muestra como Disponible y BedsView
  // pinta el chip "Limpia ✓". PROGAL es read-only: esto NO escribe a PROGAL, solo lo pisa
  // visualmente. Se cierra sola cuando un traslado toma la cama o Gamma avanza su estado.
  cleaned?: boolean;
  cleanedBy?: string;   // nombre de la azafata que la marcó
  cleanedAt?: string;   // ISO — cuándo se marcó limpia
}

export type ViewMode = 'HOME' | 'REQUESTS' | 'USERS' | 'HISTORY' | 'BEDS';
export type SortKey = 'status' | 'patientName' | 'origin' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  key: SortKey;
  direction: SortDirection;
}

// Catálogo cerrado de permisos de acción. Se persiste en SP (99.ABMRoles_Traslados,
// columna Permisos_RT) como string separado por ';'. El helper `can(user, perm)`
// chequea contra user.permissions al renderizar botones / disparar mutaciones.
export const PERMISSIONS = [
  'crear_ticket','editar_ticket','cancelar_ticket','asignar_cama',
  'confirmar_limpieza','iniciar_traslado','confirmar_recepcion','consolidar',
  'abm_usuarios','abm_roles',
  // Notificaciones granulares por tipo (antes había un solo `recibe_push`).
  // Cada permiso gobierna que el usuario reciba push + in-app de ese tipo.
  'notif_new_ticket',
  'notif_status_update',
  'notif_reception_confirmed',
  'notif_diet_change',
  'notif_fasting_change',
] as const;
export type Permission = typeof PERMISSIONS[number];

// Módulos visibles para el rol (Acceso_RT). Drive el sidebar / vistas.
export const ROLE_MODULES = ['Home','Operativa','Historial','Mapa de Camas','Configuracion'] as const;
export type RoleModule = typeof ROLE_MODULES[number];

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  sede: SedeType;
  avatar: string;
  lastLogin: string;
  assignedAreas?: Area[]; // For Hostesses and Catering
  // Configurables desde 99.ABMRoles_Traslados (poblados en login)
  permissions?: Permission[];
  modules?: RoleModule[];
  filterByFloors?: boolean;
  // Si el rol lo permite, se saltea la validación de ubicación (IP/GPS) en login y
  // en la revalidación periódica. BypassUbicacion_RT en 99.ABMRoles_Traslados.
  bypassLocationCheck?: boolean;
  // Nombre original del rol en SP (NombreRol_RT). Usado para enlazar la suscripción
  // push con la config del rol en el server (push-utils.getRoleByName).
  roleName?: string;
}

export enum NotificationType {
  NEW_TICKET = 'NEW_TICKET',
  STATUS_UPDATE = 'STATUS_UPDATE',
  RECEPTION_CONFIRMED = 'RECEPTION_CONFIRMED',
  DIET_CHANGE = 'DIET_CHANGE',
  FASTING_CHANGE = 'FASTING_CHANGE',
  ROLE_CHANGE = 'ROLE_CHANGE',  // no usado hoy, backwards-compat
  SYSTEM = 'SYSTEM',            // no usado hoy, backwards-compat
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
