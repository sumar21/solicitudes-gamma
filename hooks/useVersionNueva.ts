import { useCallback, useEffect, useState } from 'react';

import {
  AL_DIA,
  CLAVE_DEL_PLAZO,
  conLaRespuesta,
  escribirPlazo,
  estadoInicial,
  leerPlazo,
  postergar as postergarEstado,
  type EstadoDeLaVersion,
  type Plazo,
} from '../lib/version/actualizacion';
import { pedirVersionDesplegada } from '../lib/version/versionDesplegada';
import { vigilarLaVersion } from '../lib/version/vigilante';

/* `sessionStorage` puede no existir o lanzar: cada acceso va con su `try`.
   Sin él, la cuenta corre en memoria y solo se pierde que sobreviva a un remontaje. */
function sesion(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function leerPlazoGuardado(ahora: number): Plazo | null {
  try {
    return leerPlazo(sesion()?.getItem(CLAVE_DEL_PLAZO) ?? null, ahora);
  } catch {
    return null;
  }
}

function guardarPlazo(plazo: Plazo | null): void {
  try {
    if (plazo) sesion()?.setItem(CLAVE_DEL_PLAZO, escribirPlazo(plazo));
    else sesion()?.removeItem(CLAVE_DEL_PLAZO);
  } catch {
    /* Corre en memoria. */
  }
}

/**
 * Si el servidor corre otra versión que esta pestaña, y la cuenta regresiva.
 * La cuenta guardada se lee en un efecto (no en `useState`) para evitar un error
 * de hidratación: el servidor no tiene `sessionStorage`.
 */
export function useVersionNueva(): EstadoDeLaVersion & { postergar: () => void } {
  const [estado, setEstado] = useState<EstadoDeLaVersion>(AL_DIA);
  const [restaurado, setRestaurado] = useState(false);

  useEffect(() => {
    const guardado = leerPlazoGuardado(Date.now());
    /* Solo si nada cambió todavía: lo que ya contestó el servidor manda. */
    if (guardado !== null) {
      setEstado((actual) => (actual === AL_DIA ? estadoInicial(guardado) : actual));
    }
    setRestaurado(true);
  }, []);

  useEffect(() => {
    const vigilante = vigilarLaVersion({
      pedir: (signal) => pedirVersionDesplegada({ signal }),
      esVisible: () => document.visibilityState === 'visible',
      alResponder: (version) => setEstado((actual) => conLaRespuesta(actual, version)),
    });
    const { revisar } = vigilante;

    document.addEventListener('visibilitychange', revisar);
    window.addEventListener('focus', revisar);

    return () => {
      document.removeEventListener('visibilitychange', revisar);
      window.removeEventListener('focus', revisar);
      vigilante.detener();
    };
  }, []);

  /* Lo guardado sigue a la cuenta: se escribe al empezar y se borra al cancelarse
     (o al montar, si lo que había no se podía retomar). Recién después de leerla. */
  const { plazo } = estado;
  useEffect(() => {
    if (restaurado) guardarPlazo(plazo);
  }, [restaurado, plazo]);

  const postergar = useCallback(
    () => setEstado((actual) => postergarEstado(actual, Date.now())),
    [],
  );

  return { ...estado, postergar };
}
