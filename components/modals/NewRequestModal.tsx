
import React, { useState } from 'react';
import { Area, Bed, BedStatus, WorkflowType, IsolationType } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SearchableSelect } from '../ui/searchable-select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { ITR_SOURCES, ROOM_CHANGE_REASONS } from '../../lib/constants';
import { isHitArea, isHraArea } from '../../lib/utils';

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
  onCreate: (data: { patientName: string; origin: string; destination: string; workflow: WorkflowType; reason?: string; itrSource?: string; observations?: string; isolation?: boolean; isolationTypes?: IsolationType[] }) => void;
  beds: Bed[];
  isolatedPatients?: Map<string, IsolationType[]>;
  activeTransferOrigins?: Set<string>;
  activeTransferDestinations?: Set<string>;
}

export const NewRequestModal: React.FC<NewRequestModalProps> = ({ open, onOpenChange, onCreate, beds, isolatedPatients = new Map(), activeTransferOrigins = new Set(), activeTransferDestinations = new Set() }) => {
  const [workflow, setWorkflow] = useState<WorkflowType>(WorkflowType.INTERNAL);
  const [patientName, setPatientName] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [itrSource, setItrSource] = useState('');
  const [observations, setObservations] = useState('');
  const [isolation, setIsolation] = useState(false);
  const [isolationTypes, setIsolationTypes] = useState<IsolationType[]>([]);

  const toggleType = (t: IsolationType) => {
    setIsolationTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  React.useEffect(() => {
    if (!open) {
      setWorkflow(WorkflowType.INTERNAL);
      setPatientName('');
      setOrigin('');
      setDestination('');
      setReason('');
      setItrSource('');
      setObservations('');
      setIsolation(false);
      setIsolationTypes([]);
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
      isolation,
      isolationTypes: isolation && isolationTypes.length ? isolationTypes : undefined,
    });
    
    // Reset form
    setPatientName('');
    setOrigin('');
    setDestination('');
    setReason('');
    setItrSource('');
    setObservations('');
    setIsolation(false);
    onOpenChange(false);
  };

  // Filtros por workflow:
  //   INTERNAL      → origen cualquier sector EXCEPTO HRA (sala de espera no es origen interno);
  //                   destino cualquier sector EXCEPTO HRA y HIT.
  //   ITR_TO_FLOOR  → origen SOLO HRA (sillones de sala de espera con paciente registrado);
  //                   destino cualquier sector EXCEPTO HRA y HIT.
  // Usamos isHitArea/isHraArea en vez de === Area.X porque Gamma puede devolver
  // variaciones de string (tildes, casing).
  const isItrFlow = workflow === WorkflowType.ITR_TO_FLOOR;
  const availableOrigins = beds
    .filter(b => b.status === BedStatus.OCCUPIED)
    .filter(b => isItrFlow ? isHraArea(b.area) : !isHraArea(b.area))
    .sort(sortByAreaThenLabel);
  const availableDestinations = beds
    .filter(b => b.status === BedStatus.AVAILABLE || b.status === BedStatus.PREPARATION)
    .filter(b => !isHitArea(b.area) && !isHraArea(b.area)) // ITR/Sala Espera nunca son destino
    .filter(b => !activeTransferDestinations.has(b.label)) // ocultar camas ya asignadas a otro ticket activo
    .sort(sortByAreaThenLabel);

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
                { label: "Ingreso ITR", value: WorkflowType.ITR_TO_FLOOR },
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
                if (bed?.patientCode && isolatedPatients.has(bed.patientCode)) {
                  setIsolation(true);
                  setIsolationTypes(isolatedPatients.get(bed.patientCode) ?? []);
                }
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

          <div className="grid gap-1.5">
            <label className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-violet-200 bg-violet-50/50 cursor-pointer hover:bg-violet-50 transition-colors">
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${isolation ? 'bg-violet-600 border-violet-600' : 'border-slate-300 bg-white'}`}>
                {isolation && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </div>
              <span className="text-sm font-bold text-violet-800">Requiere Aislamiento</span>
              <input type="checkbox" className="sr-only" checked={isolation} onChange={e => { setIsolation(e.target.checked); if (!e.target.checked) setIsolationTypes([]); }} />
            </label>
            {isolation && (
              <>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide px-1">Tocá para agregar/quitar uno o más tipos</p>
                <div className="flex flex-wrap gap-1 px-1">
                  {Object.values(IsolationType).map(t => {
                    const selected = isolationTypes.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleType(t)}
                        aria-pressed={selected}
                        className={`px-2 py-0.5 rounded-full border text-[8px] font-bold transition-all ${selected ? 'border-violet-400 bg-violet-500 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

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
