
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
  // Limpieza de RUTINA en curso sobre una cama OCUPADA (~2x/día). Overlay de public.limpiezas_rutina
  // en estado INICIADA. NO cambia el estado de la cama — solo un indicador + habilita "Finalizar".
  routineCleaningActive?: boolean;
  routineCleaningId?: string;      // id de la rutina abierta (para finalizar/anular)
  routineCleaningBy?: string;      // quién la inició
  routineCleaningAt?: string;      // ISO — cuándo se inició
  // Cargas de menú de Nutrición (overlay de 15.CargasDieta, keyed por comida). Solo se
  // adjuntan si el paciente cargado coincide con el actual de la cama — evita mostrarle a
  // catering la dieta de un paciente anterior tras reasignar la cama. Ver mergeBeds.
  meals?: Partial<Record<MealSlot, MealSlotLoad>>;
  // Nombre del paciente dueño de `meals` cuando la cama ya no tiene ocupante (bandejas
  // ENTREGADAS que quedan visibles donde se sirvieron tras un traslado). Fallback de
  // patientName para el panel de comandas; lo setea mergeBeds al adjuntar el overlay.
  mealsPatientName?: string;
  // Traslado a cirugía VIVO sobre esta cama (overlay "Cx", keyed por cama_origen). En
  // EN_DEVOLUCION con cambio de cama, mergeBeds también lo adjunta sobre la cama_destino
  // (limbo, `role==='destino'`). BedsView/CirugiasView leen `cirugia.estado` para pintar la
  // pill Cx por color. Lo setea mergeBeds a partir del Map de cirugías vivas. Ver mergeBeds.
  cirugia?: BedCirugiaOverlay;
  // Marca "va a cirugía" de Admisión sobre un paciente NO quirúrgico (overlay de
  // public.cirugia_marcas ACTIVA, keyed por PACIENTE). Lo setea el useMemo `beds` AL FINAL
  // (post-move, gate patientCode && patientName) para que SIGA al paciente arrastrando cambios
  // de cama no consolidados en PROGAL. NO cambia el estado de la cama ni el Tipo. Habilita el
  // botón "Listo para cirugía" en camas no-Q; se apaga al llegar la cirugía a RECIBIDA.
  goingToSurgery?: boolean;
  goingToSurgeryMarkId?: string;
  goingToSurgeryBy?: string;
  goingToSurgeryAt?: string;
}

