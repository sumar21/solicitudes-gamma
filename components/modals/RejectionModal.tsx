
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) setRejectionInput(''); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[450px] rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2 text-rose-700">
            <div className="p-2 bg-rose-50 rounded-xl">
              <XCircle className="w-5 h-5 text-rose-400" />
            </div>
            Cancelar Solicitud
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <p className="text-xs text-slate-400 font-medium">Es obligatorio documentar el motivo de la cancelación para auditoría.</p>
          <div className="grid gap-1.5">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Motivo de Cancelación</Label>
            <textarea
              placeholder="Ej: Datos de paciente incorrectos, sin cupo, cambio de indicación médica..."
              value={rejectionInput}
              onChange={e => setRejectionInput(e.target.value)}
              rows={3}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-300 resize-none"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { setRejectionInput(''); onOpenChange(false); }} className="rounded-xl h-10 px-6">Cancelar</Button>
          <Button
            disabled={!rejectionInput.trim()}
            onClick={handleConfirm}
            className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl h-10 px-6"
          >
            Confirmar Cancelación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
