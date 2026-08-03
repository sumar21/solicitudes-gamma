import React, { useMemo, useState } from 'react';
import { Bed, BedStatus, CirugiaEstado, CirugiaTraslado, User, Area } from '../types';
import { can } from '../lib/permissions';
import { cn, formatBedName, formatDateTime } from '../lib/utils';
import { CIRUGIA_ESTADO_LABEL, CIRUGIA_PILL_CLASS } from '../lib/constants';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import {
  Activity, ArrowRight, BedDouble, CheckCircle2, Clock, RefreshCw, Search, X, XCircle, AlertTriangle,
} from 'lucide-react';

// Display de área (copiado de BedsView/CleaningManagementView — no está exportado).
const AREA_LABELS: Record<string, string> = {
  [Area.PISO_4]: 'Piso 4', [Area.PISO_5]: 'Piso 5', [Area.PISO_6]: 'Piso 6',
  [Area.PISO_7]: 'Piso 7', [Area.PISO_8]: 'Piso 8',
  [Area.HIT]: 'ITR', [Area.HRA]: 'Sala Espera', [Area.HSS]: 'Sueño',
  [Area.HUC]: 'UCO', [Area.HUQ]: 'URP', [Area.HUT]: 'UTI',
};
const areaLabel = (a?: string) => (a ? AREA_LABELS[a] ?? a : '—');

type TxResult = { ok: boolean; error?: string };

interface Props {
  cirugias: CirugiaTraslado[];
  beds: Bed[];
  currentUser: User | null;
  onVanABuscar: (id: string) => Promise<TxResult>;
  onEnCirugia: (id: string) => Promise<TxResult>;
  onEnDevolucion: (id: string, camaDestino?: string) => Promise<TxResult>;
  onRecibida: (id: string) => Promise<TxResult>;
  onCancelar: (id: string, motivo: string) => Promise<TxResult>;
  onConsolidar: (id: string) => Promise<TxResult>;
  onRefresh?: () => void | Promise<void>;
}

const Pill: React.FC<{ estado: CirugiaEstado }> = ({ estado }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-tight', CIRUGIA_PILL_CLASS[estado])}>
    <Activity className="w-3 h-3" strokeWidth={3} /> Cx · {CIRUGIA_ESTADO_LABEL[estado]}
  </span>
);

// Orden de las secciones de la cola (sin terminales — el GET solo trae vivas).
const SECTIONS: { estado: CirugiaEstado; title: string }[] = [
  { estado: 'LISTO_PARA_CIRUGIA', title: 'Listos para cirugía' },
  { estado: 'VAN_A_BUSCAR',       title: 'En camino (van a buscar)' },
  { estado: 'EN_CIRUGIA',         title: 'En cirugía' },
  { estado: 'EN_DEVOLUCION',      title: 'Volviendo' },
];

