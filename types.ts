
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
  // Cargas de menú de Nutrición (overlay de 15.CargasDieta, keyed por comida). Solo se
  // adjuntan si el paciente cargado coincide con el actual de la cama — evita mostrarle a
  // catering la dieta de un paciente anterior tras reasignar la cama. Ver mergeBeds.
  meals?: Partial<Record<MealSlot, MealSlotLoad>>;
}

// Una carga de menú de Nutrición sobre una comida de la cama (fila de 15.CargasDieta).
// Menú y Opción son EXCLUYENTES → `tipo` es uno de los dos.
export interface MealLoad {
  // MENU / OPCION para dietas estándar; OTROS para dietas terapéuticas (liviana, líquida,
  // astringente…) donde no hay menú/opción y Nutrición escribe la comida en `detalle`.
  tipo: 'MENU' | 'OPCION' | 'OTROS';
  detalle?: string;       // detalle de la comanda: qué menú/opción o, en OTROS, la comida específica
  observaciones?: string;
  by: string;       // nombre del/la nutricionista que cargó
  at: string;       // ISO — cuándo se cargó
  spItemId: string;
  comensal?: Comensal;  // TITULAR (default) | ACOMPANANTE
  orden?: number;       // 0 titular; 1..N ordinal INMUTABLE del acompañante (lo asigna el server)
  status?: ComandaStatus;
}

// Ciclo de vida de una bandeja. Se guarda en `Status_D` (reusa la columna de soft-delete: no
// hizo falta una columna nueva). 'Activo' y 'Entregado' son AMBOS estados vivos — ver el
// comentario de VIVAS_FILTER en api/dietas.ts.
export const COMANDA_STATUS = {
  PENDIENTE: 'Activo',
  ENTREGADO: 'Entregado',
  ANULADA:   'Inactivo',
} as const;
export type ComandaStatus = typeof COMANDA_STATUS[keyof typeof COMANDA_STATUS];

// Quién come. Una fila de 15.CargaComandas = una bandeja.
export const COMENSALES = ['TITULAR', 'ACOMPANANTE'] as const;
export type Comensal = typeof COMENSALES[number];

/** Backstop anti-abuso, NO una regla de negocio (no hay tope real definido). Espeja api/dietas.ts. */
export const MAX_ACOMPANANTES = 6;

/**
 * Todo lo cargado en un turno de una cama: la comanda del paciente + la de sus acompañantes.
 *
 * Estructura ANIDADA y no dos mapas paralelos keyed por lo mismo: dos mapas se desincronizan y
 * el que se olvide falla EN SILENCIO.
 *
 * `titular` es OPCIONAL y no es teórico: 'nada por boca' es una dieta real (lib/utils.ts) —
 * paciente en ayuno con un acompañante que sí come es un caso que pasa.
 * `acompanantes` es SIEMPRE array (nunca undefined) para que `tsc` marque los lugares que lo dropean.
 */
export interface MealSlotLoad {
  titular?: MealLoad;
  acompanantes: MealLoad[];
}

/**
 * ¿La cama tiene ALGUNA comanda cargada, en cualquier turno y de cualquier comensal?
 * Derivado del catálogo: un turno nuevo entra solo. NO escribir `meals?.almuerzo || meals?.cena`
 * a mano — es la misma clase de bug que el ternario binario, y como las props de los componentes
 * no están tipadas (falta @types/react), `tsc` NO lo marca.
 */
export const hasAnyMealLoad = (meals: Bed['meals']): boolean =>
  !!meals && MEAL_SLOTS.some(({ slot }) => {
    const s = meals[slot];
    return !!s && (!!s.titular || s.acompanantes.length > 0);
  });
// ── Turnos de comida — FUENTE ÚNICA ─────────────────────────────────────────
// Agregar un turno acá lo propaga a todo: el tipo `MealSlot`, el mapeo app↔SP, los labels,
// el orden de render y la validación del endpoint (`api/dietas.ts` importa `MEAL_SLOTS_SP`).
//
// ⚠️ NO enumerar 'almuerzo'/'cena' a mano en ningún lado — usar `MEAL_SLOTS` y los helpers.
// El motivo es concreto: antes el mapeo app→SP era un ternario binario
// (`comida === 'almuerzo' ? 'ALMUERZO' : 'CENA'`), así que cualquier turno nuevo caía al
// `else` y se guardaba **como CENA**, pisando la cena real — y el mapeo inverso lo
// descartaba con un `continue`, de modo que la UI no mostraba nada raro. `tsc` tampoco lo
// marcaba. Los helpers de abajo hacen ese fallo imposible por construcción.
//
// Para dejar un turno "listo pero apagado", NO lo saques del catálogo (rompés el mapeo de
// las filas ya guardadas en SP): filtrá al renderizar.
// El orden del array es el orden cronológico del día y el de render de los boxes.
// Un solo vocabulario para los DOS lados del dominio:
//   · planificación → `Turno_CM` de 16.CargaMenu
//   · ejecución     → `Comida_D` de 15.CargaComandas
// Son el mismo concepto; tener dos catálogos sería la misma duplicación que causó el bug.
export const MEAL_SLOTS = [
  { slot: 'desayuno', sp: 'DESAYUNO', label: 'Desayuno' },
  { slot: 'almuerzo', sp: 'ALMUERZO', label: 'Almuerzo' },
  { slot: 'merienda', sp: 'MERIENDA', label: 'Merienda' },
  { slot: 'cena',     sp: 'CENA',     label: 'Cena' },
] as const;

