import React, { useEffect, useMemo, useState } from 'react';
import { Bed, CirugiaEstado, CirugiaTraslado, User, Area } from '../types';
import { can } from '../lib/permissions';
import { cn, formatBedName, formatDateTime } from '../lib/utils';
import { CIRUGIA_ESTADO_LABEL, CIRUGIA_ESTADO_SHORT, CIRUGIA_PILL_CLASS } from '../lib/constants';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
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

// "hace X" desde un ISO hasta `now` (ms). Para ver de un vistazo cuánto lleva en el estado actual
// (updatedAt) y el total desde que arrancó la operatoria (createdAt).
const timeAgo = (iso: string | undefined, now: number): string => {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

type TxResult = { ok: boolean; error?: string };

interface Props {
  cirugias: CirugiaTraslado[];
  beds: Bed[];
  currentUser: User | null;
  onVanABuscar: (id: string) => Promise<TxResult>;
  onEnTraslado: (id: string) => Promise<TxResult>;
  onEnCirugia: (id: string) => Promise<TxResult>;
  onEnDevolucion: (id: string) => Promise<TxResult>;
  onRecibida: (id: string) => Promise<TxResult>;
  onTolerancia?: (id: string) => Promise<TxResult>;
  onCancelar: (id: string, motivo: string) => Promise<TxResult>;
  onRefresh?: () => void | Promise<void>;
}

const Pill: React.FC<{ estado: CirugiaEstado; short?: boolean }> = ({ estado, short }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-tight whitespace-nowrap', CIRUGIA_PILL_CLASS[estado])}>
    <Activity className="w-3 h-3 shrink-0" strokeWidth={3} /> Cx · {(short ? CIRUGIA_ESTADO_SHORT : CIRUGIA_ESTADO_LABEL)[estado]}
  </span>
);

// Orden del flujo para ordenar la lista ÚNICA (la columna Estado reemplaza a las secciones
// separadas, para dar concordancia con Traslados/Limpiezas/Comandas).
const ORDEN_ESTADO: Record<string, number> = {
  LISTO_PARA_CIRUGIA: 0, VAN_A_BUSCAR: 1, EN_TRASLADO: 2, EN_CIRUGIA: 3, EN_DEVOLUCION: 4, RECIBIDA: 5,
};

export const CirugiasView: React.FC<Props> = ({
  cirugias, beds, currentUser, onVanABuscar, onEnTraslado, onEnCirugia, onEnDevolucion, onRecibida, onTolerancia, onCancelar, onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Panel inline "Cancelar": id + motivo tipeado.
  const [cancelando, setCancelando] = useState<{ id: string; motivo: string } | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // Reloj de la vista: refresca los "hace X" cada 30s sin depender de un refetch.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

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

  // Recorte por sector para roles filterByFloors (mismo criterio que Traslados/Limpiezas, así una
  // azafata/enfermería de piso ve solo lo suyo). La cirugía "pertenece" al piso de la cama ACTUAL
  // relevante: el DESTINO de la devolución si ya se definió y difiere del origen, sino el ORIGEN.
  // Hand-off exclusivo → una cirugía de 405-1 la ve piso 4; cuando la devolución se fija a piso 5,
  // deja de verla piso 4 y pasa a verla piso 5. (Distinto de scopeTickets, que muestra a origen Y
  // destino a la vez; acá el destino MANDA cuando difiere, por pedido de negocio.)
  // Admin (todas las áreas) o beds sin cargar → no filtra, igual que scopeTickets.
  const scoped = useMemo(() => {
    if (!currentUser?.filterByFloors || !currentUser.assignedAreas?.length) return cirugias;
    const areas = currentUser.assignedAreas;
    const allAreas = new Set(Object.values(Area) as string[]);
    const hasAll = areas.length >= allAreas.size - 1; // 9 de 10 = efectivamente todas
    if (hasAll || beds.length === 0) return cirugias;
    const areaByLabel = new Map<string, string>();
    for (const b of beds) if (b.area) areaByLabel.set(b.label, b.area);
    const ownerArea = (c: CirugiaTraslado): string | undefined => {
      const destChanged = !!c.camaDestino && c.camaDestino !== c.camaOrigen;
      const bedLabel = destChanged ? c.camaDestino! : c.camaOrigen;
      return areaByLabel.get(bedLabel) ?? c.area; // fallback al área guardada en la fila (origen)
    };
    return cirugias.filter(c => {
      const a = ownerArea(c);
      return a ? areas.includes(a as Area) : true; // área irresoluble → no la ocultamos
    });
  }, [cirugias, currentUser, beds]);

  const filtered = useMemo(() => {
    if (!search.trim()) return scoped;
    const q = search.toLowerCase();
    return scoped.filter(c =>
      (c.pacienteNombre ?? '').toLowerCase().includes(q) ||
      (c.camaOrigen ?? '').toLowerCase().includes(q) ||
      (c.camaDestino ?? '').toLowerCase().includes(q) ||
      (c.pacienteCodigo ?? '').toLowerCase().includes(q),
    );
  }, [scoped, search]);

  // Lista ÚNICA ordenada por el flujo (más recientes primero dentro de cada estado). La columna
  // Estado distingue en qué paso está cada una — ya no hacen falta secciones separadas.
  const ordenadas = useMemo(
    () => [...filtered].sort((a, b) =>
      (ORDEN_ESTADO[a.estado] ?? 9) - (ORDEN_ESTADO[b.estado] ?? 9) ||
      String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)),
    ),
    [filtered],
  );

  const isPending = (id: string) => pending.has(id);

  // Botones de acción de CIRUGÍA por estado (orden feliz de la máquina de estados). Cada uno se
  // muestra SOLO si el rol tiene el permiso de esa acción — así un rol con todos los cirugia_*
  // (Admin) gestiona todo desde acá, y uno de quirófano ve solo sus pasos.
  const renderCirugiaActions = (c: CirugiaTraslado) => {
    const p = isPending(c.id);
    switch (c.estado) {
      case 'LISTO_PARA_CIRUGIA':
        return can(currentUser, 'cirugia_buscar') ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onVanABuscar(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-orange-500 hover:bg-orange-600 text-white">
            <ArrowRight className="w-3.5 h-3.5 mr-1.5" /> Voy a buscar
          </Button>
        ) : null;
      case 'VAN_A_BUSCAR':
        // El camillero llegó y la enfermera ENTREGA al paciente ("se lo llevó"). Acción de
        // Enfermería (también en el mapa), expuesta acá para un rol que gestione todo.
        return can(currentUser, 'cirugia_entregar') ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onEnTraslado(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-yellow-500 hover:bg-yellow-600 text-white">
            <ArrowRight className="w-3.5 h-3.5 mr-1.5" /> Se lo llevó el camillero
          </Button>
        ) : null;
      case 'EN_TRASLADO':
        return can(currentUser, 'cirugia_operar') ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onEnCirugia(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-cyan-600 hover:bg-cyan-700 text-white">
            <Activity className="w-3.5 h-3.5 mr-1.5" /> En cirugía
          </Button>
        ) : null;
      case 'EN_CIRUGIA':
        // "En devolución": el paciente vuelve. YA NO se elige destino — Admisión lo mueve en PROGAL
        // y el cron detecta la cama. Acción directa (sin modal).
        return can(currentUser, 'cirugia_devolver') ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onEnDevolucion(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-violet-600 hover:bg-violet-700 text-white">
            <BedDouble className="w-3.5 h-3.5 mr-1.5" /> En devolución
          </Button>
        ) : null;
      case 'EN_DEVOLUCION':
        // La recepción la confirma ENFERMERÍA del piso destino (desde el Mapa de Camas). También
        // acá para un rol que gestione todo.
        return can(currentUser, 'cirugia_recibir') ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onRecibida(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-emerald-600 hover:bg-emerald-700 text-white">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Recibida
          </Button>
        ) : null;
      case 'RECIBIDA':
        // Evaluación de tolerancia: la hace quien recibió; CIERRA el ticket. Nuevo permiso.
        return can(currentUser, 'cirugia_tolerancia') && onTolerancia ? (
          <Button size="sm" disabled={p} onClick={() => withPending(c.id, () => onTolerancia(c.id))}
            className="h-8 text-[10px] uppercase font-bold tracking-tight bg-green-600 hover:bg-green-700 text-white">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Evaluación de tolerancia
          </Button>
        ) : null;
      default:
        return null;
    }
  };

  const renderRow = (c: CirugiaTraslado) => {
    const p = isPending(c.id);
    const camaChange = !!c.camaDestino && c.camaDestino !== c.camaOrigen;
    return (
      <Card key={c.id} className="p-3.5 border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Info del paciente (ocupa el ancho disponible) */}
          <div className="min-w-0 flex-1 space-y-1">
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
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                <Clock className="w-3 h-3" /> {formatDateTime(c.updatedAt || c.createdAt)}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-[10px] font-bold text-violet-700" title="Tiempo en el estado actual · total desde el inicio">
                hace {timeAgo(c.updatedAt || c.createdAt, now)}
                <span className="text-slate-400 font-medium"> · total {timeAgo(c.createdAt, now)}</span>
              </span>
            </div>
            {rowError[c.id] && (
              <p className="text-[10px] font-bold text-red-600">{rowError[c.id]}</p>
            )}
          </div>

          {/* Acciones (pinneadas a la derecha en desktop) */}
          <div className="flex items-center gap-1.5 flex-wrap md:justify-end md:shrink-0">
            {renderCirugiaActions(c)}
            {c.estado !== 'RECIBIDA' && can(currentUser, 'cirugia_cancelar') && (
              <Button size="sm" variant="outline" disabled={p}
                onClick={() => setCancelando({ id: c.id, motivo: '' })}
                className="h-8 text-[10px] uppercase font-bold tracking-tight border-red-200 text-red-600 hover:bg-red-50">
                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancelar
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  };

  // Fila de la tabla DESKTOP — una sola grilla con columna Estado (concordancia con los otros módulos).
  const renderTableRow = (c: CirugiaTraslado) => {
    const p = isPending(c.id);
    const camaChange = !!c.camaDestino && c.camaDestino !== c.camaOrigen;
    return (
      <tr key={c.id} className="align-middle hover:bg-slate-50/60">
        {/* Estado (columna a la izquierda de todo) */}
        <td className="px-4 py-3"><Pill estado={c.estado} short /></td>
        {/* Paciente + área/hora */}
        <td className="px-4 py-3">
          <p className="font-black text-slate-800 leading-tight break-words uppercase">{c.pacienteNombre || 'Paciente s/nombre'}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 flex-wrap">
            <span>{areaLabel(c.area)}</span>
            <span className="text-slate-300">·</span>
            <Clock className="w-3 h-3 text-slate-400" /> {formatDateTime(c.updatedAt || c.createdAt)}
            <span className="text-slate-300">·</span>
            <span className="font-bold text-violet-700" title="Tiempo en el estado actual · total desde el inicio">
              hace {timeAgo(c.updatedAt || c.createdAt, now)}<span className="text-slate-400 font-medium"> · total {timeAgo(c.createdAt, now)}</span>
            </span>
          </p>
        </td>
        {/* Cama (origen → destino si cambió) */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700 flex-wrap">
            <span>{formatBedName(c.camaOrigen)}</span>
            {camaChange && (<>
              <ArrowRight className="w-3 h-3 text-violet-500 shrink-0" />
              <span className="text-violet-700">{formatBedName(c.camaDestino!)}</span>
            </>)}
          </div>
          {camaChange && (
            <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[9px] font-black uppercase">
              <AlertTriangle className="w-2.5 h-2.5" /> cambió (era {formatBedName(c.camaOrigen)})
            </span>
          )}
        </td>
        {/* Tipo internación */}
        <td className="px-4 py-3">
          {c.tipo
            ? <span className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200">{c.tipo}</span>
            : <span className="text-slate-300">—</span>}
        </td>
        {/* Acciones */}
        <td className="px-4 py-3">
          {rowError[c.id] && <p className="text-[10px] font-bold text-red-600 mb-1">{rowError[c.id]}</p>}
          <div className="flex items-center gap-1.5 flex-wrap">
            {renderCirugiaActions(c)}
            {c.estado !== 'RECIBIDA' && can(currentUser, 'cirugia_cancelar') && (
              <Button size="sm" variant="outline" disabled={p}
                onClick={() => setCancelando({ id: c.id, motivo: '' })}
                className="h-8 text-[10px] uppercase font-bold tracking-tight border-red-200 text-red-600 hover:bg-red-50">
                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancelar
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // Cirugía seleccionada por el modal de cancelación (lookup por id): una instancia a nivel vista.
  const cancelCx = cancelando ? cirugias.find(c => c.id === cancelando.id) ?? null : null;

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
          {/* Mobile — tarjetas (una sola lista, ordenada por el flujo) */}
          <div className="space-y-3 md:hidden">
            {ordenadas.map(renderRow)}
          </div>

          {/* Desktop — una sola tabla con columna Estado (concordancia con Traslados/Limpiezas/Comandas) */}
          <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[17%]" /><col className="w-[22%]" /><col className="w-[21%]" />
                <col className="w-[11%]" /><col className="w-[29%]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Paciente</th>
                  <th className="px-4 py-3">Cama</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ordenadas.map(renderTableRow)}
              </tbody>
            </table>
          </Card>
        </>
      )}


      {/* Modal: cancelar con motivo obligatorio. */}
      <Dialog open={!!cancelando} onOpenChange={o => { if (!o) setCancelando(null); }}>
        <DialogContent className="sm:max-w-[440px] rounded-3xl">
          <DialogHeader><DialogTitle className="text-xl">Cancelar cirugía</DialogTitle></DialogHeader>
          {cancelCx && (
            <div className="grid gap-3 py-2">
              <p className="text-sm text-slate-500">
                Vas a cancelar la operatoria de <span className="font-bold text-slate-700 uppercase">{cancelCx.pacienteNombre || 'el paciente'}</span>. Contanos por qué.
              </p>
              <textarea
                autoFocus rows={3} maxLength={500}
                value={cancelando?.motivo ?? ''}
                onChange={e => setCancelando(s => (s ? { ...s, motivo: e.target.value } : s))}
                placeholder="Ej: se suspendió la cirugía, alta del paciente…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-200" />
              {rowError[cancelCx.id] && <p className="text-[11px] font-bold text-red-600">{rowError[cancelCx.id]}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)} className="rounded-xl h-11">Volver</Button>
            <Button
              disabled={!cancelCx || isPending(cancelCx.id) || !cancelando?.motivo.trim()}
              onClick={async () => {
                if (!cancelCx || !cancelando?.motivo.trim()) return;
                const r = await withPending(cancelCx.id, () => onCancelar(cancelCx.id, cancelando.motivo.trim()));
                if (r.ok) setCancelando(null);
              }}
              className="bg-red-600 hover:bg-red-700 text-white rounded-xl h-11 px-6 disabled:opacity-40">
              Confirmar cancelación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
