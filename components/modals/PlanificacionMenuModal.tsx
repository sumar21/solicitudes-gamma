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
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Cargando, Vacio } from '../ui/estados';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { aIso, deIso } from '../../lib/fechaIso';
import { Button } from '../ui/button';
import { Plus, Pencil, Trash2, CalendarDays, AlertCircle, Loader2, Check } from 'lucide-react';

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
  // Las acciones (Cancelar / Guardar) viven en el DialogFooter; acá solo van los campos.
  const renderForm = (d: Draft) => (
    <div className="space-y-4">
      {/* Todo en una fila. Turno/Tipo con el Select de shadcn (`ui/select.tsx`, sobre Radix):
          su contenido va en un Portal, así que el `overflow: hidden` del DialogContent no lo recorta. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Turno <span className="text-destructive">*</span></label>
          {/* Radix reserva value="" para "sin valor" → el placeholder va en SelectValue, no como item. */}
          <Select value={d.turno || undefined} onValueChange={v => setDraft({ ...d, turno: v as MealSlot })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Elegir…" />
            </SelectTrigger>
            <SelectContent>
              {MEAL_SLOTS.map(({ slot, label }) => (
                <SelectItem key={slot} value={slot}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo <span className="text-destructive">*</span></label>
          <Select value={d.tipo || undefined} onValueChange={v => setDraft({ ...d, tipo: v as TipoPlan })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Elegir…" />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_PLAN.map(({ tipo, label }) => (
                <SelectItem key={tipo} value={tipo}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {([['Desde', 'desde', openDesde, setOpenDesde], ['Hasta', 'hasta', openHasta, setOpenHasta]] as const).map(
          ([label, key, isOpen, setOpen]) => (
            <div key={key}>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{label} <span className="text-destructive">*</span></label>
              <Popover open={isOpen} onOpenChange={setOpen as any}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline"
                    className={cn('w-full justify-start gap-1.5 px-3 font-normal', !d[key] && 'text-muted-foreground')}>
                    <CalendarDays className="size-4 text-muted-foreground" />
                    <span className="truncate">{d[key] ? formatDateReadable(d[key]) : 'Elegir'}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto">
                  <Calendar mode="single" required selected={deIso(d[key])} onSelect={(dia: Date) => { const date = aIso(dia); setDraft({ ...d, [key]: date }); (setOpen as any)(false); }} />
                </PopoverContent>
              </Popover>
            </div>
          ))}
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="planificacion-comanda" className="mb-1 block text-xs font-medium text-muted-foreground">Comanda <span className="text-destructive">*</span></label>
          <span className={cn('text-[11px] tabular-nums', d.comanda.length > COMANDA_MAX_LEN ? 'text-destructive' : 'text-muted-foreground')}>
            {d.comanda.length}/{COMANDA_MAX_LEN}
          </span>
        </div>
        {/* <input> y no <textarea>: Comanda_CM es single-line en SP (verificado) y rechaza
            saltos de línea con un 400 opaco. */}
        <Input id="planificacion-comanda" value={d.comanda} maxLength={COMANDA_MAX_LEN}
          onChange={e => setDraft({ ...d, comanda: e.target.value })}
          placeholder="Ej: Milanesa con puré / Ensalada / Fruta" />
      </div>

      {formError && (
        // Banner de error inline (§9.4).
        <div role="alert" className="rounded-lg border p-3 flex items-start gap-2 text-sm bg-red-50 border-red-200 text-red-700">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <p>{formError}</p>
        </div>
      )}
    </div>
  );

  // ── Grilla ────────────────────────────────────────────────────────────────
  // "Nueva planificación" es la acción principal → va en el DialogFooter.
  const renderGrid = () => (
    <div className="space-y-3">
      {(!canEdit || expired.length > 0) && (
        <div className="flex items-center justify-between gap-2">
          {!canEdit ? <span className="text-xs text-muted-foreground">Solo lectura</span> : <span />}
          {expired.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowExpired(v => !v)}>
              {showExpired ? 'Ocultar vencidas' : `Ver vencidas (${expired.length})`}
            </Button>
          )}
        </div>
      )}

      {listError && (
        <div role="alert" className="rounded-lg border p-3 flex items-start gap-2 text-sm bg-red-50 border-red-200 text-red-700">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <p>{listError}</p>
        </div>
      )}

      {loading ? (
        <Cargando texto="Cargando planificación…" className="py-10" />
      ) : visible.length === 0 ? (
        <Vacio
          icono={CalendarDays}
          titulo={plans.length === 0 ? 'No hay planificaciones cargadas todavía.' : 'No hay planificaciones vigentes.'}
        />
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="px-2 py-2 font-semibold">Turno</th>
                <th className="px-2 py-2 font-semibold">Tipo</th>
                <th className="px-2 py-2 font-semibold whitespace-nowrap">Fechas</th>
                <th className="px-2 py-2 font-semibold">Comanda</th>
                <th className="px-2 py-2 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map(p => {
                const vencida = isExpired(p);
                return (
                  <tr key={p.spItemId} className={cn('hover:bg-muted/50', vencida && 'opacity-50')}>
                    <td className="px-2 py-2.5">
                      <span className={cn('text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border', TURNO_CLS[p.turno])}>
                        {mealSlotLabel(p.turno)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={cn('text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border', TIPO_CLS[p.tipo])}>
                        {tipoPlanLabel(p.tipo)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 whitespace-nowrap font-medium tabular-nums text-foreground">
                      {ddmm(p.desde)} <span className="text-muted-foreground">→</span> {ddmm(p.hasta)}
                      {vencida && <span className="ml-1.5 text-[10px] uppercase font-semibold text-muted-foreground">vencida</span>}
                    </td>
                    <td className="px-2 py-2.5 text-foreground max-w-[260px] wrap-break-word">{p.comanda}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {confirmDelete === p.spItemId ? (
                          <>
                            <span className="text-xs font-medium text-muted-foreground mr-1">¿Eliminar?</span>
                            <Button type="button" size="sm" variant="destructive" onClick={() => handleDelete(p.spItemId)} disabled={saving}
                              className="h-7 px-2 text-xs">Sí</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDelete(null)}
                              className="h-7 px-2 text-xs">No</Button>
                          </>
                        ) : (
                          <>
                            <Button type="button" variant="ghost" size="icon-sm" onClick={() => startEdit(p)} disabled={!canEdit || vencida}
                              title={vencida ? 'Planificación vencida' : 'Editar'} aria-label="Editar"
                              className="text-muted-foreground hover:text-foreground">
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setConfirmDelete(p.spItemId)} disabled={!canEdit || vencida}
                              title={vencida ? 'Planificación vencida' : 'Eliminar'} aria-label="Eliminar"
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                              <Trash2 className="size-3.5" />
                            </Button>
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

  const cerrarForm = () => { setDraft(null); setFormError(null); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Modal canónico (DESIGN §4.1): grilla + subform en el mismo modal; 3xl por la tabla de 5 columnas. */}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            <CalendarDays className="size-5 text-primary" />
            Planificación de comandas
          </DialogTitle>
          <DialogDescription>
            {draft ? (draft.spItemId ? 'Editar planificación' : 'Nueva planificación') : 'Menú y opciones planificados por turno.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>{draft ? renderForm(draft) : renderGrid()}</DialogBody>
        <DialogFooter>
          {draft ? (
            <>
              <Button type="button" variant="outline" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
              <Button type="button" onClick={handleSave} disabled={saving} className="min-w-[140px]">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {draft.spItemId ? 'Guardar cambios' : 'Crear planificación'}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
              {canEdit && (
                <Button type="button" onClick={() => { setFormError(null); setDraft({ ...EMPTY_DRAFT }); }} className="min-w-[140px]">
                  <Plus className="size-4" /> Nueva planificación
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
