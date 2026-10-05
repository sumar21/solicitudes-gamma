import React, { useState } from 'react';
import { Area, Bed, BedStatus } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { SearchableSelect } from '../ui/searchable-select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { MOVIMIENTOS_PRETICKET, REQUISITOS_CAMA, REQUISITO_SIN } from '../../lib/constants';
import { formatBedName, isHitArea, isHraArea, cn } from '../../lib/utils';
import { Check, Siren } from 'lucide-react';

// Orden por SECTOR (no por apellido): mismo criterio que NewRequestModal/BedsView —
// pre-internación (HRA, HIT) primero, después pisos, después unidades críticas; empate por cama.
const AREA_ORDER: Area[] = [
  Area.HRA, Area.HIT,
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8,
  Area.HUC, Area.HUT, Area.HUQ, Area.HSS,
];
const areaRank = (a?: Area | string) => {
  const idx = AREA_ORDER.indexOf(a as Area);
  return idx === -1 ? AREA_ORDER.length : idx;
};
const sortByAreaThenLabel = (a: Bed, b: Bed) => {
  const ra = areaRank(a.area);
  const rb = areaRank(b.area);
  if (ra !== rb) return ra - rb;
  return a.label.localeCompare(b.label, 'es', { numeric: true });
};

// Pre-ticket: la Coordinadora pide una cama. Carga lo mínimo (paciente + movimiento + requisitos);
// Admisión configura el destino después. Ver docs/planes/pre-ticket.md.
//
// URGENCIA / INGRESO DIRECTO: el paciente va directo a la cama, sin pasar por Admisión, y por lo general
// todavía no está internado en PROGAL → no hay cama de origen que elegir. Coordinación tipea nombre y
// apellido (campo libre) y elige el destino; el ticket nace "Por Consolidar" y Admisión lo vincula a un
// paciente real al consolidar.
export interface PreTicketCreateData {
  originBedLabel: string;
  movimiento: string;
  requisitos: string[];
  observations?: string;
  urgencia?: boolean;
  pacienteNombre?: string;
  destinoBedLabel?: string;
}

interface PreTicketModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: PreTicketCreateData) => void;
  beds: Bed[];
  /** Camas ya tomadas por otro traslado activo (no se ofrecen como destino de una urgencia). */
  activeTransferDestinations?: Set<string>;
  /** Sectores del usuario (solo para roles con filterByFloors). Recorta el desplegable de
   *  pacientes a sus pisos: si podía pedir una cama para un paciente de otro sector, el
   *  pre-ticket resultante le quedaba invisible en la grilla (que sí filtra por piso). */
  assignedAreas?: Area[];
}

export const MIN_NOMBRE_URGENCIA = 3;

