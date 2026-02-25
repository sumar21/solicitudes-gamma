
import React from 'react';
import { TicketStatus } from '../types';
import { Badge } from './ui/badge';

interface Props {
  status: TicketStatus;
}

const statusConfig: Record<TicketStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "purple" }> = {
  [TicketStatus.WAITING_ROOM]: { label: 'Esperando Habitación', variant: 'warning' },
  [TicketStatus.IN_TRANSIT]: { label: 'Habitación Lista', variant: 'info' },
  [TicketStatus.IN_TRANSPORT]: { label: 'En Traslado', variant: 'secondary' },
  [TicketStatus.WAITING_CONSOLIDATION]: { label: 'Por Consolidar', variant: 'purple' },
  [TicketStatus.COMPLETED]: { label: 'Finalizado', variant: 'success' },
  [TicketStatus.REJECTED]: { label: 'Rechazado', variant: 'destructive' },
};

export const StatusBadge: React.FC<Props> = ({ status }) => {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} className="whitespace-nowrap shadow-sm">
      {config.label}
    </Badge>
  );
};
