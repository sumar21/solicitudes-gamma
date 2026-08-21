import React, { useState } from 'react';
import { Bed, BedStatus, Ticket } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { SearchableSelect } from '../ui/searchable-select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { isHitArea, isHraArea, roomSexConflict, formatBedName } from '../../lib/utils';

// Admisión "Configura destino" de un pre-ticket: elige la cama destino y ajusta la observación.
// Paciente/origen/movimiento/requisitos vienen precargados en solo-lectura. Ver docs/planes/pre-ticket.md.
interface ConfigureDestinoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket | null;
  beds: Bed[];
  activeTransferDestinations?: Set<string>;
  onConfirm: (id: string, data: { destination: string; observations?: string }) => void;
}

export const ConfigureDestinoModal: React.FC<ConfigureDestinoModalProps> = ({
  open, onOpenChange, ticket, beds, activeTransferDestinations = new Set(), onConfirm,
}) => {
  const [destination, setDestination] = useState('');
  const [observations, setObservations] = useState('');

  React.useEffect(() => {
    if (open && ticket) {
      setDestination('');
      setObservations(ticket.observations ?? '');
    }
  }, [open, ticket]);

  const availableDestinations = beds
    .filter(b => b.status === BedStatus.AVAILABLE || b.status === BedStatus.PREPARATION)
    .filter(b => !isHitArea(b.area) && !isHraArea(b.area))
    .filter(b => !activeTransferDestinations.has(b.label))
    .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }));

  const sexLabel = (s?: string) => (s === 'M' ? 'Masculino' : s === 'F' ? 'Femenino' : '');
  const sexWarning = React.useMemo(
    () => (ticket?.origin && destination ? roomSexConflict(beds, ticket.origin, destination) : null),
    [beds, ticket, destination],
  );

  if (!ticket) return null;

  const requisitos = ticket.requisitosCama ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination) return;
    onConfirm(ticket.id, { destination, observations: observations.trim() !== '' ? observations : undefined });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] rounded-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-xl pr-6">Configurar Destino</DialogTitle></DialogHeader>
        <form id="configure-destino-form" onSubmit={handleSubmit} className="grid gap-4 py-2">

          {/* Datos del pre-ticket (solo lectura) */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 grid gap-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Paciente</span>
                <span className="text-sm font-semibold text-slate-800 truncate">{ticket.patientName}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Obra Social</span>
                <span className="text-sm text-slate-700 truncate">{ticket.financier || '—'}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Origen</span>
                <span className="text-sm text-slate-700 truncate">{formatBedName(ticket.origin)}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Movimiento</span>
                <span className="text-sm text-slate-700 truncate">{ticket.changeReason || '—'}</span>
              </div>
            </div>
            {requisitos.length > 0 && (
              <div className="grid gap-1">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Requisitos</span>
                <div className="flex flex-wrap gap-1.5">
                  {requisitos.map(r => (
                    <span key={r} className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Destino (Disponible/Prep) <span className="text-red-500">*</span></Label>
            <SearchableSelect
              value={destination}
              onValueChange={setDestination}
              options={availableDestinations.map(bed => ({ label: `${bed.label} (${bed.status})`, value: bed.label }))}
              placeholder="Seleccionar Destino"
              searchPlaceholder="Buscar cama de destino..."
            />
            {sexWarning && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                <span className="w-2 h-2 mt-1 rounded-full bg-amber-500 shrink-0" />
                <p className="text-xs font-medium text-amber-800">
                  Incompatibilidad de sexo: el paciente es {sexLabel(sexWarning.patientSex)}, pero la habitación destino ya tiene pacientes de sexo {sexLabel(sexWarning.patientSex === 'M' ? 'F' : 'M')}
                  {' '}({sexWarning.roommates.map(b => `${b.label} — ${b.patientName}`).join(', ')}). No bloquea, verificá antes de confirmar.
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Observación</Label>
            <Input placeholder="Requisitos / notas..." value={observations} onChange={e => setObservations(e.target.value)} className="h-10 rounded-xl" />
          </div>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10 px-6">Cancelar</Button>
          <Button
            type="submit"
            form="configure-destino-form"
            disabled={!destination}
            className="bg-emerald-950 text-white rounded-xl h-10 px-8 disabled:opacity-50"
          >
            Confirmar Solicitud
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
