
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Selección de Áreas Asignadas</DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          <div className="flex justify-end mb-4">
            <Button variant="ghost" size="sm" onClick={handleSelectAll} className="text-xs">
              {selectedAreas.length === Object.values(Area).length ? "Deseleccionar Todas" : "Seleccionar Todas"}
            </Button>
          </div>
          
          <div className="grid grid-cols-1 gap-3 max-h-[60vh] overflow-y-auto pr-2">
            {Object.values(Area).map((area) => (
              <div key={area} className="flex items-center space-x-2 p-2 rounded hover:bg-slate-50 border border-transparent hover:border-slate-100">
                <Checkbox 
                  id={`area-${area}`} 
                  checked={selectedAreas.includes(area)}
                  onCheckedChange={() => handleToggleArea(area)}
                />
                <Label 
                  htmlFor={`area-${area}`} 
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                >
                  {area}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleConfirm} disabled={selectedAreas.length === 0}>
            Confirmar Asignación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