export const CirugiasView: React.FC<Props> = ({
  cirugias, beds, currentUser, onVanABuscar, onEnCirugia, onEnDevolucion, onRecibida, onCancelar, onConsolidar, onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Panel inline "En devolución": id de la cirugía cuyo selector de destino está abierto.
  const [devolviendo, setDevolviendo] = useState<{ id: string; camaDestino: string } | null>(null);
  // Panel inline "Cancelar": id + motivo tipeado.
  const [cancelando, setCancelando] = useState<{ id: string; motivo: string } | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // Camas disponibles para elegir destino al devolver (misma lógica que un traslado).
  const availableBeds = useMemo(
    () => beds.filter(b => b.status === BedStatus.AVAILABLE).sort((a, b) => a.label.localeCompare(b.label)),
    [beds],
  );

  const withPending = async (id: string, fn: () => Promise<TxResult>) => {
    setPending(p => new Set(p).add(id));
    setRowError(e => { const n = { ...e }; delete n[id]; return n; });
    try {
      const r = await fn();
      if (!r.ok) setRowError(e => ({ ...e, [id]: r.error ?? 'No se pudo actualizar.' }));
      return r;
    } finally {
      setPending(p => { const n = new Set(p); n.delete(id); return n; });
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return cirugias;
    const q = search.toLowerCase();
    return cirugias.filter(c =>
      (c.pacienteNombre ?? '').toLowerCase().includes(q) ||
      (c.camaOrigen ?? '').toLowerCase().includes(q) ||
      (c.camaDestino ?? '').toLowerCase().includes(q) ||
      (c.pacienteCodigo ?? '').toLowerCase().includes(q),
    );
  }, [cirugias, search]);

  const byEstado = (estado: CirugiaEstado) => filtered.filter(c => c.estado === estado);

  // "Cambio de cama a consolidar" (Admisión): cirugías en devolución con cama distinta al origen.
  const cambiosDeCamaPend = useMemo(
    () => filtered.filter(c => c.estado === 'PENDIENTE_CONSOLIDACION' && !!c.camaDestino && c.camaDestino !== c.camaOrigen),
    [filtered],
  );
  const canConsolidar = can(currentUser, 'consolidar');

  const isPending = (id: string) => pending.has(id);

  // Botones de acción de CIRUGÍA por estado (orden feliz de la máquina de estados).
  const renderCirugiaActions = (c: CirugiaTraslado) => {
    const p = isPending(c.id);
    switch (c.estado) {
      case 'LISTO_PARA_CIRUGIA':
        return (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onVanABuscar(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-orange-500 hover:bg-orange-600 text-white">
            <ArrowRight className="w-3.5 h-3.5 mr-1.5" /> Voy a buscar
          </Button>
        );
      case 'VAN_A_BUSCAR':
        return (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onEnCirugia(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-cyan-600 hover:bg-cyan-700 text-white">
            <Activity className="w-3.5 h-3.5 mr-1.5" /> En cirugía
          </Button>
        );
      case 'EN_CIRUGIA':
        return (
          <Button size="sm" disabled={p} onClick={() => setDevolviendo({ id: c.id, camaDestino: c.camaOrigen })}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-violet-600 hover:bg-violet-700 text-white">
            <BedDouble className="w-3.5 h-3.5 mr-1.5" /> En devolución
          </Button>
        );
      case 'EN_DEVOLUCION':
        // La recepción la confirma ENFERMERÍA del piso destino (desde el Mapa de Camas). Se expone
        // también acá para poder testear el circuito completo con el rol Admin (gating fino → F5).
        return (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onRecibida(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-emerald-600 hover:bg-emerald-700 text-white">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Recibida
          </Button>
        );
      default:
        return null;
    }
  };

  const renderRow = (c: CirugiaTraslado) => {
    const p = isPending(c.id);
    const camaChange = c.estado === 'EN_DEVOLUCION' && !!c.camaDestino && c.camaDestino !== c.camaOrigen;
    return (
      <Card key={c.id} className="p-3.5 border-slate-200 bg-white shadow-sm flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-slate-900 text-sm uppercase tracking-tight truncate">
                {c.pacienteNombre || 'Paciente s/nombre'}
              </span>
              <Pill estado={c.estado} />
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 flex-wrap">
              <BedDouble className="w-3.5 h-3.5 text-slate-400" />
              <span>{formatBedName(c.camaOrigen)}</span>
              {camaChange && (
                <>
                  <ArrowRight className="w-3 h-3 text-violet-500" />
                  <span className="text-violet-700">{formatBedName(c.camaDestino!)}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[9px] font-black uppercase">
                    <AlertTriangle className="w-2.5 h-2.5" /> cambió (era {formatBedName(c.camaOrigen)})
                  </span>
                </>
              )}
              <span className="text-slate-300">·</span>
              <span className="text-slate-400 font-medium">{areaLabel(c.area)}</span>
              {c.tipo && (<>
                <span className="text-slate-300">·</span>
                <span className="text-cyan-800 font-bold" title="Tipo de internación (PROGAL)">{c.tipo}</span>
              </>)}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
              <Clock className="w-3 h-3" /> {formatDateTime(c.updatedAt || c.createdAt)}
            </div>
          </div>
        </div>

        {rowError[c.id] && (
          <p className="text-[10px] font-bold text-red-600">{rowError[c.id]}</p>
        )}

        {/* Acciones */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {renderCirugiaActions(c)}
          <Button size="sm" variant="outline" disabled={p}
            onClick={() => setCancelando({ id: c.id, motivo: '' })}
            className="h-8 text-[10px] uppercase font-bold tracking-tight border-red-200 text-red-600 hover:bg-red-50">
            <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancelar
          </Button>
        </div>

        {/* Panel inline: elegir destino al devolver */}
        {devolviendo?.id === c.id && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">Destino de la devolución</p>
            <select
              value={devolviendo.camaDestino}
              onChange={e => setDevolviendo({ id: c.id, camaDestino: e.target.value })}
              className="w-full rounded-lg border border-violet-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200">
              <option value={c.camaOrigen}>Misma cama ({formatBedName(c.camaOrigen)})</option>
              {availableBeds.map(b => (
                <option key={b.id} value={b.label}>{formatBedName(b.label)} — {areaLabel(b.area)}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button size="sm" disabled={p}
                onClick={async () => {
                  const dest = devolviendo.camaDestino === c.camaOrigen ? undefined : devolviendo.camaDestino;
                  const r = await withPending(c.id, () => onEnDevolucion(c.id, dest));
                  if (r.ok) setDevolviendo(null);
                }}
                className="flex-1 h-8 text-[10px] font-bold rounded-lg bg-violet-600 hover:bg-violet-700 text-white">
                Confirmar devolución
              </Button>
              <Button size="sm" variant="outline" disabled={p} onClick={() => setDevolviendo(null)}
                className="h-8 px-3 text-[10px] font-bold rounded-lg border-slate-200 text-slate-500 hover:bg-slate-100">
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Panel inline: cancelar con motivo obligatorio */}
        {cancelando?.id === c.id && (
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-3 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-red-600">Motivo de cancelación</p>
            <textarea
              autoFocus value={cancelando.motivo} rows={2} maxLength={500}
              onChange={e => setCancelando({ id: c.id, motivo: e.target.value })}
              placeholder="Ej: se suspendió la cirugía, alta del paciente…"
              className="w-full rounded-lg border border-red-200 px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-red-200" />
            <div className="flex gap-2">
              <Button size="sm" disabled={p || !cancelando.motivo.trim()}
                onClick={async () => {
                  const r = await withPending(c.id, () => onCancelar(c.id, cancelando.motivo.trim()));
                  if (r.ok) setCancelando(null);
                }}
                className="flex-1 h-8 text-[10px] font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40">
                Confirmar cancelación
              </Button>
              <Button size="sm" variant="outline" disabled={p} onClick={() => setCancelando(null)}
                className="h-8 px-3 text-[10px] font-bold rounded-lg border-slate-200 text-slate-500 hover:bg-slate-100">
                Volver
              </Button>
            </div>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="p-4 md:p-8 animate-in slide-in-from-right-4 duration-300 max-w-full space-y-5">
      {/* Header: buscador + refrescar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 lg:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            placeholder="Paciente o cama…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-8 h-10 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-emerald-400" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {onRefresh && (
          <Button variant="outline" onClick={() => onRefresh()} className="h-10 gap-2 rounded-xl">
            <RefreshCw className="w-3.5 h-3.5" /> <span className="hidden sm:inline text-xs font-bold">Refrescar</span>
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="py-20 text-center opacity-30">
          <Activity className="w-12 h-12 mx-auto mb-3" />
          <p className="text-xs font-black uppercase tracking-widest">Sin cirugías activas</p>
        </div>
      ) : (
        <>
          {/* Cola por estado */}
          {SECTIONS.map(({ estado, title }) => {
            const rows = byEstado(estado);
            if (rows.length === 0) return null;
            return (
              <section key={estado} className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className={cn('w-2.5 h-2.5 rounded-full', CIRUGIA_PILL_CLASS[estado].split(' ')[0])} />
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">{title}</h3>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5 tabular-nums">{rows.length}</span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {rows.map(renderRow)}
                </div>
              </section>
            );
          })}

          {/* Cambio de cama a consolidar (Admisión) */}
          {cambiosDeCamaPend.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <h3 className="text-xs font-black uppercase tracking-widest text-amber-700">Cambio de cama a consolidar</h3>
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 tabular-nums">{cambiosDeCamaPend.length}</span>
              </div>
              <Card className="p-3.5 border-amber-200 bg-amber-50/40 space-y-2">
                {cambiosDeCamaPend.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-amber-100 last:border-0">
                    <div className="min-w-0 flex items-center gap-2 text-[11px] font-bold text-slate-700 flex-wrap">
                      <span className="uppercase truncate">{c.pacienteNombre || 'Paciente'}</span>
                      <span className="text-slate-400">{formatBedName(c.camaOrigen)}</span>
                      <ArrowRight className="w-3 h-3 text-violet-500" />
                      <span className="text-violet-700">{formatBedName(c.camaDestino!)}</span>
                    </div>
                    {/* Admisión: tras cambiar la cama en PROGAL a mano, consolida y cierra la fila →
                        la app suelta el override (limbo de mergeBeds) y confía en Gamma. */}
                    <Button size="sm" variant="outline" disabled={!canConsolidar || isPending(c.id)}
                      onClick={() => withPending(c.id, () => onConsolidar(c.id))}
                      title={canConsolidar ? 'Cambiá la cama en PROGAL y después consolidá acá' : 'Tu rol no tiene permiso para consolidar'}
                      className="h-8 text-[10px] uppercase font-bold tracking-tight border-amber-400 text-amber-800 hover:bg-amber-100 disabled:opacity-40">
                      Consolidar PROGAL {!canConsolidar && '(sin permiso)'}
                    </Button>
                  </div>
                ))}
                <p className="text-[10px] text-amber-700/80 font-medium pt-1">
                  Admisión: cambiá la cama en PROGAL y después "Consolidar PROGAL" acá. La app sostiene el cambio hasta entonces.
                </p>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
};
