
import React from 'react';
import { Card } from '../ui/card';
import { TicketStatus } from '../../types';

interface StatusDonutChartProps {
  data: { status: TicketStatus; count: number; color: string; label: string }[];
}

export const StatusDonutChart: React.FC<StatusDonutChartProps> = ({ data }) => {
  const total = data.reduce((acc, d) => acc + d.count, 0);
  let currentAngle = 0;

  return (
    <Card className="p-6 border-slate-200 bg-white flex flex-col sm:flex-row items-center gap-8">
      <div className="relative w-32 h-32 shrink-0">
        <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
          {total === 0 ? (
            <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#f1f5f9" strokeWidth="3" />
          ) : (
            data.map((d, i) => {
              const percentage = (d.count / total) * 100;
              const strokeDasharray = `${percentage} ${100 - percentage}`;
              const strokeDashoffset = -currentAngle;
              currentAngle += percentage;
              
              return (
                <circle
                  key={d.status || i}
                  cx="18"
                  cy="18"
                  r="15.915"
                  fill="transparent"
                  stroke={d.color}
                  strokeWidth="3.5"
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-700 ease-in-out"
                />
              );
            })
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black text-slate-900 tabular-nums leading-none">{total}</span>
          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1">Total</span>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 gap-y-3 w-full">
        {data.map((d, i) => (
          <div key={d.status || i} className="flex items-center justify-between group">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight group-hover:text-slate-900 transition-colors">{d.label}</span>
            </div>
            <span className="text-xs font-black text-slate-900 tabular-nums">
              {d.count} <span className="text-[9px] text-slate-300 font-bold ml-1">{total > 0 ? Math.round((d.count / total) * 100) : 0}%</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};
