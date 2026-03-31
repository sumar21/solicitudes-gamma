import { CleaningTask, CleaningTaskType, ChecklistItem, Area } from '../types';

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

function makeChecklist(template: Omit<ChecklistItem, 'id'>[], taskId: string): ChecklistItem[] {
  return template.map((item, i) => ({
    ...item,
    id: `${taskId}-CK-${i}`,
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

// Rooms for post-discharge (linked to transfers)
const DISCHARGE_ROOMS = [
  { roomCode: '421', bedCode: '01', area: Area.PISO_4, label: 'Internacion 4° Piso HPR - Cama 07', patientName: 'GONZALEZ, MARIA ELENA', ticketId: 'TSL-DEMO-001' },
  { roomCode: '525', bedCode: '01', area: Area.PISO_5, label: 'Internacion 5° Piso HPR - Cama 09', patientName: 'FERNANDEZ, CARLOS ALBERTO', ticketId: 'TSL-DEMO-002' },
  { roomCode: '613', bedCode: '02', area: Area.PISO_6, label: 'Internacion 6° Piso HPR - Cama 12', patientName: 'MARTINEZ, ANA LUCIA', ticketId: 'TSL-DEMO-003' },
];

export function generateMockCleaningTasks(): CleaningTask[] {
  const now = new Date();
  const tasks: CleaningTask[] = [];

  // Post-discharge tasks (urgent, from transfers)
  DISCHARGE_ROOMS.forEach((room, i) => {
    const id = `CLN-ALT-${String(i + 1).padStart(3, '0')}`;
    const assignedAt = new Date(now.getTime() - (30 + i * 15) * 60000).toISOString();
    tasks.push({
      id,
      roomLabel: room.label,
      area: room.area,
      roomCode: room.roomCode,
      bedCode: room.bedCode,
      type: CleaningTaskType.POST_DISCHARGE,
      checklist: makeChecklist(POST_DISCHARGE_CHECKLIST, id),
      completed: false,
      assignedAt,
      linkedTicketId: room.ticketId,
      priority: 'urgent',
      patientName: room.patientName,
    });
  });

  // Daily routine tasks
  DAILY_ROOMS.forEach((room, i) => {
    const id = `CLN-DIA-${String(i + 1).padStart(3, '0')}`;
    const hour = 7 + Math.floor(i / 3); // stagger across morning
    const assignedAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0).toISOString();
    tasks.push({
      id,
      roomLabel: room.label,
      area: room.area,
      roomCode: room.roomCode,
      bedCode: room.bedCode,
      type: CleaningTaskType.DAILY_ROUTINE,
      checklist: makeChecklist(DAILY_CHECKLIST, id),
      completed: false,
      assignedAt,
      priority: 'normal',
    });
  });

  return tasks;
}
