
import React, { useState } from 'react';
import { Area, Bed, BedStatus, Ticket, WorkflowType } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Combobox } from '../ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { ROOM_CHANGE_REASONS } from '../../lib/constants';
import { formatBedName, isHitArea, isHraArea } from '../../lib/utils';
import { roomCheckFor } from '../../lib/roomCheck';
import { RoomCheckNotice } from '../RoomCheckNotice';
import { splitDestinationsByIsolation } from '../../lib/isolations';
import { puedeRestablecerDestino } from '../../lib/originBed';

// Same ordering used elsewhere: pre-internación (HRA, HIT) first, then floors, then critical units
const AREA_ORDER: Area[] = [
  Area.HRA, Area.HIT,
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8,
  Area.HUC, Area.HUT, Area.HUQ, Area.HSS,
];
// Label canónico de campo (DESIGN §3.3) y control de solo lectura (dato que no se edita acá).
const claseLabel = 'mb-1 block text-xs font-medium text-muted-foreground';
const claseSoloLectura = 'bg-muted/50 text-muted-foreground cursor-not-allowed focus-visible:ring-0 focus-visible:ring-offset-0';

const areaRank = (a?: Area | string) => {
  const idx = AREA_ORDER.indexOf(a as Area);
  return idx === -1 ? AREA_ORDER.length : idx;
};
const sortByAreaThenLabel = (a: Bed, b: Bed) => {
  const ra = areaRank(a.area);
  const rb = areaRank(b.area);
  if (ra !== rb) return ra - rb;
  return a.label.localeCompare(b.label, 'es', { numeric: true });
};

export interface EditRequestPayload {
  ticketId: string;
  patientName: string;
  origin: string;
  destination: string;
  workflow: WorkflowType;
  reason?: string;
  itrSource?: string;
  observations?: string;
  modificationReason: string;
}

interface EditRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket | null;
  beds: Bed[];
  activeTransferDestinations?: Set<string>;
  onSave: (data: EditRequestPayload) => void;
  /** "Restablecer destino" de un pre-ticket configurado: vuelve a Presolicitud y libera la cama. */
  onResetDestino?: (ticketId: string, motivo?: string, destinoVisto?: string | null) => Promise<boolean>;
}

