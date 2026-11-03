import React, { useState } from 'react';
import { Area, Bed, BedStatus, Ticket } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Combobox } from '../ui/combobox';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { MOVIMIENTOS_PRETICKET, REQUISITOS_CAMA, REQUISITO_SIN } from '../../lib/constants';
import { formatBedName, isHitArea, isHraArea, cn } from '../../lib/utils';
import { Check, Siren } from 'lucide-react';
import { OriginBedBusyNotice } from '../OriginBedBusyNotice';

// Orden por SECTOR (no por apellido): mismo criterio que NewRequestModal/BedsView —
// pre-internación (HRA, HIT) primero, después pisos, después unidades críticas; empate por cama.
const AREA_ORDER: Area[] = [
  Area.HRA, Area.HIT,
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8,
  Area.HUC, Area.HUT, Area.HUQ, Area.HSS,
];
// Label canónico de campo (DESIGN §3.3) y caja de dato precargado (solo lectura, mismo alto que un input).
const claseLabel = 'mb-1 block text-xs font-medium text-muted-foreground';
const claseSoloLectura = 'h-10 px-3 flex items-center rounded-md border bg-muted/50 text-sm min-w-0';

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
// URGENCIA / INGRESO DIRECTO: el paciente va directo a la cama, sin pasar por Admisión; el ticket nace
// "Por Consolidar". Dos casos (pedido de Gamma, 06/10/2026):
//  - NO internado (viene de guardia/afuera): no hay cama de origen. Coordinación tipea nombre y apellido
//    (campo libre) y Admisión lo vincula a un paciente real de PROGAL al consolidar.
//  - YA internado (está en el mapa de camas): se elige del desplegable de internados, igual que un
//    pre-ticket. Sale de su cama real con código y evento → se consolida como un traslado normal.
export type UrgenciaPaciente = 'NO_INTERNADO' | 'INTERNADO';
export interface PreTicketCreateData {
  originBedLabel: string;
  movimiento: string;
  requisitos: string[];
  observations?: string;
  urgencia?: boolean;
  /** Sólo con urgencia: 'INTERNADO' → originBedLabel es la cama real del paciente; 'NO_INTERNADO' → pacienteNombre. */
  urgenciaPaciente?: UrgenciaPaciente;
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
  /** Cama de origen → ticket activo que sale de ella. Si el paciente elegido está en una de esas camas,
   *  se avisa ANTES de enviar y se bloquea el botón (antes salía el error recién al guardar). */
  activeTicketByOrigin?: Map<string, Ticket>;
  /** Sectores del usuario (solo para roles con filterByFloors). Recorta el desplegable de
   *  pacientes a sus pisos: si podía pedir una cama para un paciente de otro sector, el
   *  pre-ticket resultante le quedaba invisible en la grilla (que sí filtra por piso). */
  assignedAreas?: Area[];
}

export const MIN_NOMBRE_URGENCIA = 3;

