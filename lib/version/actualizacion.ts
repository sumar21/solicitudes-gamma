import { APP_VERSION, esVersionDeLaApp } from '../version';

/**
 * Las reglas del aviso de versión nueva, sin React y sin el navegador.
 * Lo ÚNICO que abre el aviso es la respuesta de /api/version. Se compara con
 * `!==` y no con «más nueva»: revertir un despliegue también obliga a recargar.
 */

/** La primera pregunta, un rato después de abrir. */
export const PRIMERA_CONSULTA_MS = 10_000;
/** Después, cada cinco minutos mientras la pestaña está a la vista. */
export const CADA_CUANTO_MS = 5 * 60_000;
/** Volver a la pestaña o enfocarla pregunta, pero no dos veces en treinta segundos. */
export const ENTRE_CONSULTAS_MS = 30_000;
/** Una pregunta sin respuesta en diez segundos se corta. */
export const CORTE_DE_LA_CONSULTA_MS = 10_000;
/** «Actualizar en 10 minutos». */
export const POSTERGACION_MS = 10 * 60_000;
/** Cada cuánto se mira el reloj de la cuenta regresiva. */
export const TIC_MS = 1_000;
/** Cuánto gira «Actualizar ahora» antes de volver a ofrecerse si la página no se fue. */
export const REINTENTO_DE_RECARGA_MS = 5_000;
/** Dónde se guarda la cuenta regresiva. */
export const CLAVE_DEL_PLAZO = 'mediflow_plazo_actualizacion';

/** Una cuenta regresiva: a las `en` (epoch ms) se recarga para cargar `version`. */
export interface Plazo {
  en: number;
  version: string;
}

/** `desplegada`: la versión del servidor si no es la de esta pestaña; `null` si es la misma. */
export interface EstadoDeLaVersion {
  desplegada: string | null;
  plazo: Plazo | null;
}

export const AL_DIA: EstadoDeLaVersion = { desplegada: null, plazo: null };

/**
 * La cuenta guardada, si ESTE código la puede retomar; si no, `null`.
 * Después de recargar corre otro código y la cuenta del viejo no le corresponde.
 * Si la recarga trajo el mismo código, el plazo ya pasó: retomarlo recargaría en bucle.
 */
export function leerPlazo(
  crudo: string | null,
  ahora: number,
  bundle: string = APP_VERSION,
): Plazo | null {
  if (!crudo) return null;

  let guardado: unknown;
  try {
    guardado = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (guardado === null || typeof guardado !== 'object') return null;

  const { en, version, desde } = guardado as Record<string, unknown>;
  if (desde !== bundle || !esVersionDeLaApp(version) || version === bundle) return null;
  if (typeof en !== 'number' || !Number.isFinite(en)) return null;
  if (en <= ahora || en > ahora + POSTERGACION_MS) return null;

  return { en, version };
}

/** Lo que se guarda: el plazo y qué código lo empezó. */
export function escribirPlazo(plazo: Plazo, bundle: string = APP_VERSION): string {
  return JSON.stringify({ en: plazo.en, version: plazo.version, desde: bundle });
}

/** «9:41»: redondeado al segundo de arriba (0:00 recién al vencer), nunca negativo. */
export function formatearCuentaRegresiva(msRestantes: number): string {
  const segundos = Math.max(0, Math.ceil(msRestantes / 1000));
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
}

/** Al montar: una cuenta guardada que este código puede retomar sigue; si no, nada. */
export function estadoInicial(plazo: Plazo | null): EstadoDeLaVersion {
  return plazo === null ? AL_DIA : { desplegada: plazo.version, plazo };
}

/**
 * Lo que cambia con la respuesta de /api/version:
 *   · `null`: nada. Una falla no abre ni cierra el aviso.
 *   · La versión de este código: al día (cancela aviso y cuenta; caso rollback).
 *   · Otra: esa es la desplegada. Una cuenta en curso NO se reinicia.
 */
export function conLaRespuesta(
  estado: EstadoDeLaVersion,
  respuesta: string | null,
  bundle: string = APP_VERSION,
): EstadoDeLaVersion {
  if (respuesta === null) return estado;
  if (respuesta === bundle) return AL_DIA;
  return estado.desplegada === respuesta ? estado : { ...estado, desplegada: respuesta };
}

/** «Actualizar en 10 minutos». Con una cuenta ya en curso, la deja como está. */
export function postergar(estado: EstadoDeLaVersion, ahora: number): EstadoDeLaVersion {
  if (estado.desplegada === null || estado.plazo !== null) return estado;
  return { ...estado, plazo: { en: ahora + POSTERGACION_MS, version: estado.desplegada } };
}

/** El aviso se muestra con otra versión desplegada y ninguna cuenta regresiva en curso. */
export function avisoAbierto(estado: EstadoDeLaVersion): boolean {
  return estado.desplegada !== null && estado.plazo === null;
}

/** Si un anuncio externo (p. ej. realtime) amerita preguntar: otra versión con formato. */
export function anunciaOtraVersion(version: unknown, bundle: string = APP_VERSION): boolean {
  return esVersionDeLaApp(version) && version !== bundle;
}

/**
 * Si toca preguntar /api/version ahora: nunca dos a la vez ni con la pestaña oculta;
 * con una versión anunciada, en el acto; si no, pasados treinta segundos de la última.
 */
export function tocaPreguntar(p: {
  ahora: number;
  ultima: number;
  enCurso: boolean;
  visible: boolean;
  anunciada: boolean;
}): boolean {
  if (p.enCurso || !p.visible) return false;
  return p.anunciada || p.ahora - p.ultima >= ENTRE_CONSULTAS_MS;
}

/**
 * Si la cuenta regresiva recarga ahora: recién al vencer, UNA vez por plazo
 * (`disparadaPara`), y nunca con trabajo a medio hacer (`retenida`).
 */
export function tocaRecargar(p: {
  ahora: number;
  plazo: Plazo | null;
  retenida: boolean;
  disparadaPara: number | null;
}): boolean {
  if (p.plazo === null || p.retenida) return false;
  return p.ahora >= p.plazo.en && p.disparadaPara !== p.plazo.en;
}
