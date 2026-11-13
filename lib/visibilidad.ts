/**
 * Polls que no corren con la pestaña oculta.
 *
 * Por qué (revisión de costos del 13/11/2026): ~45 PCs dejan MediFlow abierto las 24 h y la mayoría
 * está en segundo plano (minimizada o tapada por otra ventana; Chrome la marca `hidden`). Cada una
 * seguía polleando ~6 veces por minuto aunque nadie la mirara: ~8.600 requests por PC por día, el
 * grueso de la factura de Vercel. Con la pestaña oculta no hay a quién mostrarle nada; al volver se
 * pone al día en el acto (catch-up de useHospitalState).
 *
 * Lo que NO pasa por acá: los traslados (Realtime + red de seguridad de 5 min). Su refetch dispara el
 * "ding" de un traslado nuevo, y ese aviso tiene que sonar también con la pestaña en segundo plano.
 */

export function pestanaOculta(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Un `setInterval` que saltea los tics mientras la pestaña está oculta. Al volver a primer plano, si
 * se salteó alguno, reinicia el intervalo (para no pegarle dos veces seguidas a un endpoint que el
 * catch-up acaba de pedir) y, con `alVolver`, corre una vez en el acto. Devuelve la limpieza.
 */
export function intervaloVisible(
  fn: () => void,
  ms: number,
  { alVolver = false }: { alVolver?: boolean } = {},
): () => void {
  let salteado = false;
  const tic = () => {
    if (pestanaOculta()) { salteado = true; return; }
    fn();
  };
  let id = setInterval(tic, ms);
  const alCambiarVisibilidad = () => {
    if (pestanaOculta() || !salteado) return;
    salteado = false;
    clearInterval(id);
    id = setInterval(tic, ms);
    if (alVolver) fn();
  };
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', alCambiarVisibilidad);
  };
}
