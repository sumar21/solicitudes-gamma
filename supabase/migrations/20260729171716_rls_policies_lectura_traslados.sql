-- Policies de LECTURA (SELECT) para el rol `authenticated`.
-- Un usuario con "pase" válido lee SOLO las filas de su entorno (claim del JWT). Es el mismo
-- alcance que hoy: el GET /api/tickets ya filtra por Entorno_T y el resto (rol/piso) lo filtra
-- el cliente. Sin regresión.
--
-- ESCRITURAS: deliberadamente SIN policy → denegadas para `authenticated`. Van por el backend
-- con la secret key (service_role bypassa RLS), donde ya vive toda la lógica de permisos por
-- acción. Por eso no hay policies de insert/update/delete.

create policy "authenticated lee su entorno" on public.traslados
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

create policy "authenticated lee su entorno" on public.traslado_eventos
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));

create policy "authenticated lee su entorno" on public.traslado_obs
  for select to authenticated
  using (entorno = (auth.jwt() ->> 'entorno'));
