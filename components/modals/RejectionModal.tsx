
import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { XCircle } from '../Icons';

interface RejectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}

export const RejectionModal: React.FC<RejectionModalProps> = ({ open, onOpenChange, onConfirm }) => {
  const [rejectionInput, setRejectionInput] = useState('');

  const handleConfirm = () => {
    if (rejectionInput.trim()) {
      onConfirm(rejectionInput);
      setRejectionInput('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2 text-red-600">
            <XCircle className="w-6 h-6" /> Rechazar Solicitud
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <p className="text-sm text-slate-500 font-medium italic">Es obligatorio documentar el motivo del rechazo para auditoría.</p>
          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Motivo del Rechazo</Label>
            <Input 
              placeholder="Ej: Datos de paciente incorrectos, sin cupo..." 
              value={rejectionInput} 
              onChange={e => setRejectionInput(e.target.value)} 
              className="h-12 rounded-xl"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-12">Cancelar</Button>
          <Button 
            disabled={!rejectionInput.trim()}
            onClick={handleConfirm} 
            className="bg-red-600 hover:bg-red-700 text-white rounded-xl h-12 px-8"
          >
            Rechazar Definitivo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
