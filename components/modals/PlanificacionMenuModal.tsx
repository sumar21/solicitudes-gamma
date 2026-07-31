/**
 * Modal de Planificación de comandas (16.CargaMenu).
 *
 * Grilla de lo planificado + subform de alta/edición en el MISMO modal (no un modal anidado:
 * `dialog.tsx` no soporta stacking y el Escape del de arriba cerraría los dos).
 *
 * Reglas de negocio (ver docs/plan-comandas-planificacion.md):
 *  · Vivas editables, vencidas read-only (P8). El server revalida y devuelve 409 — el disabled
 *    de acá es UX, no seguridad: la grilla puede estar stale y mostrar editable algo que venció.
 *  · Sin solapamiento por (turno, tipo) → el server devuelve 409 y se muestra inline.
 *  · Tipo planificable = MENU | OPCION. 'OTROS' no se planifica (D5).
 *
 * Fechas: 'YYYY-MM-DD' de punta a punta. El Calendar del repo emite ese formato armado por
 * partes (`calendar.tsx:48`), así que NUNCA hay que pasarlas por `new Date()` — ver D2.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CargaMenu, MealSlot, TipoPlan, MEAL_SLOTS, TIPOS_PLAN,
  mealSlotFromSp, mealSlotLabel, tipoPlanLabel, COMANDA_MAX_LEN, User,
} from '../../types';
import { can } from '../../lib/permissions';
import { cn, formatDateReadable } from '../../lib/utils';
import { APP_VERSION } from '../../lib/version';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { Button } from '../ui/button';
import { Plus, Pencil, Trash2, CalendarDays, AlertCircle, Loader2, X, Check } from 'lucide-react';

// Mismo criterio cromático que el pill de turno del monitor de comandas.
const TURNO_CLS: Record<MealSlot, string> = {
  desayuno: 'bg-orange-50 text-orange-700 border-orange-200',
  almuerzo: 'bg-sky-50 text-sky-700 border-sky-200',
  merienda: 'bg-rose-50 text-rose-700 border-rose-200',
  cena:     'bg-violet-50 text-violet-700 border-violet-200',
};
const TIPO_CLS: Record<TipoPlan, string> = {
  MENU:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  OPCION: 'bg-amber-50 text-amber-700 border-amber-200',
};

/** 'YYYY-MM-DD' → 'dd/mm'. Por partes, nunca con `new Date` (ver D2). */
const ddmm = (day: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}/${m[2]}` : day;
};

/** "Hoy" en hora Argentina como 'YYYY-MM-DD'. Espeja `artToday()` del endpoint. */
const artToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

type Draft = {
  spItemId?: string;
  turno: MealSlot | '';
  tipo: TipoPlan | '';
  desde: string;
  hasta: string;
  comanda: string;
};

const EMPTY_DRAFT: Draft = { turno: '', tipo: '', desde: '', hasta: '', comanda: '' };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: User | null;
}

export const PlanificacionMenuModal: React.FC<Props> = ({ open, onOpenChange, currentUser }) => {
  const canEdit = can(currentUser, 'abm_planificacion');

  const [plans, setPlans]     = useState<CargaMenu[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [draft, setDraft]     = useState<Draft | null>(null);   // null = grilla; !null = subform
  const [saving, setSaving]   = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  const [openDesde, setOpenDesde] = useState(false);
  const [openHasta, setOpenHasta] = useState(false);

  const authFetch = useCallback((url: string, init?: RequestInit) => {
    const token = localStorage.getItem('mediflow_token');
    return fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
    });
  }, []);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const r = await authFetch('/api/carga-menu');
      if (!r.ok) {
        const d = await r.json().catch(() => ({} as any));
        // Falla dura y visible: un vacío mentiroso haría creer que no hay nada planificado.
        setListError(d?.error ?? `No se pudo cargar la planificación (HTTP ${r.status}).`);
        return;
      }
      const d = await r.json();
      const rows: CargaMenu[] = (d.plans ?? [])
        .map((p: any) => ({ ...p, turno: mealSlotFromSp(p.turno) }))
        .filter((p: any) => p.turno);   // turno desconocido = fila corrupta, no se muestra
      setPlans(rows);
    } catch (e: any) {
      setListError(`Error de red: ${e?.message ?? 'sin conexión'}`);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  // Al abrir: traer datos y resetear el estado del form (patrón de modal del repo).
  useEffect(() => {
    if (!open) {
      setDraft(null); setFormError(null); setConfirmDelete(null); setShowExpired(false);
      return;
    }
    fetchPlans();
  }, [open, fetchPlans]);

  const today = artToday();
  const isExpired = (p: CargaMenu) => p.hasta < today;

  // Vigentes + futuras primero; las vencidas solo si el usuario las pide (P8): con el tiempo
  // se acumulan y volverían la grilla inusable.
  const { live, expired } = useMemo(() => {
    const sorted = [...plans].sort((a, b) =>
      MEAL_SLOTS.findIndex(s => s.slot === a.turno) - MEAL_SLOTS.findIndex(s => s.slot === b.turno) ||
      a.desde.localeCompare(b.desde));
    return { live: sorted.filter(p => !isExpired(p)), expired: sorted.filter(isExpired) };
  }, [plans, today]);

  const visible = showExpired ? [...live, ...expired] : live;

  // ── Validación client-side (espeja la del endpoint) ───────────────────────
  const validate = (d: Draft): string | null => {
    if (!d.turno) return 'Elegí un turno.';
    if (!d.tipo) return 'Elegí un tipo.';
    if (!d.desde) return 'Elegí la fecha desde.';
    if (!d.hasta) return 'Elegí la fecha hasta.';
    if (d.hasta < d.desde) return 'La fecha hasta no puede ser anterior a la fecha desde.';
    if (!d.comanda.trim()) return 'Escribí la comanda.';
    // No es cosmético: SP rechaza >255 con un 400 opaco que no dice qué campo fue.
    if (d.comanda.trim().length > COMANDA_MAX_LEN) return `La comanda no puede superar los ${COMANDA_MAX_LEN} caracteres (tiene ${d.comanda.trim().length}).`;
    return null;
  };

  const handleSave = async () => {
    if (!draft) return;
    const err = validate(draft);
    if (err) { setFormError(err); return; }

    setSaving(true);
    setFormError(null);
    const slot = MEAL_SLOTS.find(s => s.slot === draft.turno);
    const payload = {
      spItemId: draft.spItemId,
      turno: slot?.sp, tipo: draft.tipo,
      desde: draft.desde, hasta: draft.hasta,
      comanda: draft.comanda.trim(),
      version: APP_VERSION,
    };
    try {
      const r = await authFetch('/api/carga-menu', {
        method: draft.spItemId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) {
        // 409 = solapamiento o vencida. El mensaje del server ya es human-readable.
        setFormError(d?.message ?? d?.error ?? `No se pudo guardar (HTTP ${r.status}).`);
        return;
      }
      setDraft(null);
      await fetchPlans();
    } catch (e: any) {
      setFormError(`Error de red: ${e?.message ?? 'sin conexión'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (spItemId: string) => {
    setSaving(true);
    try {
      const r = await authFetch('/api/carga-menu', { method: 'DELETE', body: JSON.stringify({ spItemId }) });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) { setListError(d?.message ?? d?.error ?? 'No se pudo eliminar.'); return; }
      setConfirmDelete(null);
      await fetchPlans();
    } catch (e: any) {
      setListError(`Error de red: ${e?.message ?? 'sin conexión'}`);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p: CargaMenu) => {
    setFormError(null);
    setDraft({ spItemId: p.spItemId, turno: p.turno, tipo: p.tipo, desde: p.desde, hasta: p.hasta, comanda: p.comanda });
  };

  // ── Subform de alta/edición ───────────────────────────────────────────────
  const renderForm = (d: Draft) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => { setDraft(null); setFormError(null); }}
          className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1">
          <X className="w-3.5 h-3.5" /> Cancelar
        </button>
        <span className="text-sm font-black text-slate-900">
          {d.spItemId ? 'Editar planificación' : 'Nueva planificación'}
        </span>
      </div>

      {/* Todo en una fila. Turno/Tipo con el Select de shadcn (`ui/select.tsx`, sobre Radix):
          su contenido va en un Portal, así que el `overflow: clip` del DialogContent
          (`ui/dialog.tsx:88`) no lo recorta. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Turno</label>
          {/* Radix reserva value="" para "sin valor" → el placeholder va en SelectValue, no como item. */}
          <Select value={d.turno || undefined} onValueChange={v => setDraft({ ...d, turno: v as MealSlot })}>
            <SelectTrigger className="mt-1.5 h-10 rounded-lg text-xs font-bold">
              <SelectValue placeholder="Elegir…" />
            </SelectTrigger>
            <SelectContent>
              {MEAL_SLOTS.map(({ slot, label }) => (
                <SelectItem key={slot} value={slot} className="text-xs font-bold">{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Tipo</label>
          <Select value={d.tipo || undefined} onValueChange={v => setDraft({ ...d, tipo: v as TipoPlan })}>
            <SelectTrigger className="mt-1.5 h-10 rounded-lg text-xs font-bold">
              <SelectValue placeholder="Elegir…" />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_PLAN.map(({ tipo, label }) => (
                <SelectItem key={tipo} value={tipo} className="text-xs font-bold">{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {([['Desde', 'desde', openDesde, setOpenDesde], ['Hasta', 'hasta', openHasta, setOpenHasta]] as const).map(
          ([label, key, isOpen, setOpen]) => (
            <div key={key}>
              <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">{label}</label>
              <Popover open={isOpen} onOpenChange={setOpen as any}>
                <PopoverTrigger asChild>
                  <button type="button"
                    className="mt-1.5 w-full h-10 px-2.5 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-left hover:bg-slate-50">
                    <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className={cn('text-xs font-bold truncate', d[key] ? 'text-slate-900' : 'text-slate-300')}>
                      {d[key] ? formatDateReadable(d[key]) : 'Elegir'}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-4 bg-white shadow-2xl z-50">
                  <Calendar selected={d[key]} onSelect={(date) => { setDraft({ ...d, [key]: date }); (setOpen as any)(false); }} />
                </PopoverContent>
              </Popover>
            </div>
          ))}
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Comanda</label>
          <span className={cn('text-[10px] font-bold', d.comanda.length > COMANDA_MAX_LEN ? 'text-red-500' : 'text-slate-300')}>
            {d.comanda.length}/{COMANDA_MAX_LEN}
          </span>
        </div>
        {/* <input> y no <textarea>: Comanda_CM es single-line en SP (verificado) y rechaza
            saltos de línea con un 400 opaco. */}
        <input value={d.comanda} maxLength={COMANDA_MAX_LEN}
          onChange={e => setDraft({ ...d, comanda: e.target.value })}
          placeholder="Ej: Milanesa con puré / Ensalada / Fruta"
          className="mt-1.5 w-full h-10 px-3 rounded-lg border border-slate-200 text-sm outline-none focus:border-emerald-400" />
      </div>

      {formError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 font-medium">{formError}</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={() => { setDraft(null); setFormError(null); }} disabled={saving}
          className="h-9 rounded-lg text-xs font-bold">Cancelar</Button>
        <Button onClick={handleSave} disabled={saving}
          className="h-9 rounded-lg text-xs font-bold gap-2 bg-[#022C22] hover:bg-[#033d2f]">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {d.spItemId ? 'Guardar cambios' : 'Crear planificación'}
        </Button>
      </div>
    </div>
  );

  // ── Grilla ────────────────────────────────────────────────────────────────
  const renderGrid = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {canEdit ? (
          <Button onClick={() => { setFormError(null); setDraft({ ...EMPTY_DRAFT }); }}
            className="h-9 rounded-lg text-xs font-bold gap-2 bg-[#022C22] hover:bg-[#033d2f]">
            <Plus className="w-3.5 h-3.5" /> Nueva planificación
          </Button>
        ) : <span className="text-[11px] text-slate-400 font-medium">Solo lectura</span>}

        {expired.length > 0 && (
          <button onClick={() => setShowExpired(v => !v)}
            className="text-[11px] font-bold text-slate-400 hover:text-slate-600">
            {showExpired ? 'Ocultar vencidas' : `Ver vencidas (${expired.length})`}
          </button>
        )}
      </div>

      {listError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 font-medium">{listError}</p>
        </div>
      )}

      {loading ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center">
          <CalendarDays className="w-8 h-8 text-slate-200 mx-auto mb-2" />
          <p className="text-xs text-slate-400 font-medium">
            {plans.length === 0 ? 'No hay planificaciones cargadas todavía.' : 'No hay planificaciones vigentes.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="px-2 py-2 font-bold">Turno</th>
                <th className="px-2 py-2 font-bold">Tipo</th>
                <th className="px-2 py-2 font-bold whitespace-nowrap">Fechas</th>
                <th className="px-2 py-2 font-bold">Comanda</th>
                <th className="px-2 py-2 font-bold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {visible.map(p => {
                const vencida = isExpired(p);
                return (
                  <tr key={p.spItemId} className={cn('hover:bg-slate-50/60', vencida && 'opacity-50')}>
                    <td className="px-2 py-2.5">
                      <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border', TURNO_CLS[p.turno])}>
                        {mealSlotLabel(p.turno)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border', TIPO_CLS[p.tipo])}>
                        {tipoPlanLabel(p.tipo)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 whitespace-nowrap font-bold text-slate-700">
                      {ddmm(p.desde)} <span className="text-slate-300">→</span> {ddmm(p.hasta)}
                      {vencida && <span className="ml-1.5 text-[9px] uppercase font-bold text-slate-400">vencida</span>}
                    </td>
                    <td className="px-2 py-2.5 text-slate-800 max-w-[260px] break-words">{p.comanda}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {confirmDelete === p.spItemId ? (
                          <>
                            <span className="text-[10px] font-bold text-slate-500 mr-1">¿Eliminar?</span>
                            <button onClick={() => handleDelete(p.spItemId)} disabled={saving}
                              className="px-2 h-7 rounded-md bg-red-600 text-white text-[10px] font-bold hover:bg-red-700">Sí</button>
                            <button onClick={() => setConfirmDelete(null)}
                              className="px-2 h-7 rounded-md border border-slate-200 text-[10px] font-bold text-slate-500">No</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(p)} disabled={!canEdit || vencida}
                              title={vencida ? 'Planificación vencida' : 'Editar'}
                              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setConfirmDelete(p.spItemId)} disabled={!canEdit || vencida}
                              title={vencida ? 'Planificación vencida' : 'Eliminar'}
                              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="w-4 h-4 text-emerald-600" />
            Planificación de comandas
          </DialogTitle>
        </DialogHeader>
        <div className="pt-2">{draft ? renderForm(draft) : renderGrid()}</div>
      </DialogContent>
    </Dialog>
  );
};