export const EditRequestModal: React.FC<EditRequestModalProps> = ({ open, onOpenChange, ticket, beds, activeTransferDestinations = new Set(), onSave, onResetDestino }) => {
  const [workflow, setWorkflow] = useState<WorkflowType>(WorkflowType.INTERNAL);
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [itrSource, setItrSource] = useState('');
  const [observations, setObservations] = useState('');
  const [modificationReason, setModificationReason] = useState('');
  // "Restablecer destino": confirmación inline (nunca confirm() nativo) + en curso.
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Guarda el ticket.id ya prefileado para no re-prefilear en cada actualización
  // del objeto `ticket` por polling (sino se pisa lo que el usuario está tipeando).
  const prefilledTicketIdRef = React.useRef<string | null>(null);

  // Prefill when ticket changes / modal opens
  React.useEffect(() => {
    if (!open || !ticket) {
      if (!open) prefilledTicketIdRef.current = null; // reset al cerrar para re-prefilear en la próxima apertura
      return;
    }
    // Solo prefilea en la apertura o al cambiar de ticket; NO en cada poll que
    // refresque el objeto ticket mientras el modal está abierto.
    if (prefilledTicketIdRef.current === ticket.id) return;
    prefilledTicketIdRef.current = ticket.id;
    // Tickets legacy con workflow ROOM_CHANGE se editan como INTERNAL (fusionado).
    const effectiveWorkflow = ticket.workflow === WorkflowType.ROOM_CHANGE
      ? WorkflowType.INTERNAL
      : ticket.workflow;
    setWorkflow(effectiveWorkflow);
    setDestination(ticket.destination ?? '');
    setReason(ticket.changeReason ?? '');
    setItrSource(ticket.itrSource ?? '');
    setObservations(ticket.observations ?? '');
    setModificationReason('');
    setConfirmReset(false);
  }, [open, ticket]);

  if (!ticket) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination) return;
    if (workflow === WorkflowType.INTERNAL && !reason) return;
    if (!modificationReason.trim()) return;

    onSave({
      ticketId: ticket.id,
      patientName: ticket.patientName,
      origin: ticket.origin,
      destination,
      workflow,
      reason: workflow === WorkflowType.INTERNAL ? reason : undefined,
      itrSource: workflow === WorkflowType.ITR_TO_FLOOR ? itrSource : undefined,
      observations: observations.trim() !== '' ? observations : undefined,
      modificationReason: modificationReason.trim(),
    });

    onOpenChange(false);
  };

  // Available destinations: free/prep beds + the ticket's current destination (so it stays visible).
  // Excluye ITR como destino y oculta camas ya asignadas a OTROS tickets activos
  // (la cama actual del propio ticket sí queda disponible).
  const currentDestBed = ticket.destination ? beds.find(b => b.label === ticket.destination) : null;
  const availableDestinations = beds
    .filter(b => b.status === BedStatus.AVAILABLE || b.status === BedStatus.PREPARATION || b.label === ticket.destination)
    .filter(b => (!isHitArea(b.area) && !isHraArea(b.area)) || b.label === ticket.destination)
    .filter(b => b.label === ticket.destination || !activeTransferDestinations.has(b.label))
    .sort(sortByAreaThenLabel);

  // Reglas de convivencia por aislamiento (Quemado / Diálisis peritoneal) — ver NewRequestModal.
  // El destino YA cargado nunca se excluye: si no, el select quedaría apuntando a una opción
  // inexistente y una edición de observación borraría el destino sin querer.
  const { allowed: allowedDestinations, blocked: isolationBlocked } =
    splitDestinationsByIsolation(beds, ticket.origin, availableDestinations, ticket.destination);

  const destinationChanged = destination !== (ticket.destination ?? '');
  // Si cambia el destino, handleEditTicket recalcula el estado con la misma regla que el alta.
  const roomCheck = destinationChanged && destination
    ? roomCheckFor(beds, destination, ticket.origin, ticket.requisitosCama)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Modal de formulario canónico (DESIGN §4.1); 2xl porque lleva filas de dos campos. */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar traslado</DialogTitle>
          <DialogDescription>Ticket <span className="font-mono font-medium text-foreground">{ticket.id}</span></DialogDescription>
        </DialogHeader>
        <DialogBody>
        <form id="edit-ticket-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className={claseLabel}>Tipo de escenario <span className="text-destructive">*</span></Label>
            <Combobox obligatorio
              value={workflow}
              onChange={(val) => {
                const next = val as WorkflowType;
                if (next !== workflow) {
                  setItrSource('');
                  setReason('');
                }
                setWorkflow(next);
              }}
              opciones={[
                { label: "Traslado Interno", value: WorkflowType.INTERNAL },
                { label: "Sala de Espera Admisión", value: WorkflowType.ITR_TO_FLOOR },
                { label: "Ingreso a ITR", value: WorkflowType.INGRESO_A_ITR },
              ]}
              placeholder="Seleccione flujo"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="min-w-0">
              <Label className={claseLabel}>Origen</Label>
              <Input
                readOnly
                tabIndex={-1}
                value={ticket.origin}
                title={ticket.origin}
                className={`${claseSoloLectura} truncate`}
              />
            </div>
            <div className="min-w-0">
              <Label className={claseLabel}>Paciente</Label>
              <Input
                readOnly
                tabIndex={-1}
                value={ticket.patientName}
                title={ticket.patientName}
                className={`${claseSoloLectura} truncate`}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className={claseLabel}>Destino <span className="text-destructive">*</span></Label>
            <Combobox obligatorio
              value={destination}
              onChange={setDestination}
              opciones={allowedDestinations.map(bed => ({
                label: bed.label === ticket.destination
                  ? `${bed.label} (actual)`
                  : `${bed.label} (${bed.status})`,
                value: bed.label
              }))}
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
            {destinationChanged && (
              <div className="rounded-lg border p-3 flex items-start gap-2 text-sm bg-amber-50 border-amber-200 text-amber-700">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <p className="text-xs font-medium">
                  Al guardar, se liberará <b>{ticket.destination ?? '—'}</b> y se reservará <b>{destination}</b>.
                </p>
              </div>
            )}
            <RoomCheckNotice check={roomCheck} />
            {currentDestBed && !destinationChanged && (
              <p className="text-xs text-muted-foreground">Estado actual: {currentDestBed.status}</p>
            )}
            {/* Pre-ticket configurado: liberar la cama sin cancelarlo (se la dieron a un paciente más urgente).
                Vuelve a "Presolicitud" y a la grilla con "Configurar destino". */}
            {onResetDestino && puedeRestablecerDestino(ticket) && (confirmReset ? (
              // Confirmación inline (banner de error §9.4), nunca confirm() nativo.
              <div className="rounded-lg border p-3 flex items-start gap-2 text-sm bg-red-50 border-red-200 text-red-700">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium">
                    Se libera <b>{formatBedName(ticket.destination!)}</b> para otro paciente y el pre-ticket vuelve a <b>Configurar destino</b>. Si cargaste un motivo de modificación, queda en la trayectoria.
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="destructive" disabled={resetting}
                      onClick={async () => {
                        setResetting(true);
                        const ok = await onResetDestino(ticket.id, modificationReason, ticket.destination);
                        setResetting(false);
                        if (ok) onOpenChange(false); else setConfirmReset(false);
                      }}>
                      {resetting && <Loader2 className="size-4 animate-spin" />}
                      {resetting ? 'Liberando…' : 'Sí, liberar la cama'}
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={resetting} onClick={() => setConfirmReset(false)}>
                      No
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmReset(true)}
                className="text-left text-xs font-medium text-destructive underline underline-offset-2 hover:text-destructive/80">
                Restablecer destino (liberar {formatBedName(ticket.destination!)})
              </button>
            ))}
          </div>

          {workflow === WorkflowType.INTERNAL && (
            <div>
              <Label className={claseLabel}>Motivo del traslado <span className="text-destructive">*</span></Label>
              <Combobox obligatorio
                value={reason}
                onChange={setReason}
                opciones={ROOM_CHANGE_REASONS.map(r => ({ label: r, value: r }))}
                placeholder="Seleccione Motivo"
              />
            </div>
          )}

          {workflow === WorkflowType.ITR_TO_FLOOR && (
            <div>
              <Label className={claseLabel}>Origen ITR / financiador</Label>
              <Input
                readOnly
                tabIndex={-1}
                placeholder="Sin financiador registrado"
                value={itrSource}
                className={claseSoloLectura}
              />
            </div>
          )}

          {/* Los aislamientos ya no se editan desde la app: vienen de PROGAL y se ven en el mapa de camas. */}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className={claseLabel}>Observaciones (opcional)</Label>
              <Input placeholder="Notas para la azafata o equipo..." value={observations} onChange={e => setObservations(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-motivo-modificacion" className={claseLabel}>Motivo de la modificación <span className="text-destructive">*</span></Label>
              <Input
                id="edit-motivo-modificacion"
                required
                placeholder="Ej: Paciente no subió a la cama"
                value={modificationReason}
                onChange={e => setModificationReason(e.target.value)}
              />
            </div>
          </div>
        </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            type="submit"
            form="edit-ticket-form"
            disabled={!destination || !modificationReason.trim() || (workflow === WorkflowType.INTERNAL && !reason)}
            className="min-w-[140px]"
          >
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
