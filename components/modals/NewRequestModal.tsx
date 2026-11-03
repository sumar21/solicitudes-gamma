
import React, { useState } from 'react';
import { Area, Bed, BedStatus, Ticket, WorkflowType } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Combobox } from '../ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { AlertTriangle, Info } from 'lucide-react';
import { ITR_SOURCES, ROOM_CHANGE_REASONS } from '../../lib/constants';
import { isHitArea, isHraArea, roomSexConflict } from '../../lib/utils';
import { roomCheckFor } from '../../lib/roomCheck';
import { OriginBedBusyNotice } from '../OriginBedBusyNotice';
import { RoomCheckNotice } from '../RoomCheckNotice';
import { splitDestinationsByIsolation } from '../../lib/isolations';

// Same ordering used in BedsView: pre-internación (HRA, HIT) first, then floors, then critical units
const AREA_ORDER: Area[] = [
  Area.HRA, Area.HIT,
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8,
  Area.HUC, Area.HUT, Area.HUQ, Area.HSS,
];
// Label canónico de campo (DESIGN §3.3) y control de solo lectura (dato que viene de la cama).
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

interface NewRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: { patientName: string; origin: string; destination: string; workflow: WorkflowType; reason?: string; itrSource?: string; observations?: string }) => void;
  beds: Bed[];
  /** Cama de origen → ticket activo que sale de ella (bloquea cargar otro; el aviso dice de quién es). */
  activeTicketByOrigin?: Map<string, Ticket>;
  activeTransferDestinations?: Set<string>;
}