export type MealSlot   = typeof MEAL_SLOTS[number]['slot'];
export type MealSlotSp = typeof MEAL_SLOTS[number]['sp'];

/** app → SP (`Comida_D`). Total por construcción: todo `MealSlot` existe en el catálogo. */
export const spFromMealSlot = (slot: MealSlot): MealSlotSp =>
  MEAL_SLOTS.find(s => s.slot === slot)!.sp;

/** SP (`Comida_D`) → app. `null` si el valor no es un turno conocido (fila vieja/corrupta). */
export const mealSlotFromSp = (sp: unknown): MealSlot | null =>
  MEAL_SLOTS.find(s => s.sp === String(sp ?? '').trim().toUpperCase())?.slot ?? null;

/** Label legible de un turno (UI, PDF). */
export const mealSlotLabel = (slot: MealSlot): string =>
  MEAL_SLOTS.find(s => s.slot === slot)!.label;

/** Valores válidos de `Comida_D` (15.CargaComandas) y `Turno_CM` (16.CargaMenu). */
export const MEAL_SLOTS_SP: readonly string[] = MEAL_SLOTS.map(s => s.sp);

// ── Planificación de menú (16.CargaMenu) ────────────────────────────────────
// Tipo planificable. NO incluye 'OTROS' a propósito (decisión D5 del plan): "Otros" es una
// comanda escrita a mano caso por caso — no hay nada que planificar por rango de fechas.
// El selector de la tarjeta SÍ ofrece los 3 (MENU/OPCION/OTROS); ver `MealLoad.tipo`.
export const TIPOS_PLAN = [
  { tipo: 'MENU',   label: 'Menú' },
  { tipo: 'OPCION', label: 'Opción' },
] as const;

export type TipoPlan = typeof TIPOS_PLAN[number]['tipo'];

/** Valores válidos de `Tipo_CM` — para validar en el endpoint. */
export const TIPOS_PLAN_SP: readonly string[] = TIPOS_PLAN.map(t => t.tipo);

export const tipoPlanLabel = (t: TipoPlan): string =>
  TIPOS_PLAN.find(x => x.tipo === t)!.label;

/** Tope real de `Comanda_CM` en SharePoint. Verificado: >255 lo rechaza con 400, no trunca. */
export const COMANDA_MAX_LEN = 255;

/**
 * Una planificación de menú (fila de 16.CargaMenu): "del {desde} al {hasta}, en el {turno},
 * el {tipo} es {comanda}". Es la PLANTILLA que autocompleta la carga por paciente.
 *
 * `desde`/`hasta` son fechas calendarias 'YYYY-MM-DD' — NO instantes. Nunca parsearlas con
 * `new Date()` ni con `artDay()`: se leen con `.slice(0,10)` y se escriben como `T12:00:00Z`
 * (ver decisión D2 — el site de SP está en UTC-7 y la medianoche corre el día en la UI).
 */
export interface CargaMenu {
  spItemId: string;
  turno: MealSlot;
  tipo: TipoPlan;
  desde: string;        // 'YYYY-MM-DD' (FechaInicio_CM)
  hasta: string;        // 'YYYY-MM-DD' (FechaFin_CM)
  comanda: string;      // Comanda_CM — máx COMANDA_MAX_LEN
  by: string;           // NombreUserCarga_CM
  at: string;           // FechaCarga_CM (ISO instante)
}

export type ViewMode = 'HOME' | 'REQUESTS' | 'USERS' | 'HISTORY' | 'BEDS' | 'CLEANINGS' | 'COMANDAS';
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
  // Acción del módulo Gestión de Limpieza: consolidar una cama marcada limpia contra PROGAL.
  'consolidar_limpieza',
  // Mapa de Camas — comandas: cargar (Nutrición) vs ver las comandas cargadas (Catering/Nutrición).
  'cargar_dieta',
  'ver_dieta',
  // Gestión Comandas — planificación de menú por rango de fechas (16.CargaMenu).
  // `ver_planificacion` = abrir el modal y leer la grilla. `abm_planificacion` = crear/editar/eliminar.
  // Separados porque catering puede querer VER qué menú está planificado sin poder tocarlo.
  'ver_planificacion',
  'abm_planificacion',
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
export const ROLE_MODULES = ['Home','Operativa','Historial','Mapa de Camas','Gestion Limpieza','Gestion Comandas','Configuracion'] as const;
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
