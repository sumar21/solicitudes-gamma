import { useEffect, useState } from 'react';

export function useAhora(cadaMs: number): Date {
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    const tic = () => setAhora(new Date());
    const alVolver = () => {
      if (document.visibilityState === 'visible') tic();
    };

    const intervalo = window.setInterval(tic, cadaMs);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cadaMs]);

  return ahora;
}
