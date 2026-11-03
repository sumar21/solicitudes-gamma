
import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { XCircle } from '../Icons';

interface RejectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  // Textos para reutilizar el mismo modal en otras cancelaciones (p. ej. una limpieza de rutina, 30/10/2026).
  title?: string;
  description?: string;
  placeholder?: string;
  confirmLabel?: string;
}

export const RejectionModal: React.FC<RejectionModalProps> = ({ open, onOpenChange, onConfirm, title = 'Cancelar Solicitud',
  description = 'Es obligatorio documentar el motivo de la cancelación para auditoría.',
  placeholder = 'Ej: Datos de paciente incorrectos, sin cupo, cambio de indicación médica...', confirmLabel = 'Confirmar Cancelación' }) => {
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
      {/* Confirmación destructiva con motivo (DESIGN §4.2) dentro del modal canónico §4.1. */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="size-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
            <XCircle className="size-5" />
          </div>
          <div>
            <Label htmlFor="rejection-motivo" className="mb-1 block text-xs font-medium text-muted-foreground">Motivo de cancelación <span className="text-destructive">*</span></Label>
            <Textarea
              id="rejection-motivo"
              placeholder={placeholder}
              value={rejectionInput}
              onChange={e => setRejectionInput(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { setRejectionInput(''); onOpenChange(false); }}>Cancelar</Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!rejectionInput.trim()}
            onClick={handleConfirm}
            className="min-w-[140px]"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
