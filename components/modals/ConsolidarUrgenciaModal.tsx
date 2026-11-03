import React, { useMemo, useRef, useState } from 'react';
import { Bed, BedStatus, Ticket } from '../../types';
import type { UrgenciaLink } from '../../hooks/useHospitalState';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Combobox } from '../ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { bedEventKey, formatBedName } from '../../lib/utils';
import { Siren, UserCheck, AlertTriangle } from 'lucide-react';

/**
 * Consolidar una URGENCIA / ingreso directo = VINCULAR el ticket a un paciente real de PROGAL.
 *
 * Coordinación cargó un nombre libre porque el paciente todavía no estaba internado. Admisión lo ingresa
 * en PROGAL y, al consolidar, tiene que elegir acá a esa persona para que el ticket y su trayectoria
 * queden asociados a un código de paciente y a un evento de internación de verdad (sino quedan
 * "flotando"). El servidor lo exige igual (api/tickets.ts → 422): este modal es la forma cómoda.
 *
 * Candidatos: pacientes con cama OCUPADA y código en el mapa. Si el ocupante de la cama destino tiene
 * código (PROGAL ya lo internó ahí) se sugiere solo.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket | null;
  beds: Bed[];
  onConfirm: (ticketId: string, link: UrgenciaLink) => void;
}

export const ConsolidarUrgenciaModal: React.FC<Props> = ({ open, onOpenChange, ticket, beds, onConfirm }) => {
  const [patientCode, setPatientCode] = useState('');
  // ¿Ya eligió a mano? Si sí, un refresco del mapa (que cambie la sugerencia) NO le pisa la elección.
  const pickedByUser = useRef(false);

  // Una cama por paciente (un código no se repite en el mapa, pero Gamma a veces deja residuales).
  const candidates = useMemo(() => {
    const byCode = new Map<string, Bed>();
    for (const b of beds) {
      if (b.status !== BedStatus.OCCUPIED || !b.patientCode || !b.patientName) continue;
      const code = String(b.patientCode).trim();
      if (code && !byCode.has(code)) byCode.set(code, b);
    }
    return [...byCode.values()].sort((a, b) => (a.patientName ?? '').localeCompare(b.patientName ?? '', 'es'));
  }, [beds]);

  // Sugerencia: PROGAL ya internó a alguien en la cama destino del ticket.
  const suggested = useMemo(() => {
    const dest = ticket?.destination ? candidates.find(b => b.label === ticket.destination) : undefined;
    return dest ? String(dest.patientCode).trim() : '';
  }, [candidates, ticket]);

  // Al abrir se precarga la sugerencia (y se limpia la marca de "eligió a mano"). Mientras el modal sigue abierto,
  // la sugerencia solo se aplica si el usuario todavía no tocó el selector: si Admisión eligió a P y el poll de
  // camas trae a Q recién internado en la cama destino, vincular a Q sin que se note sería un error silencioso.
  React.useEffect(() => {
    if (!open) { pickedByUser.current = false; return; }
    if (!pickedByUser.current) setPatientCode(suggested);
  }, [open, suggested]);

  if (!ticket) return null;

  const picked = candidates.find(b => String(b.patientCode).trim() === patientCode);
  const pickedElsewhere = !!picked && !!ticket.destination && picked.label !== ticket.destination;
  const declarado = ticket.pacienteDeclarado || ticket.patientName;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    onConfirm(ticket.id, {
      patientCode: String(picked.patientCode).trim(),
      patientName: String(picked.patientName),
      eventKey: bedEventKey(picked) || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Modal de formulario canónico (DESIGN §4.1). */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Siren className="size-5 text-red-600" /> Vincular paciente y consolidar
          </DialogTitle>
          <DialogDescription>Urgencia / ingreso directo de <span className="font-medium text-foreground">{declarado}</span></DialogDescription>
        </DialogHeader>
        <DialogBody>
        <form id="consolidar-urgencia-form" onSubmit={handleSubmit} className="space-y-4">

          {/* Lo que cargó Coordinación + la indicación: caja con tinte de urgencia (rojo semántico §1.4). */}
          <div className="space-y-3 p-4 rounded-lg border border-red-200 bg-red-50">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cargado por Coordinación</span>
                <span className="text-sm font-semibold text-foreground truncate" title={declarado}>{declarado}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Destino</span>
                <span className="text-sm text-foreground truncate">{ticket.destination ? formatBedName(ticket.destination) : '—'}</span>
              </div>
            </div>
            <p className="text-xs text-red-700 leading-snug">
              Ingresá al paciente en PROGAL y elegilo acá. Así el traslado y su trayectoria quedan asociados a una persona
              y a un evento de internación reales.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="mb-1 block text-xs font-medium text-muted-foreground">Paciente en PROGAL <span className="text-destructive">*</span></Label>
            <Combobox obligatorio
              value={patientCode}
              onChange={(v) => { pickedByUser.current = true; setPatientCode(v); }}
              opciones={candidates.map(b => ({
                label: `${b.patientName} — ${formatBedName(b.label)}${b.dni ? ` · DNI ${b.dni}` : ''}`,
                value: String(b.patientCode).trim(),
              }))}
              placeholder="Buscar paciente internado…"
              buscar="Buscar por nombre, cama o DNI..."
            />
            {!picked && !suggested && (
              <div className="rounded-lg border p-3 flex items-start gap-2 text-sm bg-amber-50 border-amber-200 text-amber-700">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <p className="text-xs font-medium">
                  Todavía no figura internado en la cama destino. Ingresalo en PROGAL: el mapa se actualiza solo en
                  unos instantes y vas a poder elegirlo.
                </p>
              </div>
            )}
            {picked && suggested === patientCode && (
              <p className="text-xs text-emerald-700 font-medium">Sugerido: es quien PROGAL tiene internado en la cama destino.</p>
            )}
            {pickedElsewhere && (
              <div className="rounded-lg border p-3 flex items-start gap-2 text-sm bg-amber-50 border-amber-200 text-amber-700">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <p className="text-xs font-medium">
                  Ese paciente está en {formatBedName(picked!.label)}, no en {formatBedName(ticket.destination!)}. Verificá que sea el correcto.
                </p>
              </div>
            )}
          </div>

          {picked && (
            <div className="p-4 bg-secondary/20 rounded-lg border border-border/50 grid grid-cols-2 gap-3">
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Paciente</span>
                <span className="text-sm font-semibold text-foreground truncate">{picked.patientName}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Código</span>
                <span className="text-sm text-foreground tabular-nums">{String(picked.patientCode).trim()}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Evento de internación</span>
                <span className="text-sm text-foreground truncate">{bedEventKey(picked) || '—'}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Obra social</span>
                <span className="text-sm text-foreground truncate">{picked.institution || '—'}</span>
              </div>
            </div>
          )}
        </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            type="submit"
            form="consolidar-urgencia-form"
            disabled={!picked}
            className="min-w-[140px]"
          >
            <UserCheck className="size-4" /> Vincular y consolidar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
