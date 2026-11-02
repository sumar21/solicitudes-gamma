import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useVersionNueva } from '../hooks/useVersionNueva';
import { avisoAbierto, REINTENTO_DE_RECARGA_MS, TIC_MS, tocaRecargar } from '../lib/version/actualizacion';
import { recargarConLaVersionNueva } from '../lib/version/serviceWorker';

// Detecta un deploy nuevo y ofrece actualizar. Va montado adentro de la app con sesión: el login no
// lo necesita porque ahí el SW se aplica solo (ver lib/version/serviceWorker.ts).

type Actualizacion = {
  /** La versión que corre el servidor, si no es la de esta pestaña. */
  desplegada: string | null;
  /** Hay otra versión y ninguna cuenta regresiva en curso. */
  avisoAbierto: boolean;
  /** Cuándo recarga sola (epoch ms), o `null` sin cuenta regresiva. */
  recargaEn: number | null;
  /** Hay un guardado en curso: la recarga de las 0:00 espera. */
  retenida: boolean;
  /** «Actualizar ahora» ya recargó y la página todavía no se fue. */
  recargando: boolean;
  postergar: () => void;
  actualizarAhora: () => void;
};

const ActualizacionContext = createContext<Actualizacion>({
  desplegada: null,
  avisoAbierto: false,
  recargaEn: null,
  retenida: false,
  recargando: false,
  postergar: () => {},
  actualizarAhora: () => { void recargarConLaVersionNueva(); },
});

export function useActualizacion(): Actualizacion {
  return useContext(ActualizacionContext);
}

export const ActualizacionProvider: React.FC<{ children: React.ReactNode; retenida?: boolean }> = ({ children, retenida = false }) => {
  const { desplegada, plazo, postergar } = useVersionNueva();
  const recargaEn = plazo?.en ?? null;

  // A las 0:00 recarga sola, UNA vez por plazo. Se mira el reloj cada segundo y al volver a la pestaña.
  // Un ref y no una variable del efecto: el efecto se vuelve a ejecutar cuando `retenida` cambia, y eso
  // no debe rearmar el disparo.
  const disparadaPara = useRef<number | null>(null);
  useEffect(() => {
    if (plazo === null || retenida) return;

    const vencida = () => {
      if (!tocaRecargar({ ahora: Date.now(), plazo, retenida, disparadaPara: disparadaPara.current })) return;
      disparadaPara.current = plazo.en;
      void recargarConLaVersionNueva();
    };

    vencida();
    const tic = window.setInterval(vencida, TIC_MS);
    document.addEventListener('visibilitychange', vencida);
    window.addEventListener('focus', vencida);
    return () => {
      window.clearInterval(tic);
      document.removeEventListener('visibilitychange', vencida);
      window.removeEventListener('focus', vencida);
    };
  }, [plazo, retenida]);

  // El spinner, recién cuando la recarga va. Si a los 5 s la página sigue, el botón se vuelve a ofrecer.
  const [recargando, setRecargando] = useState(false);
  useEffect(() => {
    if (!recargando) return;
    const reintento = window.setTimeout(() => setRecargando(false), REINTENTO_DE_RECARGA_MS);
    return () => window.clearTimeout(reintento);
  }, [recargando]);

  const actualizarAhora = useCallback(() => {
    setRecargando(true);
    void recargarConLaVersionNueva();
  }, []);

  const valor = useMemo<Actualizacion>(
    () => ({
      desplegada,
      avisoAbierto: avisoAbierto({ desplegada, plazo }),
      recargaEn,
      retenida,
      recargando,
      postergar,
      actualizarAhora,
    }),
    [desplegada, plazo, recargaEn, retenida, recargando, postergar, actualizarAhora],
  );

  return <ActualizacionContext.Provider value={valor}>{children}</ActualizacionContext.Provider>;
};
