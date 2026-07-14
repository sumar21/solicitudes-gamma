import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Bed, User, Area } from '../types';
import { cn, formatBedName, formatDateReadable } from '../lib/utils';
import { comandaTipoPill } from './BedsView';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { Utensils, User as UserIcon, Clock, RefreshCw, Calendar as CalendarIcon, FileDown } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// display map (copiado de BedsView, igual que CleaningManagementView).
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

const comidaPill = (c: string) =>
  c.toUpperCase().startsWith('ALM') || c === 'Almuerzo'
    ? { label: 'Almuerzo', cls: 'bg-sky-50 text-sky-700 border-sky-200' }
    : { label: 'Cena', cls: 'bg-violet-50 text-violet-700 border-violet-200' };

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

// Una comanda cargada (activa o histórica). En "Activas" sale de bed.meals; en "Histórico"
// del endpoint /api/dietas?history=1.
type ComandaRow = {
  key: string; patientName: string; bedLabel: string; area: string;
  comida: string; tipo: string; detalle: string; observaciones: string; by: string; at: string;
};

interface Props {
  beds: Bed[];
  currentUser: User | null;
  onRefresh?: () => void | Promise<void>;
}

export const ComandasManagementView: React.FC<Props> = ({ beds, currentUser, onRefresh }) => {
  const areaOk = useCallback((area: string) =>
    !currentUser?.filterByFloors
    || !currentUser?.assignedAreas?.length
    || currentUser.assignedAreas.includes(area as Area), [currentUser]);

  // ── Activas (hoy) — una fila por residente + comida (bed.meals del mapa). ─────
  const rows = useMemo<ComandaRow[]>(() => {
    const out: ComandaRow[] = [];
    for (const b of beds) {
      if (!b.meals || !areaOk(b.area)) continue;
      for (const slot of ['almuerzo', 'cena'] as const) {
        const m = b.meals[slot];
        if (!m) continue;
        out.push({
          key: `${b.label}-${slot}`,
          patientName: b.patientName || '—',
          bedLabel: b.label, area: b.area,
          comida: slot === 'almuerzo' ? 'Almuerzo' : 'Cena',
          tipo: m.tipo, detalle: m.detalle ?? '', observaciones: m.observaciones ?? '',
          by: m.by ?? '', at: m.at ?? '',
        });
      }
    }
    return out.sort((a, b) =>
      a.patientName.localeCompare(b.patientName, 'es') || a.comida.localeCompare(b.comida));
  }, [beds, areaOk]);

  // ── Histórico (por fecha de carga) ──────────────────────────────────────────
  const [tab, setTab] = useState<'activas' | 'historico'>('activas');
  // Día ART (mismo criterio que el server filtra FechaCarga), evita off-by-one de UTC de noche.
  const artDayStr = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const todayStr   = artDayStr(Date.now());
  const weekAgoStr = artDayStr(Date.now() - 7 * 864e5);
  const [from, setFrom] = useState(weekAgoStr);
  const [to, setTo]     = useState(todayStr);
  const [history, setHistory] = useState<ComandaRow[]>([]);
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
      const r = await authFetch(`/api/dietas?history=1&from=${from}&to=${to}`);
      if (r.ok) {
        const data = await r.json();
        const rows: ComandaRow[] = (data.meals ?? [])
          .filter((m: any) => areaOk(String(m.area ?? '')))
          .map((m: any) => ({
            key: String(m.spItemId),
            patientName: String(m.patientName || '—'),
            bedLabel: String(m.bedLabel ?? ''), area: String(m.area ?? ''),
            comida: String(m.comida ?? ''), tipo: String(m.tipo ?? ''),
            detalle: String(m.detalle ?? ''), observaciones: String(m.observaciones ?? ''),
            by: String(m.by ?? ''), at: String(m.at ?? ''),
          }))
          .sort((a: ComandaRow, b: ComandaRow) => String(b.at).localeCompare(String(a.at)));
        setHistory(rows);
      }
    } catch { /* mantiene lo previo */ }
    finally { setLoadingHist(false); }
  }, [authFetch, from, to, areaOk]);

  useEffect(() => { if (tab === 'historico') fetchHistory(); }, [tab, fetchHistory]);

  const data = tab === 'activas' ? rows : history;

  // Descarga la tabla actual (De hoy / Histórico) a PDF con jspdf-autotable.
  const handlePdf = () => {
    const showDate = tab === 'historico';
    const doc = new jsPDF({ orientation: 'landscape' });
    const title = tab === 'activas' ? 'Comandas — De hoy' : `Comandas — ${formatDateReadable(from)} a ${formatDateReadable(to)}`;
    doc.setFontSize(14); doc.setTextColor(2, 44, 34); doc.text(title, 14, 15); // verde Gamma #022C22
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`${data.length} comanda(s) · generado ${new Date().toLocaleString('es-AR')}`, 14, 21);
    doc.setTextColor(0);
    const head = [['Paciente', 'Cama', 'Sector', 'Comida', 'Tipo', 'Detalle comanda', 'Observaciones', 'Cargó', ...(showDate ? ['Cuándo'] : [])]];
    const body = data.map(r => [
      r.patientName, formatBedName(r.bedLabel), areaLabel(r.area), r.comida,
      comandaTipoPill(r.tipo).label, r.detalle || '—', r.observaciones || '—', r.by || '—',
      ...(showDate ? [fmtWhen(r.at)] : []),
    ]);
    autoTable(doc, {
      head, body, startY: 26,
      styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [2, 44, 34], textColor: 255, fontStyle: 'bold' }, // verde Gamma #022C22
      alternateRowStyles: { fillColor: [240, 253, 244] },                        // tinte verde suave (emerald-50)
      columnStyles: { 5: { cellWidth: 45 }, 6: { cellWidth: 45 } },
    });
    const fname = tab === 'activas'
      ? `Comandas HPR - ${todayStr}.pdf`
      : `Comandas HPR - ${from} al ${to}.pdf`;
    doc.save(fname);
  };

  // Fila de tabla (desktop) reutilizada por Activas e Histórico.
  const Row: React.FC<{ r: ComandaRow; showDate?: boolean }> = ({ r, showDate }) => {
    const tp = comandaTipoPill(r.tipo);
    const cp = comidaPill(r.comida);
    return (
      <tr className="hover:bg-slate-50/60 align-top">
        <td className="px-4 py-3 font-bold text-slate-800">{r.patientName}</td>
        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatBedName(r.bedLabel)}</td>
        <td className="px-4 py-3 text-slate-500">{areaLabel(r.area)}</td>
        <td className="px-4 py-3"><span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border", cp.cls)}>{cp.label}</span></td>
        <td className="px-4 py-3"><span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full", tp.cls)}>{tp.label}</span></td>
        <td className="px-4 py-3 text-slate-800 font-medium max-w-[220px] break-words">{r.detalle || <span className="text-slate-300">—</span>}</td>
        <td className="px-4 py-3 text-slate-500 max-w-[220px] break-words">{r.observaciones || <span className="text-slate-300">—</span>}</td>
        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{r.by || '—'}</td>
        {showDate && <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmtWhen(r.at)}</td>}
      </tr>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-full w-full space-y-4 md:space-y-5 pb-24 md:pb-8">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
        {(['activas', 'historico'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-xs font-bold uppercase tracking-wide border-b-2 -mb-px transition-colors",
              tab === t ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-400 hover:text-slate-600"
            )}>
            {t === 'activas' ? 'De hoy' : 'Histórico'}
          </button>
        ))}
      </div>

      {/* Barra de acciones / filtros */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {tab === 'historico' && (
          <>
            <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden h-9">
              <Popover open={openFrom} onOpenChange={setOpenFrom}>
                <PopoverTrigger asChild><DateRangeTrigger label="Desde" value={from} className="h-full text-xs" /></PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
                  <Calendar selected={from} onSelect={(date) => { setFrom(date); setOpenFrom(false); }} />
                </PopoverContent>
              </Popover>
              <div className="w-px h-5 bg-slate-100 shrink-0" />
              <Popover open={openTo} onOpenChange={setOpenTo}>
                <PopoverTrigger asChild><DateRangeTrigger label="Hasta" value={to} className="h-full text-xs" /></PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
                  <Calendar selected={to} onSelect={(date) => { setTo(date); setOpenTo(false); }} />
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchHistory()} disabled={loadingHist}
              className="h-9 px-3 rounded-lg gap-2 text-xs font-bold text-slate-600">
              <RefreshCw className={cn("w-4 h-4", loadingHist && "animate-spin")} /> Actualizar
            </Button>
          </>
        )}
        {tab === 'activas' && onRefresh && (
          <Button variant="outline" size="sm" onClick={() => onRefresh()}
            className="h-9 px-3 rounded-lg gap-2 text-xs font-bold text-slate-600">
            <RefreshCw className="w-4 h-4" /> Actualizar
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handlePdf} disabled={data.length === 0}
          className="h-9 px-3 rounded-lg gap-2 text-xs font-bold text-indigo-700 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50">
          <FileDown className="w-4 h-4" /> PDF
        </Button>
        <p className="text-xs text-slate-500 font-medium ml-auto self-center">
          {data.length} {data.length === 1 ? 'comanda' : 'comandas'}
        </p>
      </div>

      {loadingHist && tab === 'historico' ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 text-sm">Cargando…</div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">
          <Utensils className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="font-bold text-sm text-slate-500">
            {tab === 'activas' ? 'No hay comandas cargadas hoy' : 'Sin comandas en el rango'}
          </p>
          <p className="text-xs">
            {tab === 'activas' ? 'Las comandas que carga Nutrición desde el mapa de camas aparecen acá.' : 'Ajustá las fechas para ver el histórico.'}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile — tarjetas */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {data.map(r => {
              const tp = comandaTipoPill(r.tipo);
              const cp = comidaPill(r.comida);
              return (
                <div key={r.key} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-black text-sm text-slate-800 leading-tight">{r.patientName}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={cn("text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border", cp.cls)}>{cp.label}</span>
                      <span className={cn("text-[9px] font-bold uppercase px-2 py-0.5 rounded-full", tp.cls)}>{tp.label}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium">{formatBedName(r.bedLabel)} · {areaLabel(r.area)}</p>
                  {r.detalle && <p className="text-[12px] font-semibold text-slate-800">{r.detalle}</p>}
                  {r.observaciones && <p className="text-[11px] text-slate-500">Obs: {r.observaciones}</p>}
                  <div className="text-[10px] text-slate-400 flex items-center gap-3 pt-1">
                    <span className="flex items-center gap-1"><UserIcon className="w-3 h-3" />{r.by || '—'}</span>
                    {tab === 'historico' && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{fmtWhen(r.at)}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop — grilla */}
          <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                    <th className="px-4 py-3">Paciente</th>
                    <th className="px-4 py-3">Cama</th>
                    <th className="px-4 py-3">Sector</th>
                    <th className="px-4 py-3">Comida</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Detalle comanda</th>
                    <th className="px-4 py-3">Observaciones</th>
                    <th className="px-4 py-3">Cargó</th>
                    {tab === 'historico' && <th className="px-4 py-3">Cuándo</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map(r => <Row key={r.key} r={r} showDate={tab === 'historico'} />)}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
