import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Bed, User, Area } from '../types';
import { can } from '../lib/permissions';
import { cn, formatBedName, formatDateReadable, normalizeText } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { CheckCircle2, DoorClosed, User as UserIcon, Clock, RefreshCw, Calendar as CalendarIcon, Search, X } from 'lucide-react';

// ponytail: display map copiado de BedsView (no está exportado); exportar si un 3er lugar lo necesita.
const AREA_LABELS: Record<string, string> = {
  [Area.PISO_4]: 'Piso 4', [Area.PISO_5]: 'Piso 5', [Area.PISO_6]: 'Piso 6',
  [Area.PISO_7]: 'Piso 7', [Area.PISO_8]: 'Piso 8',
  [Area.HIT]: 'ITR', [Area.HRA]: 'Sala Espera', [Area.HSS]: 'Sueño',
  [Area.HUC]: 'UCO', [Area.HUQ]: 'URP', [Area.HUT]: 'UTI',
};
const areaLabel = (a?: string) => (a ? AREA_LABELS[a] ?? a : '—');

const fmtWhen = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
};

// Trigger del datepicker (mismo estilo que HistoryView). asChild → forwardRef.
const DateRangeTrigger = React.forwardRef<
  HTMLButtonElement,
  { label: string; value: string } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ label, value, className, ...props }, ref) => (
  <button ref={ref} type="button"
    className={cn("w-full h-full px-4 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors outline-none", className)}
    {...props}>
    <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
    <div className="flex flex-col justify-center pointer-events-none">
      <span className="text-[7px] uppercase font-bold text-slate-400 leading-none mb-0.5">{label}</span>
      <span className="text-xs font-bold leading-none text-slate-900">{value ? formatDateReadable(value) : '---'}</span>
    </div>
  </button>
));
DateRangeTrigger.displayName = 'DateRangeTrigger';

interface Props {
  beds: Bed[];
  currentUser: User | null;
  onConsolidate: (bedLabel: string) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
}

