
import React, { useState } from 'react';
import { Bed, BedStatus, WorkflowType } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { ITR_SOURCES, ROOM_CHANGE_REASONS } from '../../lib/constants';

interface NewRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: { patientName: string; origin: string; destination: string; workflow: WorkflowType; reason?: string; itrSource?: string }) => void;
  beds: Bed[];
}

export const NewRequestModal: React.FC<NewRequestModalProps> = ({ open, onOpenChange, onCreate, beds }) => {
  const [workflow, setWorkflow] = useState<WorkflowType>(WorkflowType.INTERNAL);
  const [patientName, setPatientName] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [itrSource, setItrSource] = useState('');

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
      itrSource: workflow === WorkflowType.ITR_TO_FLOOR ? itrSource : undefined
    });
    
    // Reset form
    setPatientName('');
    setOrigin('');
    setDestination('');
    setReason('');
    setItrSource('');
    onOpenChange(false);
  };

  const availableOrigins = beds.filter(b => b.status === BedStatus.OCCUPIED);
  const availableDestinations = beds.filter(b => b.status === BedStatus.AVAILABLE || b.status === BedStatus.PREPARATION);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] rounded-3xl">
        <DialogHeader><DialogTitle className="text-2xl">Nueva Solicitud de Traslado</DialogTitle></DialogHeader>
        <form id="create-ticket-form" onSubmit={handleSubmit} className="grid gap-6 py-4">
          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Tipo de Escenario</Label>
            <Select value={workflow} onValueChange={(val) => setWorkflow(val as WorkflowType)}>
              <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Seleccione flujo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={WorkflowType.INTERNAL}>Traslado Interno</SelectItem>
                <SelectItem value={WorkflowType.ITR_TO_FLOOR}>Ingreso ITR</SelectItem>
                <SelectItem value={WorkflowType.ROOM_CHANGE}>Cambio de Habitación</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Origen (Cama Ocupada)</Label>
            <Select value={origin} onValueChange={(val) => {
              setOrigin(val);
              const bed = beds.find(b => b.label === val);
              if (bed?.patientName) setPatientName(bed.patientName);
            }}>
              <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Seleccionar Origen" /></SelectTrigger>
              <SelectContent>
                {availableOrigins.map(bed => (
                  <SelectItem key={bed.id} value={bed.label}>
                    {bed.label} ({bed.patientName || 'Sin Nombre'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Paciente</Label>
            <Input required placeholder="Nombre completo" value={patientName} onChange={e => setPatientName(e.target.value)} className="h-12 rounded-xl" />
          </div>

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Destino (Disponible/Prep)</Label>
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Seleccionar Destino" /></SelectTrigger>
              <SelectContent>
                {availableDestinations.map(bed => (
                  <SelectItem key={bed.id} value={bed.label}>
                    {bed.label} ({bed.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {workflow === WorkflowType.ROOM_CHANGE && (
            <div className="grid gap-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Motivo del Cambio</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Seleccione Motivo" /></SelectTrigger>
                <SelectContent>
                  {ROOM_CHANGE_REASONS.map(r => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}

          {workflow === WorkflowType.ITR_TO_FLOOR && (
            <div className="grid gap-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Origen ITR / Financiador</Label>
              <Select value={itrSource} onValueChange={setItrSource}>
                <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Seleccione Financiador" /></SelectTrigger>
                <SelectContent>
                  {ITR_SOURCES.map(source => (<SelectItem key={source} value={source}>{source}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-12 px-6">Cancelar</Button>
          <Button type="submit" form="create-ticket-form" className="bg-zinc-950 text-white rounded-xl h-12 px-8">Generar Ticket</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
