/**
 * Avisos de la app (reemplazo de window.alert).
 *
 * REGLA: nunca usar alert() / confirm() / prompt() nativos. El navegador los dibuja con su
 * propio cartel ("mediflow.sumar.dev dice…"), bloquea la pestaña y no respeta el diseño de la
 * app. Usar appAlert(), que se ve como el resto de MediFlow. `npm run lint` lo verifica
 * (scripts/check-no-native-dialogs.mjs). Ver docs/arquitectura/convenciones.md.
 *
 * Es imperativo (como alert) para poder llamarlo desde hooks y handlers sin pasar estado:
 * el <AppAlertHost /> montado en index.tsx se suscribe y los muestra de a uno, en orden.
 */

export type AppAlertTone = 'error' | 'warning' | 'info' | 'success';

export interface AppAlertOptions {
  /** Título del cartel. Por defecto depende del tono. */
  title?: string;
  /** Por defecto 'error': la mayoría de los avisos son una acción que no se pudo hacer. */
  tone?: AppAlertTone;
  /** Texto del botón. Por defecto "Aceptar". */
  confirmLabel?: string;
}

export interface AppAlertRequest extends AppAlertOptions {
  id: number;
  message: string;
  resolve: () => void;
}

type Listener = (req: AppAlertRequest) => void;

let listener: Listener | null = null;
// Avisos disparados antes de que el host se monte: se entregan apenas se suscribe.
let pending: AppAlertRequest[] = [];
let nextId = 1;

/** Muestra un aviso de la app. La promesa se resuelve cuando la usuaria lo cierra. */
export function appAlert(message: string, options: AppAlertOptions = {}): Promise<void> {
  return new Promise<void>(resolve => {
    const req: AppAlertRequest = { ...options, id: nextId++, message, resolve };
    if (listener) listener(req);
    else pending.push(req);
  });
}

/** Solo para <AppAlertHost />. Devuelve la función de desuscripción. */
export function subscribeAppAlerts(fn: Listener): () => void {
  listener = fn;
  const queued = pending;
  pending = [];
  queued.forEach(fn);
  return () => { if (listener === fn) listener = null; };
}
