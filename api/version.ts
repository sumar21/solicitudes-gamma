// La versión que corre este despliegue. La pestaña abierta la compara con la suya.
// Sin sesión a propósito: contesta una constante que el login ya muestra. `no-store` para que ningún
// caché (navegador, CDN) esconda un despliegue con una respuesta vieja.
import { APP_VERSION } from '../lib/version.js';

export default function handler(_req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ version: APP_VERSION });
}