export const PreTicketModal: React.FC<PreTicketModalProps> = ({ open, onOpenChange, onCreate, beds, assignedAreas, activeTransferDestinations = new Set() }) => {
  const [originBedLabel, setOriginBedLabel] = useState('');
  const [movimiento, setMovimiento] = useState('');
  const [requisitos, setRequisitos] = useState<string[]>([]);
  const [observations, setObservations] = useState('');
  const [urgencia, setUrgencia] = useState(false);
  const [pacienteNombre, setPacienteNombre] = useState('');
  const [destinoBedLabel, setDestinoBedLabel] = useState('');

  React.useEffect(() => {
    if (!open) {
      setOriginBedLabel('');
      setMovimiento('');
      setRequisitos([]);
      setObservations('');
      setUrgencia(false);
      setPacienteNombre('');
      setDestinoBedLabel('');
    }
  }, [open]);

  // Destinos de una urgencia: mismas reglas que "Configurar destino" (libre o en preparación; HRA/HIT nunca).
  const destinoOptions = beds
    .filter(b => b.status === BedStatus.AVAILABLE || b.status === BedStatus.PREPARATION)
    .filter(b => !isHitArea(b.area) && !isHraArea(b.area))
    .filter(b => !activeTransferDestinations.has(b.label))
    .sort(sortByAreaThenLabel)
    .map(b => ({ label: `${b.label} (${b.status})`, value: b.label }));

  const nombreOk = pacienteNombre.trim().length >= MIN_NOMBRE_URGENCIA;
  const canSubmit = urgencia ? (nombreOk && !!destinoBedLabel) : (!!originBedLabel && !!movimiento);

  // Camas ocupadas con paciente → el paciente va en primer plano (así busca la Coordinadora),
  // la cama es el dato secundario y la clave real (de ahí salen obra social + origen).
  const patientOptions = beds
    .filter(b => b.status === BedStatus.OCCUPIED && b.patientName)
    .filter(b => !assignedAreas?.length || assignedAreas.includes(b.area))
    .sort(sortByAreaThenLabel)
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
    if (!canSubmit) return;
    if (urgencia) {
      onCreate({
        originBedLabel: '', movimiento: '', requisitos: [],
        observations: observations.trim() !== '' ? observations : undefined,
        urgencia: true,
        pacienteNombre: pacienteNombre.trim().replace(/\s+/g, ' '),
        destinoBedLabel,
      });
    } else {
      onCreate({
        originBedLabel,
        movimiento,
        requisitos,
        observations: observations.trim() !== '' ? observations : undefined,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] rounded-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-xl pr-6">{urgencia ? 'Ingreso por urgencia' : 'Nuevo Pre-ticket de Traslado'}</DialogTitle></DialogHeader>
        <form id="create-pre-ticket-form" onSubmit={handleSubmit} className="grid gap-4 py-2">

          {/* Urgencia / ingreso directo: el paciente va directo a la cama y todavía no está internado. */}
          <label
            className={cn(
              'flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-colors',
              urgencia ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white hover:bg-slate-50',
            )}
          >
            <input
              type="checkbox"
              checked={urgencia}
              onChange={e => setUrgencia(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
              aria-label="Urgencia / ingreso directo"
            />
            <span className="grid gap-0.5">
              <span className={cn('flex items-center gap-1.5 text-sm font-bold', urgencia ? 'text-red-800' : 'text-slate-700')}>
                <Siren className="h-3.5 w-3.5" /> Urgencia / ingreso directo
              </span>
              <span className={cn('text-xs leading-snug', urgencia ? 'text-red-700' : 'text-slate-500')}>
                El paciente va directo a la cama y todavía no está internado. Admisión lo ingresa en PROGAL y lo vincula al consolidar.
              </span>
            </span>
          </label>

          {urgencia ? (
            <>
              <div className="grid gap-2">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Nombre y apellido del paciente <span className="text-red-500">*</span></Label>
                <Input
                  value={pacienteNombre}
                  onChange={e => setPacienteNombre(e.target.value)}
                  placeholder="Ej.: Pérez, Juan"
                  maxLength={120}
                  autoComplete="off"
                  className="h-10 rounded-xl"
                />
                {pacienteNombre.trim().length > 0 && !nombreOk && (
                  <p className="text-[11px] text-red-600">Cargá nombre y apellido.</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Destino (Disponible/Prep) <span className="text-red-500">*</span></Label>
                <SearchableSelect
                  value={destinoBedLabel}
                  onValueChange={setDestinoBedLabel}
                  options={destinoOptions}
                  placeholder="Seleccionar cama destino"
                  searchPlaceholder="Buscar cama de destino..."
                />
              </div>
            </>
          ) : (
          <>
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

          </>
          )}

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
            disabled={!canSubmit}
            className={cn('text-white rounded-xl h-10 px-8 disabled:opacity-50', urgencia ? 'bg-red-700 hover:bg-red-800' : 'bg-emerald-950')}
          >
            {urgencia ? 'Registrar urgencia' : 'Enviar a Admisión'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
