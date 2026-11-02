import { registerSW } from 'virtual:pwa-register';

/**
 * El service worker y la recarga.
 *
 * Es lo que separa a MediFlow del patrón original: el SW sirve el bundle desde su precache, así que un
 * `location.reload()` a secas trae EL MISMO código viejo y el aviso volvería a abrirse. Recargar acá es:
 * que el SW nuevo tome el control y recién ahí recargar (lo hace vite-plugin-pwa al recibir 'controlling').
 *
 * Con sesión, el SW nuevo queda esperando hasta que la usuaria elige en el aviso (ver Actualizacion.tsx).
 * Sin sesión no hay trabajo que perder: se aplica solo, como antes, y la tablet del login no queda vieja.
 */
const CADA_CUANTO_REVISA_SW_MS = 30 * 60 * 1000;
/** Si el SW nuevo no termina de instalarse en este tiempo, se recarga igual. */
const ESPERA_DEL_SW_MS = 15_000;

let aplicar: ((recargar?: boolean) => Promise<void>) | null = null;
let registro: ServiceWorkerRegistration | undefined;
let swEsperando = false;
let recargaPedida = false;

function haySesion(): boolean {
  try {
    return localStorage.getItem('mediflow_token') !== null;
  } catch {
    return false;
  }
}

export function registrarServiceWorker(): void {
  aplicar = registerSW({
    immediate: true,
    onNeedRefresh() {
      swEsperando = true;
      if (recargaPedida || !haySesion()) void aplicar?.(true);
    },
    onRegisteredSW(_swUrl, registration) {
      registro = registration;
      if (!registration) return;
      // Revisa el SW sin esperar a una navegación: las tabs quedan abiertas todo el día.
      setInterval(() => {
        registration.update().catch(() => { /* red inestable — se reintenta en la próxima vuelta */ });
      }, CADA_CUANTO_REVISA_SW_MS);
    },
  });
}

/** La recarga del aviso: a través del SW nuevo si hay uno, a secas si no. */
export async function recargarConLaVersionNueva(): Promise<void> {
  recargaPedida = true;
  // Cinturón: si 'controlling' nunca llega, la recarga no se pierde.
  window.setTimeout(() => window.location.reload(), ESPERA_DEL_SW_MS);

  if (swEsperando) {
    void aplicar?.(true);
    return;
  }
  // /api/version se enteró antes que el SW: se le pide que revise. Si encuentra uno, al terminar de
  // instalarse pasa por onNeedRefresh y se aplica con `recargaPedida`.
  try {
    await registro?.update();
  } catch {
    /* Sin red no hay SW nuevo: sigue abajo. */
  }
  if (!registro?.installing && !registro?.waiting) window.location.reload();
}
