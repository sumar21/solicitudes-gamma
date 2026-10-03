import React, { useMemo, useRef, useState } from 'react';
import { Bed, BedStatus, Ticket } from '../../types';
import type { UrgenciaLink } from '../../hooks/useHospitalState';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { SearchableSelect } from '../ui/searchable-select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
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
      <DialogContent className="sm:max-w-[550px] rounded-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl pr-6 flex items-center gap-2">
            <Siren className="h-5 w-5 text-red-600" /> Vincular paciente y consolidar
          </DialogTitle>
        </DialogHeader>
        <form id="consolidar-urgencia-form" onSubmit={handleSubmit} className="grid gap-4 py-2">

          <div className="rounded-2xl border border-red-200 bg-red-50/60 p-3 grid gap-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Cargado por Coordinación</span>
                <span className="text-sm font-semibold text-slate-800 truncate" title={declarado}>{declarado}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Destino</span>
                <span className="text-sm text-slate-700 truncate">{ticket.destination ? formatBedName(ticket.destination) : '—'}</span>
              </div>
            </div>
            <p className="text-xs text-red-800 leading-snug">
              Ingresá al paciente en PROGAL y elegilo acá. Así el traslado y su trayectoria quedan asociados a una persona
              y a un evento de internación reales.
            </p>
          </div>

          <div className="grid gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Paciente en PROGAL <span className="text-red-500">*</span></Label>
            <SearchableSelect
              value={patientCode}
              onValueChange={(v) => { pickedByUser.current = true; setPatientCode(v); }}
              options={candidates.map(b => ({
                label: `${b.patientName} — ${formatBedName(b.label)}${b.dni ? ` · DNI ${b.dni}` : ''}`,
                value: String(b.patientCode).trim(),
              }))}
              placeholder="Buscar paciente internado…"
              searchPlaceholder="Buscar por nombre, cama o DNI..."
              listMaxHeight="max-h-[260px]"
            />
            {!picked && !suggested && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-600 shrink-0" />
                <p className="text-xs font-medium text-amber-800">
                  Todavía no figura internado en la cama destino. Ingresalo en PROGAL: el mapa se actualiza solo en
                  unos instantes y vas a poder elegirlo.
                </p>
              </div>
            )}
            {picked && suggested === patientCode && (
              <p className="text-[11px] text-emerald-700 font-medium px-1">Sugerido: es quien PROGAL tiene internado en la cama destino.</p>
            )}
            {pickedElsewhere && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-600 shrink-0" />
                <p className="text-xs font-medium text-amber-800">
                  Ese paciente está en {formatBedName(picked!.label)}, no en {formatBedName(ticket.destination!)}. Verificá que sea el correcto.
                </p>
              </div>
            )}
          </div>

          {picked && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 grid grid-cols-2 gap-3">
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Paciente</span>
                <span className="text-sm font-semibold text-slate-800 truncate">{picked.patientName}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Código</span>
                <span className="text-sm text-slate-700 tabular-nums">{String(picked.patientCode).trim()}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Evento de internación</span>
                <span className="text-sm text-slate-700 truncate">{bedEventKey(picked) || '—'}</span>
              </div>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Obra social</span>
                <span className="text-sm text-slate-700 truncate">{picked.institution || '—'}</span>
              </div>
            </div>
          )}
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10 px-6">Cancelar</Button>
          <Button
            type="submit"
            form="consolidar-urgencia-form"
            disabled={!picked}
            className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl h-10 px-8 disabled:opacity-50"
          >
            <UserCheck className="w-4 h-4 mr-2" /> Vincular y consolidar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
