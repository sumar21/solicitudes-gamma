
import React from 'react';
import { Bed, BedStatus } from '../types';
import { Card } from '../components/ui/card';
import { cn } from '../lib/utils';
import { BedDouble, User } from 'lucide-react';

interface BedsViewProps {
  beds: Bed[];
}

export const BedsView: React.FC<BedsViewProps> = ({ beds }) => {
  // Group beds by Area
  const bedsByArea: Record<string, Bed[]> = {};
  beds.forEach(bed => {
    if (!bedsByArea[bed.area]) bedsByArea[bed.area] = [];
    bedsByArea[bed.area].push(bed);
  });

  const getStatusColor = (status: BedStatus) => {
    switch (status) {
      case BedStatus.AVAILABLE: return "bg-emerald-100 text-emerald-700 border-emerald-200";
      case BedStatus.OCCUPIED: return "bg-red-100 text-red-700 border-red-200";
      case BedStatus.PREPARATION: return "bg-amber-100 text-amber-700 border-amber-200";
      case BedStatus.ASSIGNED: return "bg-indigo-100 text-indigo-700 border-indigo-300"; // En tránsito / reservada
      case BedStatus.DISABLED: return "bg-slate-100 text-slate-500 border-slate-200";
      default: return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Mapa de Camas (Tiempo Real)</h2>
        <p className="text-slate-500">Visualización del estado actual de las camas según integración PROGAL + Movimientos Internos</p>
      </div>

      <div className="grid gap-8">
        {Object.entries(bedsByArea).map(([area, areaBeds]) => (
          <div key={area} className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-800 border-b border-slate-200 pb-2">{area}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {areaBeds.map(bed => (
                <Card key={bed.id} className={cn("p-4 border shadow-sm transition-all hover:shadow-md", getStatusColor(bed.status))}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="p-2 bg-white/50 rounded-lg">
                      <BedDouble className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-white/50 rounded-full">
                      {bed.status}
                    </span>
                  </div>
                  <div className="mt-2">
                    <h4 className="font-bold text-sm">{bed.label}</h4>
                    {bed.status === BedStatus.OCCUPIED && (
                      <div className="flex items-center gap-2 mt-1 text-xs font-medium opacity-80">
                        <User className="w-3 h-3" />
                        <span>{bed.patientName || 'Paciente Desconocido'}</span>
                      </div>
                    )}
                    {bed.status === BedStatus.ASSIGNED && (
                      <div className="flex items-center gap-2 mt-1 text-xs font-medium opacity-80">
                        <User className="w-3 h-3" />
                        <span className="italic">Destino reservado — en tránsito</span>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
