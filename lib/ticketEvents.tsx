import React from 'react';
import {
  Plus, SprayCan, ArrowRightLeft, MapPin, CheckCircle2, Pencil, XCircle,
} from '../components/Icons';

// Vocabulario canónico de los movimientos registrados en 08.DetalleTraslados.
// Centralizado acá para que la auditoría (AuditModal), el export del historial
// (HistoryView) y la trayectoria del paciente (PatientJourney) hablen el mismo idioma.
// Antes vivía duplicado en cada archivo y se desincronizaba.

export interface EventConfig {
  label: string;
  sublabel: string;
  icon: React.FC<any>;
}

export const EVENT_CONFIG: Record<string, EventConfig> = {
  'Solicitud Creada':     { label: 'Solicitud Creada / Cama Asignada', sublabel: 'Admisión',       icon: Plus },
  'Habitacion Preparada': { label: 'Habitación Preparada',             sublabel: 'Azafata Destino', icon: SprayCan },
  'Inicio Traslado':      { label: 'Traslado Iniciado',                sublabel: 'Azafata Origen',  icon: ArrowRightLeft },
  'Paciente Recibido':    { label: 'Paciente Recibido',                sublabel: 'Azafata Destino', icon: MapPin },
  'Consolidado Progal':   { label: 'Consolidado en PROGAL',            sublabel: 'Admisión',        icon: CheckCircle2 },
};

// Config visual para un evento crudo `tipo`. Resuelve modificaciones y cancelaciones
// (que no tienen una key fija) a un config con ícono propio.
export function eventConfigFor(tipo: string, fallbackUser = ''): EventConfig {
  if (parseModification(tipo)) {
    return { label: 'Modificación de Traslado', sublabel: 'Admisión', icon: Pencil };
  }
  if (tipo.startsWith('Cancelado:')) {
    return { label: 'Traslado Cancelado', sublabel: 'Admisión', icon: XCircle };
  }
  return EVENT_CONFIG[tipo] ?? { label: tipo, sublabel: fallbackUser, icon: Plus };
}

// Parsea un evento de modificación. Formato almacenado:
//   "Modificacion - {cambio} | {cambio} | ... - Motivo: {motivo}"
export function parseModification(tipo: string): { changes: string[]; motivo: string } | null {
  if (!tipo || !tipo.startsWith('Modificacion')) return null;
  const content = tipo.replace(/^Modificacion\s*-\s*/, '');
  const motivoIdx = content.lastIndexOf(' - Motivo:');
  let changesStr = content;
  let motivo = '';
  if (motivoIdx >= 0) {
    changesStr = content.slice(0, motivoIdx);
    motivo = content.slice(motivoIdx + ' - Motivo:'.length).trim();
  }
  const changes = changesStr.split(' | ').map(s => s.trim()).filter(Boolean);
  return { changes, motivo };
}

// Etiqueta legible para reportes/export (sin íconos): { label, detail }.
export function movementLabel(tipo: string): { label: string; detail: string } {
  if (!tipo) return { label: '', detail: '' };
  if (tipo === 'Solicitud Creada')     return { label: 'Creación',              detail: '' };
  if (tipo === 'Habitacion Preparada') return { label: 'Habitación Preparada',  detail: '' };
  if (tipo === 'Inicio Traslado')      return { label: 'Inicio Traslado',       detail: '' };
  if (tipo === 'Paciente Recibido')    return { label: 'Paciente Recibido',     detail: '' };
  if (tipo === 'Consolidado Progal')   return { label: 'Consolidado en PROGAL', detail: '' };
  if (tipo.startsWith('Cancelado:')) {
    return { label: 'Cancelación', detail: tipo.replace(/^Cancelado:\s*/, '').trim() };
  }
  const mod = parseModification(tipo);
  if (mod) {
    const detail = [...mod.changes].join(' | ') + (mod.motivo ? ` — Motivo: ${mod.motivo}` : '');
    return { label: 'Modificación', detail };
  }
  return { label: tipo, detail: '' };
}
