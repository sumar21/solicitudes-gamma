import React, { useId } from 'react';
import { RefreshCw } from 'lucide-react';
import { useActualizacion } from './Actualizacion';
import { useAhora } from '../hooks/useAhora';
import { formatearCuentaRegresiva, TIC_MS } from '../lib/version/actualizacion';

// «Se actualiza en 9:41»: el chip del encabezado durante la cuenta. Un clic actualiza ya. La recarga de
// las 0:00 la hace el proveedor; el chip solo cuenta.
export const CuentaRegresivaDeActualizacion: React.FC = () => {
  const { recargaEn } = useActualizacion();
  if (recargaEn === null) return null;
  return <Chip recargaEn={recargaEn} />;
};

// Aparte para que el reloj de cada segundo corra solo con una cuenta en curso.
const Chip: React.FC<{ recargaEn: number }> = ({ recargaEn }) => {
  const { retenida, actualizarAhora } = useActualizacion();
  const restante = recargaEn - useAhora(TIC_MS).getTime();
  const idDelTiempo = useId();

  // Vencida con un guardado en curso: espera, y lo dice.
  const esperando = restante <= 0 && retenida;

  return (
    <button
      type="button"
      onClick={actualizarAhora}
      title="Actualizar ahora"
      aria-label="Actualizar ahora"
      aria-describedby={idDelTiempo}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      <span id={idDelTiempo}>
        {esperando ? (
          <>
            <span className="max-sm:sr-only">Se actualiza al terminar</span>
            <span className="sm:hidden" aria-hidden="true">Al terminar</span>
          </>
        ) : (
          <>
            <span className="max-sm:sr-only">Se actualiza en </span>
            <span className="tabular-nums">{formatearCuentaRegresiva(restante)}</span>
          </>
        )}
      </span>
    </button>
  );
};
