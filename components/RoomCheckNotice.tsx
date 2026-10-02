import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { RoomCheck } from '../lib/roomCheck';

/**
 * Aviso para quien ASIGNA el destino (Admisión): este traslado no va a pasar directo a "Habitación
 * Lista" sino que queda "Esperando Habitación" hasta que la azafata confirme que está armada. No
 * bloquea nada — sólo evita la sorpresa de "elegí una cama verde y el traslado no salió".
 * Ver lib/roomCheck.ts.
 */
export const RoomCheckNotice: React.FC<{ check: RoomCheck | null }> = ({ check }) => {
  if (!check?.required) return null;
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200">
      <ClipboardCheck className="w-3.5 h-3.5 mt-0.5 text-sky-600 shrink-0" />
      <div className="text-xs font-medium text-sky-900 leading-snug">
        <p>
          La azafata tiene que confirmar la habitación antes de trasladar al paciente
          <span className="font-bold"> (queda “Esperando Habitación” aunque la cama figure Disponible)</span>.
        </p>
        <ul className="mt-1 list-disc pl-4 space-y-0.5 text-sky-800">
          {check.shared && (
            <li>
              Habitación compartida: la cama contigua está ocupada
              {check.neighbors.length > 0 && ` (${check.neighbors.map(b => b.label).join(', ')})`}.
            </li>
          )}
          {check.requisitos.length > 0 && <li>Requiere: {check.requisitos.join(', ')}.</li>}
        </ul>
      </div>
    </div>
  );
};