// Una carga de menú de Nutrición sobre una comida de la cama (fila de 15.CargasDieta).
// Menú y Opción son EXCLUYENTES → `tipo` es uno de los dos.
export interface MealLoad {
  // MENU / OPCION para dietas estándar; OTROS para dietas terapéuticas (liviana, líquida,
  // astringente…) donde no hay menú/opción y Nutrición escribe la comida en `detalle`.
  tipo: 'MENU' | 'OPCION' | 'OTROS';
  detalle?: string;       // detalle de la comanda: qué menú/opción o, en OTROS, la comida específica
  observaciones?: string;
  by: string;       // nombre del/la nutricionista que cargó (cuenta)
  operador?: string; // nombre del operador identificado (cuentas compartidas), si aplica
  at: string;       // ISO — cuándo se cargó
  spItemId: string;
  comensal?: Comensal;  // TITULAR (default) | ACOMPANANTE
  orden?: number;       // 0 titular; 1..N ordinal INMUTABLE del acompañante (lo asigna el server)
  status?: ComandaStatus;
  closedAt?: string;    // ISO — cuándo se entregó/anuló (FechaCierre_D); vacío si pendiente
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

/**
 * ¿La cama tiene al menos una bandeja PENDIENTE (aún no entregada), en cualquier turno o
 * comensal? Las anuladas no llegan acá (el GET filtra Status vivo), así que "pendiente" =
 * status distinto de ENTREGADO. Una carga con status ausente (fila vieja) cuenta como
 * pendiente: ante la duda, mejor mostrarla como algo por resolver que como ya cerrada.
 *
 * Se usa para el ícono de comanda del mapa: color fuerte si hay algo pendiente, apagado si
 * ya está todo entregado (para que se sepa que hubo comanda sin llamar a la acción).
 */
const cargaPendiente = (m?: MealLoad): boolean => !!m && m.status !== COMANDA_STATUS.ENTREGADO;
export const hasPendingMealLoad = (meals: Bed['meals']): boolean =>
  !!meals && MEAL_SLOTS.some(({ slot }) => {
    const s = meals[slot];
    return !!s && (cargaPendiente(s.titular) || s.acompanantes.some(cargaPendiente));
  });

// ── Bloqueo "sin dieta" (PROGAL) ─────────────────────────────────────────────
// Tipo de dieta del formulario PROGAL: la respuesta del ítem "Tipo" (ej. "General",
// "Líquida", "Nada por boca"). Misma semántica que api/diet-tags.ts (descripcion "tipo",
// respuesta ≠ "No") y que el dietTypeOf de BedsView — que ahora delega acá. Vive en
// types.ts y no en lib/utils porque lo consume TAMBIÉN el server (api/dietas.ts), y api/
// solo comparte código con el front a través de este módulo.
export const dietTypeFromDiets = (
  diets?: { descripcion: string; respuesta: string }[],
): string | undefined => {
  const t = diets?.find(d => d.descripcion.toLowerCase() === 'tipo');
  return t?.respuesta && t.respuesta.toLowerCase() !== 'no' ? t.respuesta : undefined;
};

// ¿Hay que bloquear la comanda del TITULAR por falta de dieta en PROGAL?
// · Solo con dato CONFIRMADO (enriched === true: el cron ya procesó la cama). Si el enrich
//   todavía no llegó devuelve false — fail-open, no se castiga por dato ausente.
// · El criterio es el TIPO de dieta y no dietTags: los chips mezclan condiciones
//   ("Diabetes") con el tipo, y una condición suelta no le dice a cocina qué cocinar.
// · NO aplica a acompañantes: su bandeja no depende de la dieta del paciente ('nada por
//   boca' es una dieta real y `titular` es opcional en MealSlotLoad por ese mismo caso).
export const titularSinDieta = (bed: Pick<Bed, 'enriched' | 'diets'>): boolean =>
  bed.enriched === true && dietTypeFromDiets(bed.diets) === undefined;
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

// ── Permisos de carga de comandas POR TURNO ─────────────────────────────────
// Derivados del catálogo: un turno nuevo en MEAL_SLOTS genera su permiso solo,
// sin tocar PERMISSIONS a mano (misma regla anti-enumeración del comentario de arriba).
export type MealSlotPermission = `cargar_comanda_${MealSlot}`;

/** Permiso granular de UN turno (p.ej. 'cargar_comanda_almuerzo'). */
export const mealSlotPermission = (slot: MealSlot): MealSlotPermission => `cargar_comanda_${slot}`;

export const MEAL_SLOT_PERMISSIONS: MealSlotPermission[] = MEAL_SLOTS.map(s => mealSlotPermission(s.slot));

/**
 * ¿Estos permisos habilitan CARGAR/EDITAR comandas de este turno?
 * `cargar_dieta` (el permiso histórico) significa TODOS los turnos: los roles productivos
 * que ya lo tienen en Permisos_RT siguen cargando todo sin migrar una sola fila de SP.
 * Los granulares son aditivos turno por turno. Pura y sobre string[] a propósito: la
 * comparten el front (via lib/permissions) y el server (api/dietas.ts, que recibe los
 * permisos crudos del role-cache).
 */
export const permitsMealSlotLoad = (perms: readonly string[], slot: MealSlot): boolean =>
  perms.includes('cargar_dieta') || perms.includes(mealSlotPermission(slot));

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

// 'CLEANINGS' se eliminó: Limpiezas dejó de ser una vista del sidebar y pasó a ser una solapa
// dentro de Operativa ('REQUESTS'). Qué solapa se muestra lo lleva `operativaSubview` en
// useHospitalState — NO es un ViewMode, porque el módulo 'Gestion Limpieza' sigue existiendo
// como permiso independiente y ambas solapas se gatean por separado.
export type ViewMode = 'HOME' | 'REQUESTS' | 'USERS' | 'HISTORY' | 'BEDS' | 'COMANDAS';

/** Solapa activa dentro de Operativa. */
export type OperativaSubview = 'traslados' | 'limpiezas' | 'cirugias';
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
  // Limpieza de RUTINA de camas ocupadas (iniciar + finalizar). UN permiso: lo hace la misma
  // persona/rol de arranque a fin (~2 veces por día por cama).
  'limpieza_rutina',
  // Mapa de Camas — comandas: cargar (Nutrición) vs ver las comandas cargadas (Catering/Nutrición).
  'cargar_dieta',
  // Carga de comandas POR TURNO (derivados de MEAL_SLOTS). `cargar_dieta` de arriba
  // sigue significando "todos los turnos" — compat con los roles productivos existentes.
  ...MEAL_SLOT_PERMISSIONS,
  'ver_dieta',
  // Gestión Comandas — planificación de menú por rango de fechas (16.CargaMenu).
  // `ver_planificacion` = abrir el modal y leer la grilla. `abm_planificacion` = crear/editar/eliminar.
  // Separados porque catering puede querer VER qué menú está planificado sin poder tocarlo.
  'ver_planificacion',
  'abm_planificacion',
  // Cirugía (traslados a quirófano) — UN permiso por acción de la máquina de estados. La
  // SUPERFICIE (mapa de camas vs solapa Operativa) decide DÓNDE aparece cada botón; el permiso,
  // SI podés hacerlo. Un rol con todos los cirugia_* gestiona el circuito entero desde Operativa;
  // la enfermera hace su parte (listo/entregar/recibir) desde el mapa.
  'cirugia_listo',      // marcar "listo para cirugía" (alta, desde la cama)
  'cirugia_buscar',     // "van a buscar" (quirófano despacha al camillero)
  'cirugia_entregar',   // "se lo llevó el camillero" (entrega de custodia)
  'cirugia_operar',     // "en cirugía"
  'cirugia_devolver',   // "en devolución" (elige destino)
  'cirugia_recibir',    // "recibí al paciente" (recepción)
  'cirugia_cancelar',   // cancelar la operatoria (transversal)
  'cirugia_marcar',     // Admisión: marcar "va a cirugía" un paciente NO quirúrgico (flag, desde el mapa)
  'abm_usuarios','abm_roles',
  // Notificaciones granulares por tipo (antes había un solo `recibe_push`).
  // Cada permiso gobierna que el usuario reciba push + in-app de ese tipo.
  'notif_new_ticket',
  'notif_status_update',
  'notif_reception_confirmed',
  'notif_diet_change',
  'notif_fasting_change',
  // Azafata marcó una habitación limpia desde el mapa → aviso a Admisión (u otro rol que
  // lo tenga tildado en el ABM). Push + campanita, mismo pipeline que los demás.
  'notif_habitacion_limpia',
  // Cirugía: a Admisión (consolidación pendiente: cambio de cama / UCI), a Quirófano (paciente
  // listo) y a la azafata del piso (camillero en camino, retiro/entrega). El mapeo tipo→permiso y
  // la emisión del push se cablean en la iteración 1c; acá solo se registran para el ABM.
  'notif_cirugia_consolidar',
  'notif_cirugia_lista',
  'notif_cirugia_camillero',
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
  // Cuenta COMPARTIDA: al loguearse la persona real se identifica con su nombre (texto libre),
  // que queda vigente en la sesión como "operador" y se registra en las transacciones. Puede
  // hacer "cambio de turno" sin desloguear. Flag del rol (requires_identification).
  requiresIdentification?: boolean;
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
  ROOM_CLEANED = 'ROOM_CLEANED', // azafata marcó limpia una habitación desde el mapa
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
  createdBy?: string;       // ConcatName_Usr del usuario que crea (cuenta)
  createdById?: string;     // ID del usuario que crea
  operador?: string;        // operador identificado (cuentas compartidas) que creó el traslado, si aplica
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

// ── Traslados a Cirugía (quirófano) ──────────────────────────────────────────
// Máquina de estados propia de un traslado a cirugía (overlay "Cx" sobre la cama, NO un
// Ticket de public.traslados). Calca el patrón de limpiezas: tabla entorno-scoped en Supabase
// (public.cirugia_traslados) + Realtime (canal 'cirugia-live'). Ver docs/planes/plan-traslados-cirugia.html.
//
// Orden de transiciones ESTRICTO (quién marca cada una) — cada paso se registra en cirugia_eventos
// para medir tiempos (camillero, quirófano, devolución):
//   LISTO_PARA_CIRUGIA  (Enfermería, o auto por admissionTypeCode==='Q')
//     → VAN_A_BUSCAR     (Cirugía — despacha al camillero, que NO usa app)
//     → EN_TRASLADO      (Enfermería — "se lo llevó el camillero": entrega de custodia)
//     → EN_CIRUGIA       (Cirugía — comenzó la cirugía)
//     → EN_DEVOLUCION    (Cirugía — elige destino: misma cama u otra de las Disponibles)
//     → RECIBIDA         (Enfermería del piso destino — cierra el circuito; la cama muere)
//   CANCELADO            (terminal; libera la cama — política D3 pendiente en el plan)
// Estados VIVOS = todos menos los terminales (RECIBIDA / CANCELADO). El índice único parcial
// garantiza UNA operatoria viva por (entorno, cama_origen).
export type CirugiaEstado =
  | 'LISTO_PARA_CIRUGIA'
  | 'VAN_A_BUSCAR'
  | 'EN_TRASLADO'
  | 'EN_CIRUGIA'
  | 'EN_DEVOLUCION'
  | 'PENDIENTE_CONSOLIDACION'
  | 'RECIBIDA'
  | 'CONSOLIDADO'
  | 'CANCELADO';

// Calca las columnas de public.cirugia_traslados (camelCase). Lean, SIN campo `tipo`: el
// contexto (quirúrgico, fecha probable, diagnóstico) se lee del enrich de la cama, no se guarda.
// Los campos server-only created_by_id / last_actor_id (exclusión del push / auditoría de la
// última transición) no se exponen al cliente.
export interface CirugiaTraslado {
  id: string;                    // uuid
  entorno: string;               // TESTING | PRODUCTIVO
  idUnivoco: string;             // idempotencia del alta (POST reintentado no duplica)
  pacienteCodigo?: string;       // identidad primaria (Gamma)
  pacienteNombre?: string;
  camaOrigen: string;            // cama donde está el paciente (clave de la operatoria viva)
  camaDestino?: string;          // se setea al devolver, solo si cambia de cama
  area?: string;                 // área/piso del origen (filtro de notis por sector + agrupar la cola)
  tipo?: string;                 // "Tipo" de la solapa Internación (admissionType: Quirúrgica/Trasplante/…). Snapshot al alta.
  estado: CirugiaEstado;
  motivoCancelacion?: string;
  operador?: string;             // operador identificado (cuentas compartidas) que dio el alta, si aplica
  version?: string;              // APP_VERSION del cliente que escribió (versionado)
  fechaCierre?: string;          // ISO — RECIBIDA / CANCELADO
  createdAt: string;             // ISO
  updatedAt: string;             // ISO
}

// Overlay que mergeBeds adjunta a una cama (`Bed.cirugia`) a partir de las cirugías VIVAS.
// Deriva de CirugiaTraslado — lean, lo justo para pintar la pill Cx y armar la cola de la
// solapa Cirugías. `role` distingue la cama de origen ('origin', donde está/estaba el paciente)
// de la cama destino en limbo ('destino', reservada en EN_DEVOLUCION con cambio de cama).
export interface BedCirugiaOverlay {
  id: string;                    // uuid de la fila (para disparar las transiciones desde la UI)
  estado: CirugiaEstado;         // color de la pill Cx
  camaOrigen: string;
  camaDestino?: string;          // seteada en EN_DEVOLUCION si cambia de cama
  pacienteNombre?: string;
  pacienteCodigo?: string;
  area?: string;
  role: 'origin' | 'destino';
}

// Marca "va a cirugía" (public.cirugia_marcas) — flag que Admisión prende sobre un PACIENTE NO
// quirúrgico para habilitar el circuito Cx en su cama. Keyed por paciente_codigo (sigue al
// paciente, no a la cama). NO es una operatoria (no entra en la cola de Cirugías). Shape del
// endpoint /api/cirugia-marcas.
export interface CirugiaMarca {
  spItemId: string;
  entorno: string;
  patientCode: string;
  patientName: string;
  bedLabel: string;              // snapshot al marcar (display; NO es la clave)
  area: string;
  estado: 'ACTIVA' | 'CERRADA' | 'ANULADA';
  markedBy: string;
  markedById?: string;
  closedBy?: string;
  operador?: string;             // operador identificado (cuentas compartidas), si aplica
  motivoCierre?: string;         // 'cirugia_recibida' | 'admision_desmarco'
  markedAt: string;              // ISO
  closedAt?: string;             // ISO — CERRADA / ANULADA
}

// Lean para el Map<patientCode, CirugiaMarcaInfo> del estado (overlay del mapa).
export interface CirugiaMarcaInfo {
  id: string;
  patientCode: string;
  patientName: string;
  bedLabel: string;
  area: string;
  by: string;                    // marcada_por (quién prendió el flag)
  at: string;                    // ISO — fecha_marca
}