export const CleaningManagementView: React.FC<Props> = ({ beds, currentUser, onConsolidate, onRefresh }) => {
  // Limpiezas activas = camas con overlay `cleaned` vigente (mergeBeds). Respeta el filtro
  // por áreas del usuario (misma regla que el botón "Marcar limpia" de BedsView).
  const rows = useMemo(() => {
    const areaOk = (area: string) =>
      !currentUser?.filterByFloors
      || !currentUser?.assignedAreas?.length
      || currentUser.assignedAreas.includes(area as Area);
    return beds
      .filter(b => b.cleaned && areaOk(b.area))
      .sort((a, b) => String(b.cleanedAt ?? '').localeCompare(String(a.cleanedAt ?? '')));
  }, [beds, currentUser]);

  // Consolidar pide confirmación (Dialog). Optimista: al confirmar, la fila desaparece sola
  // (useHospitalState quita la limpieza del estado y mergeBeds recomputa). `pending` deshabilita
  // el botón mientras el PATCH viaja; `confirmBed` guarda la cama en revisión.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [confirmBed, setConfirmBed] = useState<Bed | null>(null);
  // Solo los roles con el permiso pueden consolidar; el resto ve la lista en solo-lectura.
  const canConsolidate = can(currentUser, 'consolidar_limpieza');
  const consolidate = (label: string) => {
    setPending(p => new Set(p).add(label));
    setConfirmBed(null);
    Promise.resolve(onConsolidate(label)).finally(() =>
      setPending(p => { const n = new Set(p); n.delete(label); return n; }));
  };

  // ── Histórico (limpiezas cerradas) ─────────────────────────────────────────
  type HistRow = { spItemId: string; bedLabel: string; area: string; by: string; at: string; closedAt: string; reason: string };
  const [tab, setTab] = useState<'activas' | 'historico'>('activas');
  const todayStr   = new Date().toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgoStr);
  const [to, setTo]     = useState(todayStr);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [openFrom, setOpenFrom] = useState(false);
  const [openTo, setOpenTo]     = useState(false);

  const authFetch = useCallback((url: string) => {
    const token = localStorage.getItem('mediflow_token');
    return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoadingHist(true);
    try {
      const r = await authFetch(`/api/limpiezas?history=1&from=${from}&to=${to}`);
      if (r.ok) {
        const data = await r.json();
        const areaOk = (area: string) =>
          !currentUser?.filterByFloors || !currentUser?.assignedAreas?.length || currentUser.assignedAreas.includes(area as Area);
        const rows: HistRow[] = (data.cleanings ?? [])
          .filter((c: HistRow) => areaOk(c.area))
          .sort((a: HistRow, b: HistRow) => String(b.closedAt).localeCompare(String(a.closedAt)));
        setHistory(rows);
      }
    } catch { /* mantiene lo previo */ }
    finally { setLoadingHist(false); }
  }, [authFetch, from, to, currentUser]);

  // Auto-carga al entrar al histórico y al cambiar las fechas.
  useEffect(() => { if (tab === 'historico') fetchHistory(); }, [tab, fetchHistory]);

  // GAMMA y TICKET se muestran agrupados como "Traslado" (pedido del negocio); los otros igual.
  const REASON_LABEL: Record<string, string> = { GAMMA: 'Traslado', TICKET: 'Traslado', ANULADA: 'Anulada', CONSOLIDADO: 'Consolidado' };
  const reasonLabel = (r: string) => REASON_LABEL[r] ?? (r || '—');
  const reasonClass = (r: string) =>
    r === 'CONSOLIDADO' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : r === 'ANULADA'   ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-sky-50 text-sky-700 border-sky-200'; // GAMMA/TICKET = Traslado

  // ── Buscador (aplica a las dos tabs) ───────────────────────────────────────
  // Mismo criterio que el buscador de comandas: se indexa cada fila una vez y la búsqueda
  // es frase-exacta primero, AND de términos como fallback. Sin el paso de frase, "piso 5"
  // se parte en ["piso","5"] y trae camas del Piso 4 (el "5" matchea el 405 del label).
  //
  // Se indexan también las formas SIN espacios del sector y de la cama para poder tipear
  // "piso5" o "401-02" de corrido.
  const [searchFilter, setSearchFilter] = useState('');
  const query = normalizeText(searchFilter);
  const terms = query.split(' ').filter(Boolean);
  const buscando = terms.length > 0;

  const bedHaystack = (label: string, area: string, ...extra: (string | undefined)[]) => normalizeText([
    label, formatBedName(label), formatBedName(label).replace(/[\s-]/g, ''),
    area, areaLabel(area), areaLabel(area).replace(/\s+/g, ''),
    ...extra,
  ].join(' '));

  const indexedRows = useMemo(
    () => rows.map(b => ({ r: b, h: bedHaystack(b.label, b.area, b.cleanedBy) })),
    [rows]);
  const indexedHistory = useMemo(
    () => history.map(h => ({ r: h, h: bedHaystack(h.bedLabel, h.area, h.by, reasonLabel(h.reason)) })),
    [history]); // eslint-disable-line react-hooks/exhaustive-deps

  function applySearch<T>(indexed: { r: T; h: string }[]): T[] {
    if (!buscando) return indexed.map(({ r }) => r);
    const porFrase = indexed.filter(({ h }) => h.includes(query));
    if (porFrase.length > 0) return porFrase.map(({ r }) => r);
    return indexed.filter(({ h }) => terms.every(t => h.includes(t))).map(({ r }) => r);
  }

  const visibleRows    = applySearch(indexedRows);
  const visibleHistory = applySearch(indexedHistory);

  // Input reutilizado por las dos tabs — el placeholder cambia porque el histórico tiene
  // motivo y las activas no.
  const searchBox = (placeholder: string) => (
    <div className="relative flex-1 min-w-[180px] max-w-sm">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
      <Input
        placeholder={placeholder}
        value={searchFilter}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchFilter(e.target.value)}
        className="pl-9 pr-8 h-9 text-xs rounded-xl border-slate-200"
      />
      {searchFilter && (
        <button onClick={() => setSearchFilter('')} title="Limpiar búsqueda"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-full w-full space-y-4 md:space-y-5 pb-24 md:pb-8">
      {/* Tabs: Activas (overlay vigente) | Histórico (cerradas por rango de fecha). */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
        {(['activas', 'historico'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-xs font-bold uppercase tracking-wide border-b-2 -mb-px transition-colors",
              tab === t ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-400 hover:text-slate-600"
            )}>
            {t === 'activas' ? 'Activas' : 'Histórico'}
          </button>
        ))}
      </div>

      {tab === 'historico' ? (
        <>
          {/* Filtros de fecha (cierre) — datepickers shadcn (Popover + Calendar) */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {searchBox('Cama, sector, quién limpió, motivo...')}
            <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden h-9">
              <Popover open={openFrom} onOpenChange={setOpenFrom}>
                <PopoverTrigger asChild>
                  <DateRangeTrigger label="Desde" value={from} className="h-full text-xs" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
                  <Calendar selected={from} onSelect={(date) => { setFrom(date); setOpenFrom(false); }} />
                </PopoverContent>
              </Popover>
              <div className="w-px h-5 bg-slate-100 shrink-0" />
              <Popover open={openTo} onOpenChange={setOpenTo}>
                <PopoverTrigger asChild>
                  <DateRangeTrigger label="Hasta" value={to} className="h-full text-xs" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
                  <Calendar selected={to} onSelect={(date) => { setTo(date); setOpenTo(false); }} />
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchHistory()} disabled={loadingHist}
              className="h-9 px-3 rounded-lg gap-2 text-xs font-bold text-slate-600">
              <RefreshCw className={cn("w-4 h-4", loadingHist && "animate-spin")} /> Actualizar
            </Button>
            <p className="text-xs text-slate-500 font-medium ml-auto self-center">
              {visibleHistory.length} {visibleHistory.length === 1 ? 'limpieza' : 'limpiezas'}
              {buscando && history.length !== visibleHistory.length && ` de ${history.length}`}
            </p>
          </div>

          {loadingHist ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 text-sm">Cargando…</div>
          ) : visibleHistory.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">
              <Clock className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              {/* Distinguir "no hay nada en el rango" de "la búsqueda no matcheó": si no,
                  el usuario mueve las fechas sin darse cuenta de que el filtro es el texto. */}
              <p className="font-bold text-sm text-slate-500">
                {buscando ? 'Sin resultados para la búsqueda' : 'Sin limpiezas en el rango'}
              </p>
              <p className="text-xs">{buscando ? 'Probá con otro texto o limpiá el buscador.' : 'Ajustá las fechas para ver el histórico.'}</p>
            </div>
          ) : (
            <>
              {/* Mobile — tarjetas */}
              <div className="grid grid-cols-1 gap-3 md:hidden">
                {visibleHistory.map(h => (
                  <div key={h.spItemId} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-black text-sm text-slate-800 leading-tight">{h.bedLabel}</p>
                      <span className={cn("text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border shrink-0", reasonClass(h.reason))}>{reasonLabel(h.reason)}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium">{areaLabel(h.area)}</p>
                    <div className="text-[11px] text-slate-600 space-y-1">
                      <p className="flex items-center gap-1.5"><UserIcon className="w-3.5 h-3.5 text-slate-400" />{h.by || '—'}</p>
                      <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />Limpia: {fmtWhen(h.at)}</p>
                      <p className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-slate-400" />Cerrada: {fmtWhen(h.closedAt)}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop — grilla */}
              <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                        <th className="px-4 py-3">Cama</th>
                        <th className="px-4 py-3">Sector</th>
                        <th className="px-4 py-3">Marcada por</th>
                        <th className="px-4 py-3">Limpia</th>
                        <th className="px-4 py-3">Cerrada</th>
                        <th className="px-4 py-3">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleHistory.map(h => (
                        <tr key={h.spItemId} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3 font-bold text-slate-800">{h.bedLabel}</td>
                          <td className="px-4 py-3 text-slate-600">{areaLabel(h.area)}</td>
                          <td className="px-4 py-3 text-slate-600">{h.by || '—'}</td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtWhen(h.at)}</td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtWhen(h.closedAt)}</td>
                          <td className="px-4 py-3">
                            <span className={cn("text-[10px] font-bold uppercase px-2.5 py-1 rounded-lg border", reasonClass(h.reason))}>{reasonLabel(h.reason)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      ) : (
        <>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-xs text-slate-500 font-medium">
          {rows.length} {rows.length === 1 ? 'cama marcada limpia' : 'camas marcadas limpias'} · pendientes de consolidar
        </p>
        {onRefresh && (
          <Button variant="outline" size="sm" onClick={() => onRefresh()}
            className="h-9 px-3 rounded-lg gap-2 text-xs font-bold text-slate-600">
            <RefreshCw className="w-4 h-4" /> Actualizar
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="font-bold text-sm text-slate-500">No hay limpiezas activas</p>
          <p className="text-xs">Las camas marcadas limpias por las azafatas aparecen acá hasta consolidarse.</p>
        </div>
      ) : (
        <>
          {/* Mobile — tarjetas */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {visibleRows.map(bed => (
              <div key={bed.label} className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-black text-sm text-slate-800 leading-tight">{bed.label}</p>
                    <p className="text-[11px] text-slate-500 font-medium">{areaLabel(bed.area)}</p>
                  </div>
                </div>
                <div className="text-[11px] text-slate-600 space-y-1">
                  <p className="flex items-center gap-1.5"><UserIcon className="w-3.5 h-3.5 text-slate-400" />{bed.cleanedBy || '—'}</p>
                  <p className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-slate-400" />{fmtWhen(bed.cleanedAt)}</p>
                </div>
                {canConsolidate && (
                  <Button onClick={() => setConfirmBed(bed)} disabled={pending.has(bed.label)}
                    className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-widest gap-2">
                    <DoorClosed className="w-4 h-4" /> Consolidado PROGAL
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Desktop — grilla */}
          <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                    <th className="px-4 py-3">Cama</th>
                    <th className="px-4 py-3">Sector</th>
                    <th className="px-4 py-3">Marcada por</th>
                    <th className="px-4 py-3">Cuándo</th>
                    <th className="px-4 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map(bed => (
                    <tr key={bed.label} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-bold text-slate-800 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> {bed.label}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{areaLabel(bed.area)}</td>
                      <td className="px-4 py-3 text-slate-600">{bed.cleanedBy || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtWhen(bed.cleanedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {canConsolidate ? (
                          <Button onClick={() => setConfirmBed(bed)} disabled={pending.has(bed.label)} size="sm"
                            className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-2">
                            <DoorClosed className="w-4 h-4" /> Consolidado PROGAL
                          </Button>
                        ) : (
                          <span className="text-[11px] font-medium text-slate-400">Sin permiso</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
        </>
      )}

      {/* Confirmación de consolidado */}
      <Dialog open={!!confirmBed} onOpenChange={() => setConfirmBed(null)}>
        <DialogContent className="sm:max-w-[420px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <DoorClosed className="w-5 h-5 text-emerald-600" /> Consolidar contra PROGAL
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Se cerrará el ticket de limpieza de <strong>{confirmBed?.label}</strong> y la cama
            volverá a reflejar el estado real de <strong>PROGAL</strong>. Esta acción quita el overlay
            "Limpia" del mapa.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmBed(null)} className="rounded-xl h-10">Cancelar</Button>
            <Button onClick={() => confirmBed && consolidate(confirmBed.label)}
              className="rounded-xl h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2">
              <DoorClosed className="w-4 h-4" /> Consolidar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
