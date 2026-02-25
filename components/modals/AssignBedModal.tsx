
import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { HOSPITAL_LOCATIONS } from '../../lib/constants';

interface AssignBedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (bed: string) => void;
}

export const AssignBedModal: React.FC<AssignBedModalProps> = ({ open, onOpenChange, onConfirm }) => {
  const [bedInput, setBedInput] = useState('');

  const handleConfirm = () => {
    if (bedInput) {
      onConfirm(bedInput);
      setBedInput('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] rounded-3xl">
        <DialogHeader><DialogTitle className="text-2xl">Asignación de Cama</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-4">
          <p className="text-sm text-slate-500">Seleccione la cama de destino para el paciente.</p>
          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Cama / Habitación</Label>
            <Select value={bedInput} onValueChange={setBedInput}>
              <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Seleccionar Cama" /></SelectTrigger>
              <SelectContent>
                {HOSPITAL_LOCATIONS.filter(l => l.includes('Habitación')).map(loc => (<SelectItem key={loc} value={loc}>{loc}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-12">Cancelar</Button>
          <Button onClick={handleConfirm} className="bg-zinc-950 text-white rounded-xl h-12 px-8">Confirmar Cama</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
