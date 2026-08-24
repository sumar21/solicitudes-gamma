/**
 * Store del enrich en Supabase (public.enrich_camas) — Fase 2 de la migración de 12.EnrichCamas (SP).
 *
 * UNIQUE(entorno, event_key) + upsert ON CONFLICT → una fila por evento, sin duplicados por diseño
 * (a diferencia de SP, que no tenía unicidad y acumulaba dupes → el bug de falso "sin dieta").
 *
 * Migración gateada por entorno:
 *   - ENRICH_WRITE_SUPABASE: entornos que ESCRIBEN el enrich a Supabase (dual-write con SP).
 *   - ENRICH_READ_SUPABASE: entornos que LEEN el enrich desde Supabase (mapa de camas + backstop
 *     'sin_dieta') en vez de SP. El read tiene fallback a SP (fillEnrichMapFromSP): si falta la fila
 *     en Supabase, el mapa se completa desde SP → el read-flip nunca deja el mapa sin enrich.
 *   PRODUCTIVO habilitado en el pase del 2026-08-24 (ver docs/historial/runbook-pase-prod-2026-08-24.md).
 *
 * Los datos son médicos (dni, diagnóstico) → SOLO service_role (getSupabaseAdmin). Nunca al cliente.
 */
import { getSupabaseAdmin } from './supabase-admin.js';
import type { EnrichResult } from './enrich-core.js';

export const ENRICH_WRITE_SUPABASE: string[] = ['TESTING', 'PRODUCTIVO'];
export const ENRICH_READ_SUPABASE:  string[] = ['TESTING', 'PRODUCTIVO'];

export const enrichWritesToSupabase = (entorno: string): boolean => ENRICH_WRITE_SUPABASE.includes(entorno);
export const enrichReadsFromSupabase = (entorno: string): boolean => ENRICH_READ_SUPABASE.includes(entorno);

// Upsert de una cama. ON CONFLICT (entorno, event_key) → actualiza la fila existente, nunca duplica.
export async function upsertEnrichSupabase(
  entorno: string, eventKey: string, patientCode: string, payload: EnrichResult,
): Promise<boolean> {
  try {
    const { error } = await getSupabaseAdmin().from('enrich_camas').upsert(
      {
        entorno,
        event_key:    eventKey,
        patient_code: patientCode || null,
        payload,
        status:       'Activo',
        updated_at:   new Date().toISOString(),
      },
      { onConflict: 'entorno,event_key' },
    );
    if (error) { console.error('[enrich-store] upsert:', error.message); return false; }
    return true;
  } catch (e: any) {
    console.error('[enrich-store] upsert ex:', e?.message ?? e);
    return false;
  }
}

export interface EnrichSupaRow { eventKey: string; payload: EnrichResult; updatedAt: string; }

// Lee el enrich activo del entorno → Map por eventKey. Lo usan el cron (baseline de cambios) y
// /api/beds + el backstop de /api/dietas (cuando enrichReadsFromSupabase(entorno)).
export async function readEnrichSupabase(entorno: string): Promise<Map<string, EnrichSupaRow>> {
  const map = new Map<string, EnrichSupaRow>();
  try {
    const { data, error } = await getSupabaseAdmin().from('enrich_camas')
      .select('event_key, payload, updated_at')
      .eq('entorno', entorno).eq('status', 'Activo');
    if (error) { console.error('[enrich-store] read:', error.message); return map; }
    for (const r of data ?? []) {
      const key = String((r as any).event_key ?? '').trim();
      if (!key) continue;
      const payload = (r as any).payload;
      // Defensa: un payload malformado (null/no-objeto) que reventara applyEnrichToBed haría que el
      // try externo se coma TODO el enrich (todas las camas sin overlay). Se saltea la fila, como el
      // path SP (que envuelve el JSON.parse por fila).
      if (!payload || typeof payload !== 'object') continue;
      map.set(key, { eventKey: key, payload: payload as EnrichResult, updatedAt: String((r as any).updated_at ?? '') });
    }
  } catch (e: any) {
    console.error('[enrich-store] read ex:', e?.message ?? e);
  }
  return map;
}

// Lee el payload del enrich de UN paciente (para el backstop 'sin_dieta' de /api/dietas). Busca por
// event_key (origen-numero) y, si no está, por patient_code (más reciente activo). null = no hay fila
// en Supabase → el caller cae a SharePoint (transición) o hace fail-open.
export async function readEnrichPayloadSupabase(
  entorno: string, eventKey: string, patientCode: string,
): Promise<EnrichResult | null> {
  const asPayload = (p: unknown): EnrichResult | null => (p && typeof p === 'object' ? p as EnrichResult : null);
  try {
    const supa = getSupabaseAdmin();
    const ek = String(eventKey ?? '').trim();
    if (ek && ek !== '-') {
      // Con eventKey real: SOLO ese evento. Si no está en Supabase → null, para que el caller caiga a
      // SP (que matchea por eventKey). NO caer a patient_code: podría traer un evento VIEJO del mismo
      // paciente (sin dieta) y tapar el actual → falso 409 'sin_dieta' (justo el bug que evitamos).
      const { data } = await supa.from('enrich_camas').select('payload')
        .eq('entorno', entorno).eq('event_key', ek).eq('status', 'Activo').limit(1);
      return data && data[0] ? asPayload((data[0] as any).payload) : null;
    }
    // Sin eventKey: recién ahí fallback por patient_code (fila activa más reciente).
    const pc = String(patientCode ?? '').trim();
    if (pc) {
      const { data } = await supa.from('enrich_camas').select('payload')
        .eq('entorno', entorno).eq('patient_code', pc).eq('status', 'Activo')
        .order('updated_at', { ascending: false }).limit(1);
      if (data && data[0]) return asPayload((data[0] as any).payload);
    }
    return null;
  } catch (e: any) {
    console.error('[enrich-store] readPayload ex:', e?.message ?? e);
    return null;
  }
}

// Cleanup: marca Inactivo los eventos que ya NO están ocupados (no vistos en el ciclo). Con la tabla
// no hace falta el dedup de SP: el upsert ya garantiza unicidad. Devuelve cuántas desactivó.
export async function deactivateFreedEnrichSupabase(entorno: string, activeEventKeys: Set<string>): Promise<number> {
  try {
    const { data, error } = await getSupabaseAdmin().from('enrich_camas')
      .select('event_key').eq('entorno', entorno).eq('status', 'Activo');
    if (error) { console.error('[enrich-store] cleanup read:', error.message); return 0; }
    const toDeactivate = (data ?? [])
      .map(r => String((r as any).event_key ?? '').trim())
      .filter(k => k && !activeEventKeys.has(k));
    if (toDeactivate.length === 0) return 0;
    const { error: upErr } = await getSupabaseAdmin().from('enrich_camas')
      .update({ status: 'Inactivo' })
      .eq('entorno', entorno).in('event_key', toDeactivate);
    if (upErr) { console.error('[enrich-store] cleanup update:', upErr.message); return 0; }
    return toDeactivate.length;
  } catch (e: any) {
    console.error('[enrich-store] cleanup ex:', e?.message ?? e);
    return 0;
  }
}