export const PreTicketModal: React.FC<PreTicketModalProps> = ({ open, onOpenChange, onCreate, beds, assignedAreas, activeTransferDestinations = new Set(), activeTicketByOrigin }) => {
  const [originBedLabel, setOriginBedLabel] = useState('');
  const [movimiento, setMovimiento] = useState('');
  const [requisitos, setRequisitos] = useState<string[]>([]);
  const [observations, setObservations] = useState('');
  const [urgencia, setUrgencia] = useState(false);
  const [urgenciaPaciente, setUrgenciaPaciente] = useState<UrgenciaPaciente>('NO_INTERNADO');
  const [pacienteNombre, setPacienteNombre] = useState('');
  const [destinoBedLabel, setDestinoBedLabel] = useState('');

  React.useEffect(() => {
    if (!open) {
      setOriginBedLabel('');
      setMovimiento('');
      setRequisitos([]);
      setObservations('');
      setUrgencia(false);
      setUrgenciaPaciente('NO_INTERNADO');
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
  const internado = urgencia && urgenciaPaciente === 'INTERNADO';
  // Un solo traslado/pre-ticket activo por cama de origen (paciente normal o urgencia de un internado).
  const blockingTicket = originBedLabel && (!urgencia || internado) ? activeTicketByOrigin?.get(originBedLabel) : undefined;
  const canSubmit = !blockingTicket && (urgencia
    ? (!!destinoBedLabel && (internado ? !!originBedLabel : nombreOk))
    : (!!originBedLabel && !!movimiento));

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
        originBedLabel: internado ? originBedLabel : '', movimiento: '', requisitos,
        observations: observations.trim() !== '' ? observations : undefined,
        urgencia: true,
        urgenciaPaciente,
        pacienteNombre: internado ? undefined : pacienteNombre.trim().replace(/\s+/g, ' '),
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
      {/* Modal de formulario canónico (DESIGN §4.1). */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{urgencia ? 'Traslado directo por urgencia' : 'Nuevo pre-ticket de traslado'}</DialogTitle>
          <DialogDescription>
            {urgencia ? 'El ticket queda "Por Consolidar" para Admisión.' : 'Admisión configura el destino después.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
        <form id="create-pre-ticket-form" onSubmit={handleSubmit} className="space-y-4">

          {/* Urgencia / ingreso directo: el paciente va directo a la cama y todavía no está internado. */}
          <label
            className={cn(
              'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
              urgencia ? 'border-red-200 bg-red-50' : 'bg-card hover:bg-muted/50',
            )}
          >
            <Checkbox
              checked={urgencia}
              onCheckedChange={v => setUrgencia(v === true)}
              className="mt-0.5"
              aria-label="Urgencia / ingreso directo"
            />
            <span className="grid gap-0.5">
              <span className={cn('flex items-center gap-1.5 text-sm font-semibold', urgencia ? 'text-red-700' : 'text-foreground')}>
                <Siren className="size-3.5" /> Urgencia / ingreso directo
              </span>
              <span className={cn('text-xs leading-snug', urgencia ? 'text-red-700' : 'text-muted-foreground')}>
                El paciente va directo a la cama, sin pasar por la azafata. El ticket queda "Por Consolidar" para Admisión.
              </span>
            </span>
          </label>

          {urgencia ? (
            <>
              <div>
                <Label className={claseLabel}>¿El paciente ya está internado? <span className="text-destructive">*</span></Label>
                <div role="radiogroup" aria-label="¿El paciente ya está internado?" className="grid grid-cols-2 gap-2">
                  {([
                    ['NO_INTERNADO', 'No internado', 'Viene de guardia / afuera'],
                    ['INTERNADO', 'Internado', 'Ya está en el mapa de camas'],
                  ] as const).map(([v, label, hint]) => {
                    const on = urgenciaPaciente === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => { setUrgenciaPaciente(v); setOriginBedLabel(''); setPacienteNombre(''); }}
                        className={cn(
                          'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                          on ? 'border-red-200 bg-red-50 text-red-700' : 'bg-card text-foreground hover:bg-muted/50',
                        )}
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-red-600' : 'border-muted-foreground')}>
                            {on && <span className="size-2 rounded-full bg-red-600" />}
                          </span>
                          {label}
                        </span>
                        <span className={cn('pl-6 text-[11px] leading-snug', on ? 'text-red-700' : 'text-muted-foreground')}>{hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {internado ? (
                <>
                  <div>
                    <Label className={claseLabel}>Paciente internado <span className="text-destructive">*</span></Label>
                    <Combobox obligatorio
                      value={originBedLabel}
                      onChange={setOriginBedLabel}
                      opciones={patientOptions}
                      placeholder="Seleccionar paciente"
                      buscar="Buscar por paciente o cama..."
                    />
                  </div>
                  {blockingTicket && <OriginBedBusyNotice ticket={blockingTicket} beds={beds} />}
                  {selectedBed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="min-w-0">
                        <Label className={claseLabel}>Obra social</Label>
                        <div className={claseSoloLectura} title={selectedBed.institution || ''}>
                          <span className="truncate">{selectedBed.institution || '—'}</span>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <Label className={claseLabel}>Cama actual</Label>
                        <div className={claseSoloLectura} title={formatBedName(selectedBed.label)}>
                          <span className="truncate">{formatBedName(selectedBed.label)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
              <div>
                <Label htmlFor="preticket-paciente-nombre" className={claseLabel}>Nombre y apellido del paciente <span className="text-destructive">*</span></Label>
                <Input
                  id="preticket-paciente-nombre"
                  value={pacienteNombre}
                  onChange={e => setPacienteNombre(e.target.value)}
                  placeholder="Ej.: Pérez, Juan"
                  maxLength={120}
                  autoComplete="off"
                  aria-invalid={pacienteNombre.trim().length > 0 && !nombreOk}
                />
                {pacienteNombre.trim().length > 0 && !nombreOk && (
                  <p className="text-xs text-destructive mt-1">Cargá nombre y apellido.</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Admisión lo ingresa en PROGAL y lo vincula al paciente real al consolidar.</p>
              </div>
              )}
              <div>
                <Label className={claseLabel}>Destino (disponible / en preparación) <span className="text-destructive">*</span></Label>
                <Combobox obligatorio
                  value={destinoBedLabel}
                  onChange={setDestinoBedLabel}
                  opciones={destinoOptions}
                  placeholder="Seleccionar cama destino"
                  buscar="Buscar cama de destino..."
                />
              </div>
            </>
          ) : (
          <>
          <div>
            <Label className={claseLabel}>Paciente <span className="text-destructive">*</span></Label>
            <Combobox obligatorio
              value={originBedLabel}
              onChange={setOriginBedLabel}
              opciones={patientOptions}
              placeholder="Seleccionar paciente"
              buscar="Buscar por paciente o cama..."
            />
          </div>
          {blockingTicket && <OriginBedBusyNotice ticket={blockingTicket} beds={beds} />}

          {/* Precarga desde el paciente: obra social + origen (la Coordinadora no los carga). */}
          {selectedBed && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="min-w-0">
                <Label className={claseLabel}>Obra social</Label>
                <div className={claseSoloLectura} title={selectedBed.institution || ''}>
                  <span className="truncate">{selectedBed.institution || '—'}</span>
                </div>
              </div>
              <div className="min-w-0">
                <Label className={claseLabel}>Origen</Label>
                <div className={claseSoloLectura} title={formatBedName(selectedBed.label)}>
                  <span className="truncate">{formatBedName(selectedBed.label)}</span>
                </div>
              </div>
            </div>
          )}

          <div>
            <Label className={claseLabel}>Movimiento <span className="text-destructive">*</span></Label>
            <Combobox obligatorio
              value={movimiento}
              onChange={setMovimiento}
              opciones={MOVIMIENTOS_PRETICKET.map(m => ({ label: m, value: m }))}
              placeholder="Seleccione el movimiento"
            />
          </div>

          </>
          )}

          {/* Requisitos: también en una urgencia (el paciente puede necesitar colchón, autólisis…). */}
          <div>
            <Label className={claseLabel}>Requisitos de la nueva cama</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {REQUISITOS_CAMA.map(r => {
                const active = requisitos.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleRequisito(r)}
                    className={cn(
                      'flex items-center gap-2 px-3 h-10 rounded-md border text-sm text-left transition-colors',
                      active ? 'bg-primary/5 border-primary/40 text-foreground font-medium' : 'bg-card text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    <span className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                      active ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground',
                    )}>
                      {active && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 truncate">{r}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className={claseLabel}>Observación (opcional)</Label>
            <Input placeholder="Información adicional para Admisión..." value={observations} onChange={e => setObservations(e.target.value)} />
          </div>
        </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            type="submit"
            form="create-pre-ticket-form"
            disabled={!canSubmit}
            variant={urgencia ? 'destructive' : 'default'}
            className="min-w-[140px]"
          >
            {urgencia ? 'Registrar urgencia' : 'Enviar a Admisión'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
