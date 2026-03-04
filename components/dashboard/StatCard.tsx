
import React from 'react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { TrendingUp, TrendingDown } from '../Icons';

interface StatCardProps {
  title: string;
  value: string | number;
  description: string;
  trend?: {
    value: string;
    positive: boolean;
  };
  icon: React.ReactNode;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ title, value, description, trend, icon, className }) => (
  <Card className={cn("p-6 hover:shadow-md transition-all border-slate-200 bg-white group overflow-hidden relative", className)}>
    <div className="absolute right-0 top-0 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity pointer-events-none">
      {/* Fix: Use React.ReactElement<any> to satisfy TypeScript about the 'size' prop on cloned elements */}
      {React.cloneElement(icon as React.ReactElement<any>, { size: 80 })}
    </div>
    <div className="flex justify-between items-start mb-4">
      <div className="p-2 bg-slate-50 rounded-xl border border-slate-100 text-slate-900 shadow-sm">
        {/* Fix: Use React.ReactElement<any> to satisfy TypeScript about the 'size' prop on cloned elements */}
        {React.cloneElement(icon as React.ReactElement<any>, { size: 20 })}
      </div>
      {trend && (
        <Badge variant={trend.positive ? "success" : "destructive"} className="text-[10px] font-black tracking-tight rounded-full px-2">
          {trend.positive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
          {trend.value}
        </Badge>
      )}
    </div>
    <div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">{title}</p>
      <h3 className="text-3xl font-bold text-slate-900 tracking-tighter tabular-nums leading-none mb-2">{value}</h3>
      <p className="text-[11px] font-medium text-slate-500 leading-none">{description}</p>
    </div>
  </Card>
);
