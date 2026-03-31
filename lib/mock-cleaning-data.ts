import { CleaningTask, CleaningTaskType, ChecklistItem, Area, MaintenanceItem } from '../types';

const POST_DISCHARGE_CHECKLIST: Omit<ChecklistItem, 'id'>[] = [
  { label: 'Sanitización completa de habitación', checked: false },
  { label: 'Cambio completo de ropa de cama', checked: false },
  { label: 'Limpieza profunda de baño', checked: false },
  { label: 'Desinfección de superficies y mobiliario', checked: false },
  { label: 'Reposición de insumos (jabón, papel, etc.)', checked: false },
  { label: 'Verificación de funcionamiento de equipos', checked: false },
];

const DAILY_CHECKLIST: Omit<ChecklistItem, 'id'>[] = [
  { label: 'Repaso de baños y sanitización básica', checked: false },
  { label: 'Limpieza de pisos', checked: false },
  { label: 'Limpieza de superficies', checked: false },
  { label: 'Reposición de insumos', checked: false },
];

// ── Maintenance checklist template (hospital room inspection) ────────────────
const MAINTENANCE_TEMPLATE: Omit<MaintenanceItem, 'id'>[] = [
  { label: 'Luz de techo / plafón', category: 'Electricidad', status: 'pending' },
  { label: 'Luz de velador / cabecera', category: 'Electricidad', status: 'pending' },
  { label: 'Enchufes y tomacorrientes', category: 'Electricidad', status: 'pending' },
  { label: 'Llamador de enfermería', category: 'Electricidad', status: 'pending' },
  { label: 'Grifo lavatorio', category: 'Plomería', status: 'pending' },
  { label: 'Grifo ducha / bañera', category: 'Plomería', status: 'pending' },
  { label: 'Descarga inodoro', category: 'Plomería', status: 'pending' },
  { label: 'Desagües (sin obstrucciones)', category: 'Plomería', status: 'pending' },
  { label: 'Cama articulada (mecanismo)', category: 'Mobiliario', status: 'pending' },
  { label: 'Mesa de comer', category: 'Mobiliario', status: 'pending' },
  { label: 'Silla / sillón acompañante', category: 'Mobiliario', status: 'pending' },
  { label: 'Puerta de habitación', category: 'Infraestructura', status: 'pending' },
  { label: 'Puerta de baño', category: 'Infraestructura', status: 'pending' },
  { label: 'Ventana (cierre y persiana)', category: 'Infraestructura', status: 'pending' },
  { label: 'Aire acondicionado / calefacción', category: 'Climatización', status: 'pending' },
  { label: 'TV / control remoto', category: 'Equipamiento', status: 'pending' },
];

export function makeChecklist(template: Omit<ChecklistItem, 'id'>[], taskId: string): ChecklistItem[] {
  return template.map((item, i) => ({
    ...item,
    id: `${taskId}-CK-${i}`,
  }));
}

export function makeMaintenanceChecklist(taskId: string): MaintenanceItem[] {
  return MAINTENANCE_TEMPLATE.map((item, i) => ({
    ...item,
    id: `${taskId}-MT-${i}`,
  }));
}

// Rooms used for daily tasks (occupied rooms)
const DAILY_ROOMS = [
  { roomCode: '401', bedCode: '01', area: Area.PISO_4, label: 'Internacion 4° Piso HPR - Cama 01' },
  { roomCode: '403', bedCode: '02', area: Area.PISO_4, label: 'Internacion 4° Piso HPR - Cama 06' },
  { roomCode: '409', bedCode: '01', area: Area.PISO_4, label: 'Internacion 4° Piso HPR - Cama 13' },
  { roomCode: '501', bedCode: '01', area: Area.PISO_5, label: 'Internacion 5° Piso HPR - Cama 01' },
  { roomCode: '503', bedCode: '02', area: Area.PISO_5, label: 'Internacion 5° Piso HPR - Cama 06' },
  { roomCode: '510', bedCode: '01', area: Area.PISO_5, label: 'Internacion 5° Piso HPR - Cama 15' },
  { roomCode: '601', bedCode: '01', area: Area.PISO_6, label: 'Internacion 6° Piso HPR - Cama 01' },
  { roomCode: '605', bedCode: '02', area: Area.PISO_6, label: 'Internacion 6° Piso HPR - Cama 10' },
  { roomCode: '701', bedCode: '01', area: Area.PISO_7, label: 'Internacion 7° Piso HPR - Cama 01' },
  { roomCode: '801', bedCode: '02', area: Area.PISO_8, label: 'Internacion 8° Piso HPR - Cama 02' },
];

// Checklist template for post-discharge — exported so useHospitalState can use it
export const POST_DISCHARGE_TEMPLATE = POST_DISCHARGE_CHECKLIST;

export function generateMockDailyTasks(): CleaningTask[] {
  const now = new Date();
  const tasks: CleaningTask[] = [];

  // Daily routine tasks with maintenance checklist included
  DAILY_ROOMS.forEach((room, i) => {
    const id = `CLN-DIA-${String(i + 1).padStart(3, '0')}`;
    const hour = 7 + Math.floor(i / 3);
    const assignedAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0).toISOString();
    tasks.push({
      id,
      roomLabel: room.label,
      area: room.area,
      roomCode: room.roomCode,
      bedCode: room.bedCode,
      type: CleaningTaskType.DAILY_ROUTINE,
      checklist: makeChecklist(DAILY_CHECKLIST, id),
      maintenanceChecklist: makeMaintenanceChecklist(id),
      completed: false,
      assignedAt,
      priority: 'normal',
    });
  });

  return tasks;
}
