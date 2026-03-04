
import { Area, Bed, BedStatus, Ticket, TicketStatus, WorkflowType, SedeType } from "../types";

// Deterministic pseudo-random generator (seeded, no Math.random())
// Ensures beds are ALWAYS the same across reloads → correlates with Operativa
function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

const PATIENT_NAMES = [
  'García, Juan', 'López, María', 'Martínez, Carlos', 'Rodríguez, Ana',
  'Fernández, Luis', 'González, Elena', 'Pérez, Ricardo', 'Sánchez, Laura',
  'Ramírez, Pablo', 'Torres, Sofía', 'Flores, Diego', 'Morales, Valeria',
  'Ruiz, Andrés', 'Vargas, Claudia', 'Herrera, Marcos', 'Castro, Patricia',
  'Romero, Federico', 'Jiménez, Cecilia', 'Álvarez, Tomás', 'Díaz, Natalia',
  'Benítez, Hugo', 'Acosta, Julia', 'Medina, Roberto', 'Silva, Daniela'
];

export const generateMockBeds = (): Bed[] => {
  const beds: Bed[] = [];
  const areas = Object.values(Area);
  const rand = seededRand(42); // fixed seed → always same result

  let bedIdCounter = 1;
  let patientIdx = 0;

  areas.forEach(area => {
    for (let i = 1; i <= 10; i++) {
      const r = rand();
      let status = BedStatus.AVAILABLE;
      let patientName: string | undefined = undefined;

      if (r > 0.6) {
        status = BedStatus.OCCUPIED;
        patientName = PATIENT_NAMES[patientIdx % PATIENT_NAMES.length];
        patientIdx++;
      } else if (r > 0.4) {
        status = BedStatus.PREPARATION;
      }

      beds.push({
        id: `BED-${bedIdCounter++}`,
        label: `${area} - Cama ${i}`,
        area: area,
        status,
        patientName,
      });
    }
  });

  return beds;
};

export const generateMockTickets = (): Ticket[] => {
  const tickets: Ticket[] = [];
  const rand = seededRand(123); // Different seed for tickets
  const now = new Date();
  
  // Helper to subtract minutes from a date
  const subMinutes = (date: Date, min: number) => new Date(date.getTime() - min * 60000);
  // Helper to format time HH:mm
  const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Helper to format date YYYY-MM-DD
  const fmtDate = (d: Date) => d.toISOString().split('T')[0];

  for (let i = 0; i < 25; i++) {
    const isRejected = rand() > 0.85;
    const daysAgo = Math.floor(rand() * 7);
    const baseDate = new Date(now);
    baseDate.setDate(baseDate.getDate() - daysAgo);
    // Random time during the day (8am - 8pm)
    baseDate.setHours(8 + Math.floor(rand() * 12), Math.floor(rand() * 60));

    const createdAt = baseDate;
    const bedAssignedAt = new Date(createdAt.getTime() + Math.floor(rand() * 5 + 1) * 60000); // +1-5 min
    
    let cleaningDoneAt: Date | undefined;
    let transportStartedAt: Date | undefined;
    let receptionConfirmedAt: Date | undefined;
    let completedAt: Date;

    const workflow = rand() > 0.7 ? WorkflowType.ITR_TO_FLOOR : (rand() > 0.4 ? WorkflowType.INTERNAL : WorkflowType.ROOM_CHANGE);
    const patientName = PATIENT_NAMES[Math.floor(rand() * PATIENT_NAMES.length)];
    const origin = `PISO_${Math.floor(rand() * 4 + 4)} - Cama ${Math.floor(rand() * 10 + 1)}`;
    const destination = `PISO_${Math.floor(rand() * 4 + 4)} - Cama ${Math.floor(rand() * 10 + 1)}`;

    if (isRejected) {
      completedAt = new Date(createdAt.getTime() + Math.floor(rand() * 30 + 10) * 60000); // +10-40 min
      tickets.push({
        id: `TKT-HIST-${1000 + i}`,
        sede: SedeType.HPR,
        patientName,
        origin,
        destination,
        workflow,
        status: TicketStatus.REJECTED,
        createdAt: fmtTime(createdAt),
        date: fmtDate(createdAt),
        completedAt: fmtTime(completedAt),
        rejectionReason: rand() > 0.5 ? "Paciente no en condiciones" : "Cama no disponible por mantenimiento",
        isBedClean: false,
        isReasonValidated: true
      });
    } else {
      // Successful flow
      const needsCleaning = rand() > 0.3;
      
      if (needsCleaning) {
        cleaningDoneAt = new Date(bedAssignedAt.getTime() + Math.floor(rand() * 30 + 15) * 60000); // +15-45 min
      }
      
      const readyForTransport = cleaningDoneAt || bedAssignedAt;
      transportStartedAt = new Date(readyForTransport.getTime() + Math.floor(rand() * 15 + 5) * 60000); // +5-20 min
      receptionConfirmedAt = new Date(transportStartedAt.getTime() + Math.floor(rand() * 20 + 10) * 60000); // +10-30 min
      completedAt = new Date(receptionConfirmedAt.getTime() + Math.floor(rand() * 60 + 5) * 60000); // +5-65 min

      tickets.push({
        id: `TKT-HIST-${1000 + i}`,
        sede: SedeType.HPR,
        patientName,
        origin,
        destination,
        workflow,
        status: TicketStatus.COMPLETED,
        createdAt: fmtTime(createdAt),
        date: fmtDate(createdAt),
        bedAssignedAt: fmtTime(bedAssignedAt),
        cleaningDoneAt: cleaningDoneAt ? fmtTime(cleaningDoneAt) : undefined,
        transportStartedAt: fmtTime(transportStartedAt),
        receptionConfirmedAt: fmtTime(receptionConfirmedAt),
        completedAt: fmtTime(completedAt),
        isBedClean: !needsCleaning,
        isReasonValidated: true,
        itrSource: workflow === WorkflowType.ITR_TO_FLOOR ? "GUARDIA EXTERNA" : undefined,
        changeReason: workflow === WorkflowType.ROOM_CHANGE ? "Solicitud familiar" : undefined,
        targetBedOriginalStatus: needsCleaning ? BedStatus.PREPARATION : BedStatus.AVAILABLE
      });
    }
  }

  return tickets.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
};

// Compatibility exports
export const MOCK_API_RESPONSE: any[] = [];
export const transformApiDataToBeds = () => generateMockBeds();
