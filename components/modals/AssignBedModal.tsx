
import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Combobox } from '../ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { HOSPITAL_LOCATIONS } from '../../lib/constants';

interface AssignBedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (bed: string) => void;
}

export const AssignBedModal: React.FC<AssignBedModalProps> = ({ open, onOpenChange, onConfirm }) => {
  const [bedInput, setBedInput] = useState('');

  React.useEffect(() => {
    if (!open) {
      setBedInput('');
    }
  }, [open]);

  const handleConfirm = () => {
    if (bedInput) {
      onConfirm(bedInput);
      setBedInput('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Modal de formulario canónico (DESIGN §4.1), formulario simple de un campo. */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Asignación de cama</DialogTitle>
          <DialogDescription>Seleccione la cama de destino para el paciente.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div>
            <Label className="mb-1 block text-xs font-medium text-muted-foreground">Cama / habitación <span className="text-destructive">*</span></Label>
            <Combobox obligatorio
              value={bedInput}
              onChange={setBedInput}
              opciones={HOSPITAL_LOCATIONS.filter(l => l.includes('Habitación')).map(loc => ({
                label: loc,
                value: loc
              }))}
              placeholder="Seleccionar Cama"
              buscar="Buscar cama..."
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={handleConfirm} className="min-w-[140px]">Confirmar cama</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
