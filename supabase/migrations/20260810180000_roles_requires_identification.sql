-- ══════════════ ROLES · flag "requiere identificación" (cuentas compartidas) ══════════════
-- Ciertos roles son CUENTAS COMPARTIDAS (ej. "Azafata Piso 5"): al loguearse, la persona real
-- se identifica con su nombre (texto libre), que queda vigente en la sesión y se registra como
-- "operador" en las transacciones. En el medio de la jornada puede hacer "cambio de turno" sin
-- desloguear. Este flag marca qué roles lo exigen. Calca a filter_by_floors / bypass_location_check.
alter table public.roles
  add column if not exists requires_identification boolean not null default false;
