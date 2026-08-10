
import React, { useState } from 'react';
import { Area, Bed, BedStatus, WorkflowType } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SearchableSelect } from '../ui/searchable-select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { ITR_SOURCES, ROOM_CHANGE_REASONS } from '../../lib/constants';
import { isHitArea, isHraArea, roomSexConflict } from '../../lib/utils';

// Same ordering used in BedsView: pre-internación (HRA, HIT) first, then floors, then critical units
const AREA_ORDER: Area[] = [
  Area.HRA, Area.HIT,
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8,
  Area.HUC, Area.HUT, Area.HUQ, Area.HSS,
];
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
  activeTransferOrigins?: Set<string>;
  activeTransferDestinations?: Set<string>;
}

export const NewRequestModal: React.FC<NewRequestModalProps> = ({ open, onOpenChange, onCreate, beds, activeTransferOrigins = new Set(), activeTransferDestinations = new Set() }) => {
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

  // Warning NO bloqueante: habitación destino con pacientes del sexo opuesto. Ver roomSexConflict.
  const sexLabel = (s?: string) => (s === 'M' ? 'Masculino' : s === 'F' ? 'Femenino' : '');
  const sexWarning = React.useMemo(
    () => (origin && destination ? roomSexConflict(beds, origin, destination) : null),
    [beds, origin, destination],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] rounded-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-xl pr-6">Nueva Solicitud de Traslado</DialogTitle></DialogHeader>
        <form id="create-ticket-form" onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Tipo de Escenario</Label>
            <SearchableSelect
              value={workflow}
              onValueChange={(val) => {
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
              options={[
                { label: "Traslado Interno", value: WorkflowType.INTERNAL },
                { label: "Sala de Espera Admisión", value: WorkflowType.ITR_TO_FLOOR },
                { label: "Ingreso de ITR", value: WorkflowType.INGRESO_A_ITR },
              ]}
              placeholder="Seleccione flujo"
              showSearch={false}
            />
          </div>
          
          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Origen (Cama Ocupada)</Label>
            <SearchableSelect
              value={origin}
              onValueChange={(val) => {
                setOrigin(val);
                const bed = beds.find(b => b.label === val);
                if (bed?.patientName) setPatientName(bed.patientName);
                if (bed?.institution) setItrSource(bed.institution);
              }}
              options={availableOrigins.map(bed => ({
                label: `${bed.label} (${bed.patientName || 'Sin Nombre'})`,
                value: bed.label
              }))}
              placeholder="Seleccionar Origen"
              searchPlaceholder="Buscar cama de origen..."
            />
            {origin && activeTransferOrigins.has(origin) && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <p className="text-xs font-medium text-amber-800">Esta cama ya tiene un traslado activo. Debe finalizar o cancelarse antes de crear otro.</p>
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Paciente</Label>
            <Input
              required
              readOnly
              tabIndex={-1}
              placeholder={origin ? 'Sin nombre registrado' : 'Seleccione una cama de origen'}
              value={patientName}
              className="h-10 rounded-xl bg-slate-50 text-slate-700 cursor-not-allowed focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Destino (Disponible/Prep)</Label>
            <SearchableSelect
              value={destination}
              onValueChange={setDestination}
              options={availableDestinations.map(bed => ({
                label: `${bed.label} (${bed.status})`,
                value: bed.label
              }))}
              placeholder="Seleccionar Destino"
              searchPlaceholder="Buscar cama de destino..."
            />
            {sexWarning && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                <span className="w-2 h-2 mt-1 rounded-full bg-amber-500 shrink-0" />
                <p className="text-xs font-medium text-amber-800">
                  Incompatibilidad de sexo: el paciente a trasladar es {sexLabel(sexWarning.patientSex)}, pero la habitación destino ya tiene pacientes de sexo {sexLabel(sexWarning.patientSex === 'M' ? 'F' : 'M')}
                  {' '}({sexWarning.roommates.map(b => `${b.label} — ${b.patientName}`).join(', ')}). No bloquea, verificá antes de confirmar.
                </p>
              </div>
            )}
          </div>

          {workflow === WorkflowType.INTERNAL && (
            <div className="grid gap-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Motivo del Traslado <span className="text-red-500">*</span></Label>
              <SearchableSelect
                value={reason}
                onValueChange={setReason}
                options={ROOM_CHANGE_REASONS.map(r => ({ label: r, value: r }))}
                placeholder="Seleccione Motivo"
                showSearch={false}
              />
            </div>
          )}

          {workflow === WorkflowType.ITR_TO_FLOOR && (
            <div className="grid gap-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Origen ITR / Financiador</Label>
              <Input
                readOnly
                tabIndex={-1}
                placeholder={origin ? 'Sin financiador registrado' : 'Seleccione una cama de origen'}
                value={itrSource}
                className="h-10 rounded-xl bg-slate-50 text-slate-700 cursor-not-allowed focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          )}

          {/* Los aislamientos ya no se cargan desde la app: vienen de PROGAL y se ven en el mapa de camas. */}

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Observaciones (Opcional)</Label>
            <Input placeholder="Notas para la azafata o equipo..." value={observations} onChange={e => setObservations(e.target.value)} className="h-10 rounded-xl" />
          </div>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10 px-6">Cancelar</Button>
          <Button
            type="submit"
            form="create-ticket-form"
            disabled={
              !origin ||
              !destination ||
              (workflow === WorkflowType.INTERNAL && !reason) ||
              !!(origin && activeTransferOrigins.has(origin))
            }
            className="bg-emerald-950 text-white rounded-xl h-10 px-8 disabled:opacity-50"
          >
            Generar Ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
