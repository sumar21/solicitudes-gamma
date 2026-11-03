import React, { useState } from 'react';
import { Ticket } from '../../types';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
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
      {/* Confirmación destructiva (DESIGN §4.2) dentro del modal canónico §4.1. */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restablecer destino</DialogTitle>
          <DialogDescription>Ticket <span className="font-mono font-medium text-foreground">{t.id}</span></DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="size-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
            <RotateCcw className="size-5" />
          </div>
          <p className="text-sm text-foreground">
            Se libera <b>{cama}</b> para otro paciente y el pre-ticket de <b>{t.patientName}</b> vuelve a <b>Configurar destino</b>. Las azafatas que lo tenían en la grilla reciben el aviso "Destino liberado".
          </p>
          {t.intervenedByHostess === 'SI' && (
            <div className="rounded-lg border p-3 flex items-start gap-2 text-sm bg-amber-50 border-amber-200 text-amber-700">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <p className="text-xs">
                La azafata ya marcó la habitación lista. Si la cama queda libre, revisen su estado en PROGAL para que el mapa la muestre como corresponde.
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="restablecer-motivo" className="mb-1 block text-xs font-medium text-muted-foreground">Motivo (opcional, queda en la trayectoria)</Label>
            <Textarea
              id="restablecer-motivo"
              placeholder="Ej: la cama se asignó a un paciente de guardia"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={cerrar}>Cancelar</Button>
          <Button
            type="button"
            variant="destructive"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onConfirm(t.id, motivo, t.destination);
              setSaving(false);
              if (ok) cerrar();
            }}
            className="min-w-[140px]"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? 'Liberando…' : 'Sí, liberar la cama'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
