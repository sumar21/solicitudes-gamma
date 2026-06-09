/**
 * Entorno de la app expuesto al frontend.
 *
 * `__APP_ENTORNO__` lo inyecta Vite (vite.config.ts → define) leyendo la MISMA
 * variable `ENTORNO` del entorno / .env.local que usa el backend. Única fuente de
 * verdad: no hay una variable separada del front que pueda quedar desincronizada.
 *
 * `IS_TESTING` controla el branding de "entorno de prueba" (sidebar ámbar + pills).
 * Producción queda intacta: si ENTORNO no es exactamente "TESTING", IS_TESTING = false.
 */
declare const __APP_ENTORNO__: string | undefined;

// typeof-guard: si Vite todavía no reinició (sin `define`), la global no existe.
// Así evitamos un ReferenceError (pantalla blanca) y caemos a '' = producción.
export const ENTORNO: string = (typeof __APP_ENTORNO__ === 'string' ? __APP_ENTORNO__ : '').trim();
export const IS_TESTING: boolean = ENTORNO.toUpperCase() === 'TESTING';
