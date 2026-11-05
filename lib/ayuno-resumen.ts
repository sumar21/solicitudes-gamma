// Lectura del "antes / después" de un cambio de ayuno (ayuno_cambios.resumen_prev / resumen_new).
// El cron los guarda como texto: 'sin ayuno' o "DD/MM HH:MM, DD/MM HH:MM, …". Las filas anteriores al
// 05/11/2026 vienen recortadas a 3 horarios + " y N más" (el mismo formato del push); desde entonces
// se guardan todos. Acá se agrupan por día para mostrarlos como "05/11 · 12:00 16:00 20:00".

export interface DiaAyuno { dia: string; horas: string[] }
export interface ResumenAyuno {
  dias: DiaAyuno[];
  /** Horarios que el texto no trae (filas viejas recortadas: "y 12 más"). 0 si vino completo. */
  resto: number;
  /** El texto no se pudo leer como horarios: se muestra tal cual. */
  crudo?: string;
}

export function leerResumenAyuno(texto: string | null | undefined): ResumenAyuno {
  let s = String(texto ?? '').trim();
  if (!s || s.toLowerCase() === 'sin ayuno') return { dias: [], resto: 0 };

  let resto = 0;
  const mas = /\s+y\s+(\d+)\s+más$/i.exec(s);
  if (mas) { resto = Number(mas[1]); s = s.slice(0, mas.index); }

  const dias: DiaAyuno[] = [];
  for (const parte of s.split(',').map(p => p.trim()).filter(Boolean)) {
    const m = /^(\d{2}\/\d{2})\s+(\d{2}:\d{2})$/.exec(parte);
    if (!m) return { dias: [], resto: 0, crudo: String(texto).trim() };
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.dia === m[1]) ultimo.horas.push(m[2]);
    else dias.push({ dia: m[1], horas: [m[2]] });
  }
  return { dias, resto };
}

// Ubicación de la fila: el cron guarda los nombres de PROGAL ("Internacion 6° Piso HPR" + "Habitación
// 607 HPR"; en sectores sin habitaciones numeradas, la "habitación" repite el sector). Se muestra
// "Internacion 6° Piso · Hab. 607", o solo el sector si la habitación no trae número.
export function ubicacionAyuno(area: string | null | undefined, habitacion: string | null | undefined): string {
  const sector = String(area ?? '').replace(/\s+HPR$/i, '').trim();
  const nro = /\d+/.exec(String(habitacion ?? ''))?.[0];
  return [sector, nro && `Hab. ${nro}`].filter(Boolean).join(' · ') || '—';
}
