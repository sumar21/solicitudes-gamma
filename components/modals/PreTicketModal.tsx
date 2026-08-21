import React, { useState } from 'react';
import { Bed, BedStatus } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { SearchableSelect } from '../ui/searchable-select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { MOVIMIENTOS_PRETICKET, REQUISITOS_CAMA, REQUISITO_SIN } from '../../lib/constants';
import { formatBedName } from '../../lib/utils';
import { Check } from 'lucide-react';

// Pre-ticket: la Coordinadora pide una cama. Carga lo mínimo (paciente + movimiento + requisitos);
// Admisión configura el destino después. Ver docs/planes/pre-ticket.md.
interface PreTicketModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: { originBedLabel: string; movimiento: string; requisitos: string[]; observations?: string }) => void;
  beds: Bed[];
}

export const PreTicketModal: React.FC<PreTicketModalProps> = ({ open, onOpenChange, onCreate, beds }) => {
  const [originBedLabel, setOriginBedLabel] = useState('');
  const [movimiento, setMovimiento] = useState('');
  const [requisitos, setRequisitos] = useState<string[]>([]);
  const [observations, setObservations] = useState('');

  React.useEffect(() => {
    if (!open) {
      setOriginBedLabel('');
      setMovimiento('');
      setRequisitos([]);
      setObservations('');
    }
  }, [open]);

  // Camas ocupadas con paciente → el paciente va en primer plano (así busca la Coordinadora),
  // la cama es el dato secundario y la clave real (de ahí salen obra social + origen).
  const patientOptions = beds
    .filter(b => b.status === BedStatus.OCCUPIED && b.patientName)
    .sort((a, b) => (a.patientName || '').localeCompare(b.patientName || '', 'es'))
    .map(b => ({ label: `${b.patientName} — ${formatBedName(b.label)}`, value: b.label }));

  const selectedBed = beds.find(b => b.label === originBedLabel);

  // "Sin requerimiento" es EXCLUYENTE: al tildarlo destilda los demás; tildar cualquier otro lo saca.
  const toggleRequisito = (r: string) => {
    setRequisitos(prev => {
      if (r === REQUISITO_SIN) return prev.includes(REQUISITO_SIN) ? [] : [REQUISITO_SIN];
      const next = prev.filter(x => x !== REQUISITO_SIN);
      return next.includes(r) ? next.filter(x => x !== r) : [...next, r];
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!originBedLabel || !movimiento) return;
    onCreate({
      originBedLabel,
      movimiento,
      requisitos,
      observations: observations.trim() !== '' ? observations : undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] rounded-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-xl pr-6">Nuevo Pre-ticket de Traslado</DialogTitle></DialogHeader>
        <form id="create-pre-ticket-form" onSubmit={handleSubmit} className="grid gap-4 py-2">

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Paciente</Label>
            <SearchableSelect
              value={originBedLabel}
              onValueChange={setOriginBedLabel}
              options={patientOptions}
              placeholder="Seleccionar paciente"
              searchPlaceholder="Buscar por paciente o cama..."
            />
          </div>

          {/* Precarga desde el paciente: obra social + origen (la Coordinadora no los carga). */}
          {selectedBed && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Obra Social</Label>
                <div className="h-10 px-3 flex items-center rounded-xl bg-slate-50 text-slate-700 text-sm truncate">
                  {selectedBed.institution || '—'}
                </div>
              </div>
              <div className="grid gap-1">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Origen</Label>
                <div className="h-10 px-3 flex items-center rounded-xl bg-slate-50 text-slate-700 text-sm truncate">
                  {formatBedName(selectedBed.label)}
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Movimiento <span className="text-red-500">*</span></Label>
            <SearchableSelect
              value={movimiento}
              onValueChange={setMovimiento}
              options={MOVIMIENTOS_PRETICKET.map(m => ({ label: m, value: m }))}
              placeholder="Seleccione el movimiento"
              showSearch={false}
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Requisitos de la nueva cama</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {REQUISITOS_CAMA.map(r => {
                const active = requisitos.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRequisito(r)}
                    className={
                      'flex items-center gap-2 px-3 h-10 rounded-xl border text-sm text-left transition-colors ' +
                      (active
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-medium'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')
                    }
                  >
                    <span className={
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border ' +
                      (active ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300')
                    }>
                      {active && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 truncate">{r}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Observación (Opcional)</Label>
            <Input placeholder="Información adicional para Admisión..." value={observations} onChange={e => setObservations(e.target.value)} className="h-10 rounded-xl" />
          </div>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10 px-6">Cancelar</Button>
          <Button
            type="submit"
            form="create-pre-ticket-form"
            disabled={!originBedLabel || !movimiento}
            className="bg-emerald-950 text-white rounded-xl h-10 px-8 disabled:opacity-50"
          >
            Enviar a Admisión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
