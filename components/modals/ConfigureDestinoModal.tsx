import React, { useState } from 'react';
import { Bed, BedStatus, Ticket } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Combobox } from '../ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { AlertTriangle, Info } from 'lucide-react';
import { isHitArea, isHraArea, roomSexConflict, formatBedName } from '../../lib/utils';
import { roomCheckFor } from '../../lib/roomCheck';
import { RoomCheckNotice } from '../RoomCheckNotice';
import { splitDestinationsByIsolation } from '../../lib/isolations';

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

  // Reglas de convivencia por aislamiento (Quemado / Diálisis peritoneal) — ver NewRequestModal.
  const { allowed: allowedDestinations, blocked: isolationBlocked } =
    splitDestinationsByIsolation(beds, ticket?.origin, availableDestinations);

  const sexLabel = (s?: string) => (s === 'M' ? 'Masculino' : s === 'F' ? 'Femenino' : '');
  const sexWarning = React.useMemo(
    () => (ticket?.origin && destination ? roomSexConflict(beds, ticket.origin, destination) : null),
    [beds, ticket, destination],
  );
  // Requisitos del pre-ticket + habitación compartida → el traslado espera la confirmación de la azafata.
  const roomCheck = React.useMemo(
    () => (ticket && destination ? roomCheckFor(beds, destination, ticket.origin, ticket.requisitosCama) : null),
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
      {/* Modal de formulario canónico (DESIGN §4.1). */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurar destino</DialogTitle>
          <DialogDescription>Pre-ticket de <span className="font-medium text-foreground">{ticket.patientName}</span></DialogDescription>
        </DialogHeader>
        <DialogBody>
        <form id="configure-destino-form" onSubmit={handleSubmit} className="space-y-4">

          {/* Datos del pre-ticket (solo lectura): caja de agrupación §6.1. */}
          <div className="space-y-3 p-4 bg-secondary/20 rounded-lg border border-border/50">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Paciente</span>
                <span className="text-sm font-semibold text-foreground truncate">{ticket.patientName}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Obra social</span>
                <span className="text-sm text-foreground truncate">{ticket.financier || '—'}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Origen</span>
                <span className="text-sm text-foreground truncate">{formatBedName(ticket.origin)}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Movimiento</span>
                <span className="text-sm text-foreground truncate">{ticket.changeReason || '—'}</span>
              </div>
            </div>
            {requisitos.length > 0 && (
              <div className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Requisitos</span>
                <div className="flex flex-wrap gap-1.5">
                  {requisitos.map(r => (
                    <span key={r} className="inline-flex items-center px-2 py-0.5 rounded-full border bg-card text-foreground text-[11px] font-medium">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="mb-1 block text-xs font-medium text-muted-foreground">Destino (disponible / en preparación) <span className="text-destructive">*</span></Label>
            <Combobox obligatorio
              value={destination}
              onChange={setDestination}
              opciones={allowedDestinations.map(bed => ({ label: `${bed.label} (${bed.status})`, value: bed.label }))}
              placeholder="Seleccionar Destino"
              buscar="Buscar cama de destino..."
            />
            {isolationBlocked.length > 0 && (
              // Banner info (§9.4): camas recortadas por aislamiento.
              <div className="rounded-lg border p-3 flex items-start gap-2 text-sm bg-blue-50 border-blue-200 text-blue-700">
                <Info className="size-4 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-semibold">
                    {isolationBlocked.length} cama{isolationBlocked.length > 1 ? 's' : ''} no se ofrece{isolationBlocked.length > 1 ? 'n' : ''} por reglas de aislamiento.
                  </p>
                  <p>{isolationBlocked[0].conflict.reason}</p>
                </div>
              </div>
            )}
            {sexWarning && (
              <div className="rounded-lg border p-3 flex items-start gap-2 text-sm bg-amber-50 border-amber-200 text-amber-700">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <p className="text-xs font-medium">
                  Incompatibilidad de sexo: el paciente es {sexLabel(sexWarning.patientSex)}, pero la habitación destino ya tiene pacientes de sexo {sexLabel(sexWarning.patientSex === 'M' ? 'F' : 'M')}
                  {' '}({sexWarning.roommates.map(b => `${b.label} — ${b.patientName}`).join(', ')}). No bloquea, verificá antes de confirmar.
                </p>
              </div>
            )}
            <RoomCheckNotice check={roomCheck} />
          </div>

          <div>
            <Label className="mb-1 block text-xs font-medium text-muted-foreground">Observación</Label>
            <Input placeholder="Requisitos / notas..." value={observations} onChange={e => setObservations(e.target.value)} />
          </div>
        </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            type="submit"
            form="configure-destino-form"
            disabled={!destination}
            className="min-w-[140px]"
          >
            Confirmar solicitud
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
