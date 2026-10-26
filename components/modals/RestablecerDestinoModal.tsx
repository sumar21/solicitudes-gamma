import React, { useState } from 'react';
import { Ticket } from '../../types';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { formatBedName } from '../../lib/utils';

// "Restablecer destino" desde la fila de la grilla (26/10/2026): para cuando "Editar" no está, sobre todo con
// la habitación ya marcada lista por la azafata. Con "Editar" disponible, lo mismo vive dentro del modal de edición.
interface RestablecerDestinoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket | null;
  onConfirm: (ticketId: string, motivo: string, destinoVisto?: string | null) => Promise<boolean>;
}

export const RestablecerDestinoModal: React.FC<RestablecerDestinoModalProps> = ({ open, onOpenChange, ticket, onConfirm }) => {
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  // Foto del pedido al abrir: el restablecimiento optimista le vacía el destino (se leía "Se libera (vacío)")
  // y Realtime puede sacarlo de la lista con el modal abierto. Otro pedido → motivo en blanco.
  const [foto, setFoto] = useState<Ticket | null>(null);
  React.useEffect(() => {
    if (!open) { setFoto(null); setMotivo(''); return; }
    if (ticket && ticket.id !== foto?.id) { setFoto(ticket); setMotivo(''); }
  }, [open, ticket, foto?.id]);
  const t = foto ?? ticket;
  if (!t) return null;
  const cama = formatBedName(t.destination ?? '');
  const cerrar = () => { setMotivo(''); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setMotivo(''); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[460px] rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl text-red-700 pr-6">Restablecer destino</DialogTitle>
          <p className="text-[10px] font-mono font-bold text-slate-400 tracking-wide uppercase">{t.id}</p>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <p className="text-[12px] text-slate-700">
            Se libera <b>{cama}</b> para otro paciente y el pre-ticket de <b>{t.patientName}</b> vuelve a <b>Configurar destino</b>. Las azafatas que lo tenían en la grilla reciben el aviso "Destino liberado".
          </p>
          {t.intervenedByHostess === 'SI' && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              La azafata ya marcó la habitación lista. Si la cama queda libre, revisen su estado en PROGAL para que el mapa la muestre como corresponde.
            </p>
          )}
          <div className="grid gap-1.5">
            <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Motivo (opcional, queda en la trayectoria)</Label>
            <textarea
              placeholder="Ej: la cama se asignó a un paciente de guardia"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300 resize-none"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={cerrar} className="rounded-xl h-10 px-6">Cancelar</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onConfirm(t.id, motivo, t.destination);
              setSaving(false);
              if (ok) cerrar();
            }}
            className="bg-red-600 hover:bg-red-700 text-white rounded-xl h-10 px-6"
          >
            {saving ? 'Liberando…' : 'Sí, liberar la cama'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
