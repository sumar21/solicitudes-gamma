import { APP_VERSION } from '../version';
import {
  anunciaOtraVersion,
  CADA_CUANTO_MS,
  PRIMERA_CONSULTA_MS,
  tocaPreguntar,
} from './actualizacion';

/**
 * Cuándo se pregunta a /api/version, sin React:
 *   · 10 s después de arrancar, y cada 5 minutos con la pestaña a la vista.
 *   · `revisar()` (volver a la pestaña, enfocarla) pregunta si pasaron 30 s.
 *   · `anunciar(version)` pregunta en el acto si la versión no es la de este código.
 *   · Nunca dos a la vez; lo anunciado durante una consulta vuelve a preguntar al terminar.
 *   · Oculta, no pregunta nada.
 * Cada anuncio pide UNA consulta y la consulta lo consume: no hay bucle.
 */
export interface OpcionesDelVigilante {
  /** La versión del servidor, o `null` si no se pudo saber. Nunca rechaza. */
  pedir: (signal: AbortSignal) => Promise<string | null>;
  esVisible: () => boolean;
  /** Cada respuesta con versión. Las `null` no llegan. */
  alResponder: (version: string) => void;
  bundle?: string;
}

export interface Vigilante {
  revisar: () => void;
  anunciar: (version: string) => void;
  detener: () => void;
}

export function vigilarLaVersion({
  pedir,
  esVisible,
  alResponder,
  bundle = APP_VERSION,
}: OpcionesDelVigilante): Vigilante {
  let vivo = true;
  let enCurso: AbortController | null = null;
  let ultima = Number.NEGATIVE_INFINITY;
  let anunciada = false;

  const consultar = async () => {
    const controlador = new AbortController();
    enCurso = controlador;
    ultima = Date.now();
    try {
      const version = await pedir(controlador.signal);
      if (vivo && version !== null) alResponder(version);
    } finally {
      if (enCurso === controlador) enCurso = null;
      if (anunciada) revisar();
    }
  };

  function revisar() {
    if (!vivo) return;
    if (
      !tocaPreguntar({
        ahora: Date.now(),
        ultima,
        enCurso: enCurso !== null,
        visible: esVisible(),
        anunciada,
      })
    ) {
      return;
    }
    anunciada = false;
    void consultar();
  }

  const anunciar = (version: string) => {
    if (!anunciaOtraVersion(version, bundle)) return;
    anunciada = true;
    revisar();
  };

  const primera = setTimeout(revisar, PRIMERA_CONSULTA_MS);
  const cada = setInterval(revisar, CADA_CUANTO_MS);

  return {
    revisar,
    anunciar,
    detener: () => {
      vivo = false;
      clearTimeout(primera);
      clearInterval(cada);
      enCurso?.abort();
    },
  };
}