export const NewRequestModal: React.FC<NewRequestModalProps> = ({ open, onOpenChange, onCreate, beds, activeTicketByOrigin = new Map(), activeTransferDestinations = new Set() }) => {
  const [workflow, setWorkflow] = useState<WorkflowType>(WorkflowType.INTERNAL);
  const [patientName, setPatientName] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [itrSource, setItrSource] = useState('');
  const [observations, setObservations] = useState('');

  React.useEffect(() => {
    if (!open) {
      setWorkflow(WorkflowType.INTERNAL);
      setPatientName('');
      setOrigin('');
      setDestination('');
      setReason('');
      setItrSource('');
      setObservations('');
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!origin || !destination) return;
    // Traslado Interno (que absorbió Cambio de Habitación) requiere siempre el motivo.
    if (workflow === WorkflowType.INTERNAL && !reason) return;

    // Auto-fill patient name if origin is selected and has patient
    const originBed = beds.find(b => b.label === origin);
    const finalPatientName = patientName || originBed?.patientName || 'Paciente';

    onCreate({
      patientName: finalPatientName,
      origin,
      destination,
      workflow,
      reason: workflow === WorkflowType.INTERNAL ? reason : undefined,
      itrSource: workflow === WorkflowType.ITR_TO_FLOOR ? itrSource : undefined,
      observations: observations.trim() !== '' ? observations : undefined,
    });

    // Reset form
    setPatientName('');
    setOrigin('');
    setDestination('');
    setReason('');
    setItrSource('');
    setObservations('');
    onOpenChange(false);
  };

  // Filtros por workflow:
  //   INTERNAL        → origen cualquier sector EXCEPTO HRA y HIT;
  //                     destino cualquier AVAILABLE/PREPARATION EXCEPTO HRA y HIT.
  //   ITR_TO_FLOOR    → origen SOLO HRA (sillones sala de espera con paciente registrado);
  //                     destino idem.
  //   INGRESO_A_ITR   → origen SOLO HIT (las 8 camas de Internación Transitoria);
  //                     destino idem.
  // Usamos isHitArea/isHraArea en vez de === Area.X porque Gamma puede devolver
  // variaciones de string (tildes, casing).
  const isSalaEsperaFlow = workflow === WorkflowType.ITR_TO_FLOOR;
  const isIngresoItrFlow = workflow === WorkflowType.INGRESO_A_ITR;

  // origen_evento del paciente (PROGAL, obtenermapacamasocupadas) → normalizado para comparar.
  const normEventOrigin = (s?: string) => (s ?? '').trim().toUpperCase();

  const availableOrigins = beds
    .filter(b => b.status === BedStatus.OCCUPIED)
    .filter(b => {
      if (isSalaEsperaFlow) return isHraArea(b.area);
      // Ingreso a ITR: dentro de las camas de HIT, solo pacientes cuyo evento de internación
      // sea HIN (internación definitiva), NO HIT (ya en transitoria). origen_evento viene de
      // PROGAL en bed.eventOrigin.
      if (isIngresoItrFlow) return isHitArea(b.area) && normEventOrigin(b.eventOrigin) === 'HIN';
      return !isHraArea(b.area) && !isHitArea(b.area); // INTERNAL
    })
    .sort(sortByAreaThenLabel);

  const availableDestinations = beds
    .filter(b => b.status === BedStatus.AVAILABLE || b.status === BedStatus.PREPARATION)
    .filter(b => !isHitArea(b.area) && !isHraArea(b.area)) // HRA y HIT nunca son destino
    .filter(b => !activeTransferDestinations.has(b.label)) // ocultar camas ya asignadas a otro ticket activo
    .sort(sortByAreaThenLabel);

  // Reglas de convivencia por aislamiento (Quemado / Diálisis peritoneal): a diferencia del
  // warning de sexo, estas SÍ recortan la lista — son una indicación clínica, no una sugerencia.
  // Se muestra el conteo y el motivo para que nunca desaparezca una cama en silencio.
  const { allowed: allowedDestinations, blocked: isolationBlocked } =
    splitDestinationsByIsolation(beds, origin, availableDestinations);

  // El destino se elige ANTES o DESPUÉS del origen, indistinto. Si ya había uno cargado y el
  // origen que se elige después lo vuelve incompatible (p. ej. pasa a ser un paciente DP), hay
  // que soltarlo: el Combobox dejaría de mostrarlo pero el estado seguiría teniendo la
  // cama vieja y el submit la mandaría igual, salteando la regla.
  React.useEffect(() => {
    if (destination && !allowedDestinations.some(b => b.label === destination)) setDestination('');
  }, [destination, allowedDestinations]);

  // Warning NO bloqueante: habitación destino con pacientes del sexo opuesto. Ver roomSexConflict.
  const sexLabel = (s?: string) => (s === 'M' ? 'Masculino' : s === 'F' ? 'Femenino' : '');
  const sexWarning = React.useMemo(
    () => (origin && destination ? roomSexConflict(beds, origin, destination) : null),
    [beds, origin, destination],
  );
  // Aviso (no bloqueante): habitación compartida con vecino ocupado → el traslado queda "Esperando
  // Habitación" hasta que la azafata la confirme. Ver lib/roomCheck.ts.
  const roomCheck = React.useMemo(
    () => (destination ? roomCheckFor(beds, destination, origin) : null),
    [beds, origin, destination],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Modal de formulario canónico (DESIGN §4.1): header → cuerpo con scroll → footer con las acciones. */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva solicitud de traslado</DialogTitle>
          <DialogDescription>Elegí el escenario, la cama de origen y la de destino.</DialogDescription>
        </DialogHeader>
        <DialogBody>
        <form id="create-ticket-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className={claseLabel}>Tipo de escenario <span className="text-destructive">*</span></Label>
            <Combobox obligatorio
              value={workflow}
              onChange={(val) => {
                const next = val as WorkflowType;
                if (next !== workflow) {
                  // El filtro de origen depende del workflow → si el origen cargado
                  // ya no cumple las reglas del nuevo flujo, lo limpiamos.
                  setOrigin('');
                  setPatientName('');
                  setItrSource('');
                  // Motivo solo aplica a INTERNAL — limpiar al cambiar.
                  setReason('');
                }
                setWorkflow(next);
              }}
              opciones={[
                { label: "Traslado Interno", value: WorkflowType.INTERNAL },
                { label: "Sala de Espera Admisión", value: WorkflowType.ITR_TO_FLOOR },
                { label: "Ingreso de ITR", value: WorkflowType.INGRESO_A_ITR },
              ]}
              placeholder="Seleccione flujo"
            />
          </div>

          <div className="space-y-2">
            <Label className={claseLabel}>Origen (cama ocupada) <span className="text-destructive">*</span></Label>
            <Combobox obligatorio
              value={origin}
              onChange={(val) => {
                setOrigin(val);
                const bed = beds.find(b => b.label === val);
                if (bed?.patientName) setPatientName(bed.patientName);
                if (bed?.institution) setItrSource(bed.institution);
              }}
              opciones={availableOrigins.map(bed => ({
                label: `${bed.label} (${bed.patientName || 'Sin Nombre'})`,
                value: bed.label
              }))}
              placeholder="Seleccionar Origen"
              buscar="Buscar cama de origen..."
            />
            {origin && activeTicketByOrigin.has(origin) && (
              <OriginBedBusyNotice ticket={activeTicketByOrigin.get(origin)!} beds={beds} />
            )}
          </div>

          <div>
            <Label className={claseLabel}>Paciente</Label>
            <Input
              required
              readOnly
              tabIndex={-1}
              placeholder={origin ? 'Sin nombre registrado' : 'Seleccione una cama de origen'}
              value={patientName}
              className={claseSoloLectura}
            />
          </div>

          <div className="space-y-2">
            <Label className={claseLabel}>Destino (disponible / en preparación) <span className="text-destructive">*</span></Label>
            <Combobox obligatorio
              value={destination}
              onChange={setDestination}
              opciones={allowedDestinations.map(bed => ({
                label: `${bed.label} (${bed.status})`,
                value: bed.label
              }))}
              placeholder="Seleccionar Destino"
              buscar="Buscar cama de destino..."
            />
            {isolationBlocked.length > 0 && (
              // Banner info (§9.4): avisa que hay camas recortadas por aislamiento, nunca en silencio.
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
                  Incompatibilidad de sexo: el paciente a trasladar es {sexLabel(sexWarning.patientSex)}, pero la habitación destino ya tiene pacientes de sexo {sexLabel(sexWarning.patientSex === 'M' ? 'F' : 'M')}
                  {' '}({sexWarning.roommates.map(b => `${b.label} — ${b.patientName}`).join(', ')}). No bloquea, verificá antes de confirmar.
                </p>
              </div>
            )}
            <RoomCheckNotice check={roomCheck} />
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
                placeholder={origin ? 'Sin financiador registrado' : 'Seleccione una cama de origen'}
                value={itrSource}
                className={claseSoloLectura}
              />
            </div>
          )}

          {/* Los aislamientos ya no se cargan desde la app: vienen de PROGAL y se ven en el mapa de camas. */}

          <div>
            <Label className={claseLabel}>Observaciones (opcional)</Label>
            <Input placeholder="Notas para la azafata o equipo..." value={observations} onChange={e => setObservations(e.target.value)} />
          </div>
        </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            type="submit"
            form="create-ticket-form"
            disabled={
              !origin ||
              !destination ||
              (workflow === WorkflowType.INTERNAL && !reason) ||
              !!(origin && activeTicketByOrigin.has(origin))
            }
            className="min-w-[140px]"
          >
            Generar ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
