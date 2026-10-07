
import React from 'react';
import { TicketStatus } from '../types';
import { Badge } from './ui/badge';

interface Props {
  status: TicketStatus;
  /** Permite partir el label en dos líneas (grilla de Operativa a 1280px: "Esperando Habitación" ocupaba ~150px). */
  wrap?: boolean;
}

const statusConfig: Record<TicketStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "purple" | "fuchsia" }> = {
  [TicketStatus.PRESOLICITUD]: { label: 'Presolicitud', variant: 'fuchsia' },
  [TicketStatus.WAITING_ROOM]: { label: 'Esperando Habitación', variant: 'warning' },
  [TicketStatus.IN_TRANSIT]: { label: 'Habitación Lista', variant: 'info' },
  [TicketStatus.IN_TRANSPORT]: { label: 'En Traslado', variant: 'secondary' },
  [TicketStatus.WAITING_CONSOLIDATION]: { label: 'Por Consolidar', variant: 'purple' },
  [TicketStatus.COMPLETED]: { label: 'Consolidado', variant: 'success' },
  [TicketStatus.REJECTED]: { label: 'Cancelado', variant: 'destructive' },
};

/** Label legible de un estado (botonera de filtros de Operativa). */
export const statusLabel = (status: TicketStatus): string => statusConfig[status].label;

export const StatusBadge: React.FC<Props> = ({ status, wrap = false }) => {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} className={wrap ? 'whitespace-normal leading-tight shadow-sm' : 'whitespace-nowrap shadow-sm'}>
      {config.label}
    </Badge>
  );
};
