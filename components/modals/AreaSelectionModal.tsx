
import React, { useState, useEffect } from 'react';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Area } from '../../types';

interface AreaSelectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (selectedAreas: Area[]) => void;
  initialSelectedAreas?: Area[];
}

export const AreaSelectionModal: React.FC<AreaSelectionModalProps> = ({ 
  open, 
  onOpenChange, 
  onConfirm, 
  initialSelectedAreas = [] 
}) => {
  const [selectedAreas, setSelectedAreas] = useState<Area[]>(initialSelectedAreas);

  // Sync with initialSelectedAreas when modal opens
  useEffect(() => {
    if (open) {
      setSelectedAreas(initialSelectedAreas);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleToggleArea = (area: Area) => {
    setSelectedAreas(prev => {
      if (prev.includes(area)) {
        return prev.filter(a => a !== area);
      } else {
        return [...prev, area];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedAreas.length === Object.values(Area).length) {
      setSelectedAreas([]);
    } else {
      setSelectedAreas(Object.values(Area) as Area[]);
    }
  };

  const handleConfirm = () => {
    onConfirm(selectedAreas);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Modal de formulario canónico (DESIGN §4.1): la lista scrollea dentro del DialogBody. */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Selección de áreas asignadas</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{selectedAreas.length}</span> de {Object.values(Area).length} seleccionadas
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-2">
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={handleSelectAll}>
              {selectedAreas.length === Object.values(Area).length ? "Deseleccionar todas" : "Seleccionar todas"}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-1">
            {Object.values(Area).map((area) => (
              <div key={area} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50">
                <Checkbox 
                  id={`area-${area}`} 
                  checked={selectedAreas.includes(area)}
                  onCheckedChange={() => handleToggleArea(area)}
                />
                <Label 
                  htmlFor={`area-${area}`} 
                  className="text-sm font-medium leading-none cursor-pointer flex-1"
                >
                  {area}
                </Label>
              </div>
            ))}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={handleConfirm} disabled={selectedAreas.length === 0} className="min-w-[140px]">
            Confirmar asignación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
