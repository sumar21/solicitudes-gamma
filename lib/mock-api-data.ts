
import { Area, Bed, BedStatus } from "../types";

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

// Compatibility exports
export const MOCK_API_RESPONSE: any[] = [];
export const transformApiDataToBeds = () => generateMockBeds();
