
import React, { useState } from 'react';
import { Area, Bed, BedStatus, Ticket, WorkflowType, IsolationType } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { SearchableSelect } from '../ui/searchable-select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { ROOM_CHANGE_REASONS } from '../../lib/constants';

// Same ordering used elsewhere: ITR first, then floors, then critical units
const AREA_ORDER: Area[] = [
  Area.HIT,
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

export interface EditRequestPayload {
  ticketId: string;
  patientName: string;
  origin: string;
  destination: string;
  workflow: WorkflowType;
  reason?: string;
  itrSource?: string;
  observations?: string;
  isolation: boolean;
  isolationTypes: IsolationType[];
  modificationReason: string;
}

interface EditRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket | null;
  beds: Bed[];
  isolatedPatients?: Map<string, IsolationType[]>;
  onSave: (data: EditRequestPayload) => void;
}

export const EditRequestModal: React.FC<EditRequestModalProps> = ({ open, onOpenChange, ticket, beds, isolatedPatients = new Map(), onSave }) => {
  const [workflow, setWorkflow] = useState<WorkflowType>(WorkflowType.INTERNAL);
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [itrSource, setItrSource] = useState('');
  const [observations, setObservations] = useState('');
  const [isolation, setIsolation] = useState(false);
  const [isolationTypes, setIsolationTypes] = useState<IsolationType[]>([]);
  const [modificationReason, setModificationReason] = useState('');

  const toggleType = (t: IsolationType) => {
    setIsolationTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  // Prefill when ticket changes / modal opens
  React.useEffect(() => {
    if (!open || !ticket) return;
    setWorkflow(ticket.workflow);
    setDestination(ticket.destination ?? '');
    setReason(ticket.changeReason ?? '');
    setItrSource(ticket.itrSource ?? '');
    setObservations(ticket.observations ?? '');

    const patientCode = ticket.patientCode;
    const currentTypes = patientCode ? (isolatedPatients.get(patientCode) ?? []) : [];
    setIsolation(currentTypes.length > 0);
    setIsolationTypes(currentTypes);

    setModificationReason('');
  }, [open, ticket, isolatedPatients]);

  if (!ticket) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination) return;
    if (workflow === WorkflowType.ROOM_CHANGE && !reason) return;
    if (!modificationReason.trim()) return;

    onSave({
      ticketId: ticket.id,
      patientName: ticket.patientName,
      origin: ticket.origin,
      destination,
      workflow,
      reason: workflow === WorkflowType.ROOM_CHANGE ? reason : undefined,
      itrSource: workflow === WorkflowType.ITR_TO_FLOOR ? itrSource : undefined,
      observations: observations.trim() !== '' ? observations : undefined,
      isolation,
      isolationTypes: isolation ? isolationTypes : [],
      modificationReason: modificationReason.trim(),
    });

    onOpenChange(false);
  };

  // Available destinations: free/prep beds + the ticket's current destination (so it stays visible).
  const currentDestBed = ticket.destination ? beds.find(b => b.label === ticket.destination) : null;
  const availableDestinations = beds
    .filter(b => b.status === BedStatus.AVAILABLE || b.status === BedStatus.PREPARATION || b.label === ticket.destination)
    .sort(sortByAreaThenLabel);

  const destinationChanged = destination !== (ticket.destination ?? '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] rounded-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl pr-6">Editar Traslado</DialogTitle>
          <p className="text-[10px] font-mono font-bold text-slate-400 tracking-wide uppercase">{ticket.id}</p>
        </DialogHeader>
        <form id="edit-ticket-form" onSubmit={handleSubmit} className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Tipo de Escenario</Label>
            <SearchableSelect
              value={workflow}
              onValueChange={(val) => setWorkflow(val as WorkflowType)}
              options={[
                { label: "Traslado Interno", value: WorkflowType.INTERNAL },
                { label: "Ingreso ITR", value: WorkflowType.ITR_TO_FLOOR },
                { label: "Cambio de Habitación", value: WorkflowType.ROOM_CHANGE }
              ]}
              placeholder="Seleccione flujo"
              showSearch={false}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Origen</Label>
              <Input
                readOnly
                tabIndex={-1}
                value={ticket.origin}
                title={ticket.origin}
                className="h-10 rounded-xl bg-slate-50 text-slate-700 cursor-not-allowed focus-visible:ring-0 focus-visible:ring-offset-0 truncate"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Paciente</Label>
              <Input
                readOnly
                tabIndex={-1}
                value={ticket.patientName}
                title={ticket.patientName}
                className="h-10 rounded-xl bg-slate-50 text-slate-700 cursor-not-allowed focus-visible:ring-0 focus-visible:ring-offset-0 truncate"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Destino</Label>
            <SearchableSelect
              value={destination}
              onValueChange={setDestination}
              options={availableDestinations.map(bed => ({
                label: bed.label === ticket.destination
                  ? `${bed.label} (actual)`
                  : `${bed.label} (${bed.status})`,
                value: bed.label
              }))}
              placeholder="Seleccionar Destino"
              searchPlaceholder="Buscar cama de destino..."
            />
            {destinationChanged && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <p className="text-[11px] font-medium text-amber-800">
                  Al guardar, se liberará <b>{ticket.destination ?? '—'}</b> y se reservará <b>{destination}</b>.
                </p>
              </div>
            )}
            {currentDestBed && !destinationChanged && (
              <p className="text-[10px] text-slate-400 px-1">Estado actual: {currentDestBed.status}</p>
            )}
          </div>

          {workflow === WorkflowType.ROOM_CHANGE && (
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Motivo del Cambio <span className="text-red-500">*</span></Label>
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
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Origen ITR / Financiador</Label>
              <Input placeholder="Financiador / Obra Social" value={itrSource} onChange={e => setItrSource(e.target.value)} className="h-10 rounded-xl" />
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

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Observaciones (Opcional)</Label>
              <Input placeholder="Notas para la azafata o equipo..." value={observations} onChange={e => setObservations(e.target.value)} className="h-10 rounded-xl" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-bold uppercase text-amber-600 tracking-widest">Motivo modificación <span className="text-red-500">*</span></Label>
              <Input
                required
                placeholder="Ej: Paciente no subió a la cama"
                value={modificationReason}
                onChange={e => setModificationReason(e.target.value)}
                className="h-10 rounded-xl border-amber-200 bg-amber-50/40 focus-visible:ring-amber-200"
              />
            </div>
          </div>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10 px-6">Cancelar</Button>
          <Button
            type="submit"
            form="edit-ticket-form"
            disabled={!destination || !modificationReason.trim() || (workflow === WorkflowType.ROOM_CHANGE && !reason)}
            className="bg-emerald-950 text-white rounded-xl h-10 px-8 disabled:opacity-50"
          >
            Guardar Cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
