import React from 'react';
import { Bed, Ticket } from '../types';
import { AlertCircle } from './Icons';
import { cn } from '../lib/utils';
import { describeOriginBedBusy } from '../lib/originBed';

// Aviso inline de "la cama de origen ya tiene un ticket activo", ANTES de enviar (NewRequestModal y
// PreTicketModal). Mismo texto que el appAlert del hook. Ámbar si el ticket es del mismo paciente; rojo
// si es de otro (huérfano o traslado sin cerrar), que es el caso que hay que resolver en Operativa.
export const OriginBedBusyNotice: React.FC<{ ticket: Ticket; beds: Bed[] }> = ({ ticket, beds }) => {
  const { title, message, otherPatient } = describeOriginBedBusy(ticket, beds);
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
        otherPatient ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50',
      )}
    >
      <AlertCircle className={cn('mt-0.5 h-4 w-4 shrink-0', otherPatient ? 'text-red-600' : 'text-amber-600')} />
      <div className="min-w-0">
        <p className={cn('text-xs font-bold leading-snug', otherPatient ? 'text-red-900' : 'text-amber-900')}>{title}</p>
        <p className={cn('mt-0.5 text-xs leading-snug break-words', otherPatient ? 'text-red-800' : 'text-amber-800')}>{message}</p>
      </div>
    </div>
  );
};
