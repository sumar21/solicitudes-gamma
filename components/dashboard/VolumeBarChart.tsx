
import React from 'react';
import { Card } from '../ui/card';
import { WorkflowType } from '../../types';

interface VolumeBarChartProps {
  data: { label: string; value: number; type: WorkflowType }[];
}

export const VolumeBarChart: React.FC<VolumeBarChartProps> = ({ data }) => {
  const maxValue = Math.max(...data.map(d => d.value), 1);

  return (
    <Card className="p-6 border-slate-200 bg-white">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h4 className="text-xs font-black uppercase tracking-[0.15em] text-slate-900">Volumen por Workflow</h4>
          <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Distribución de Solicitudes</p>
        </div>
      </div>
      
      <div className="space-y-6">
        {data.map((item) => (
          <div key={item.type} className="space-y-2">
            <div className="flex justify-between items-end">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-tight">{item.label}</span>
              <span className="text-sm font-black text-slate-900 tabular-nums">{item.value}</span>
            </div>
            <div className="h-2 w-full bg-slate-50 rounded-full overflow-hidden border border-slate-100">
              <div 
                className="h-full bg-emerald-950 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${(item.value / maxValue) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
