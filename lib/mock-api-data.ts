
import { Area, Bed, BedStatus } from "../types";

export const generateMockBeds = (): Bed[] => {
  const beds: Bed[] = [];
  const areas = Object.values(Area);
  
  let bedIdCounter = 1;

  areas.forEach(area => {
    // Generate 10 beds per area
    for (let i = 1; i <= 10; i++) {
      const rand = Math.random();
      let status = BedStatus.AVAILABLE;
      let patientName = undefined;

      if (rand > 0.6) {
        status = BedStatus.OCCUPIED;
        patientName = `Paciente ${Math.floor(Math.random() * 1000)}`;
      } else if (rand > 0.4) {
        status = BedStatus.PREPARATION;
      }

      beds.push({
        id: `BED-${bedIdCounter++}`,
        label: `${area} - Cama ${i}`,
        area: area,
        status: status,
        patientName: patientName
      });
    }
  });

  return beds;
};

// We export this for compatibility if needed, but we'll use generateMockBeds directly
export const MOCK_API_RESPONSE: any[] = [];
export const transformApiDataToBeds = () => generateMockBeds();
