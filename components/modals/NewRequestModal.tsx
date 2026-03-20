
import React, { useState } from 'react';
import { Bed, BedStatus, WorkflowType } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SearchableSelect } from '../ui/searchable-select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { ITR_SOURCES, ROOM_CHANGE_REASONS } from '../../lib/constants';

interface NewRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: { patientName: string; origin: string; destination: string; workflow: WorkflowType; reason?: string; itrSource?: string; observations?: string }) => void;
  beds: Bed[];
}

export const NewRequestModal: React.FC<NewRequestModalProps> = ({ open, onOpenChange, onCreate, beds }) => {
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
    
    // Auto-fill patient name if origin is selected and has patient
    const originBed = beds.find(b => b.label === origin);
    const finalPatientName = patientName || originBed?.patientName || 'Paciente';

    onCreate({
      patientName: finalPatientName,
      origin,
      destination,
      workflow,
      reason: workflow === WorkflowType.ROOM_CHANGE ? reason : undefined,
      itrSource: workflow === WorkflowType.ITR_TO_FLOOR ? itrSource : undefined,
      observations: observations.trim() !== '' ? observations : undefined
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

  const availableOrigins = beds.filter(b => b.status === BedStatus.OCCUPIED);
  const availableDestinations = beds.filter(b => b.status === BedStatus.AVAILABLE || b.status === BedStatus.PREPARATION);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-2xl pr-6">Nueva Solicitud de Traslado</DialogTitle></DialogHeader>
        <form id="create-ticket-form" onSubmit={handleSubmit} className="grid gap-6 py-4">
          <div className="grid gap-2">
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
          </div>

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Paciente</Label>
            <Input required placeholder="Nombre completo" value={patientName} onChange={e => setPatientName(e.target.value)} className="h-12 rounded-xl" />
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

          {workflow === WorkflowType.ROOM_CHANGE && (
            <div className="grid gap-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Motivo del Cambio</Label>
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
              <Input placeholder="Financiador / Obra Social" value={itrSource} onChange={e => setItrSource(e.target.value)} className="h-12 rounded-xl" />
            </div>
          )}

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Observaciones (Opcional)</Label>
            <Input placeholder="Notas para la azafata o equipo..." value={observations} onChange={e => setObservations(e.target.value)} className="h-12 rounded-xl" />
          </div>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-12 px-6">Cancelar</Button>
          <Button type="submit" form="create-ticket-form" className="bg-emerald-950 text-white rounded-xl h-12 px-8">Generar Ticket</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
