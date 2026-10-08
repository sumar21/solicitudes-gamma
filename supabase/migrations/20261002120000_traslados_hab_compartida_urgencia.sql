-- ══════════════ TRASLADOS — habitación compartida + urgencia / ingreso directo ══════════════
-- Paquete de mejoras de octubre: ítems "Solicitar limpieza OK" (habitaciones compartidas / con
-- requerimiento) y "Excepciones para Emergencias / Ingresos directos".
--
-- Todo ADITIVO y con default: ningún traslado existente cambia y el código viejo ignora las columnas
-- (el proyecto Supabase es compartido TESTING/PRODUCTIVO: se puede aplicar antes de deployar el front).
--
-- hab_compartida   Snapshot: al asignar el destino, la habitación era compartida y la cama contigua
--                  estaba OCUPADA. Fuerza "Esperando Habitación" (la azafata confirma que está armada)
--                  y le muestra el aviso. Ver lib/roomCheck.ts.
-- urgencia         El paciente va DIRECTO a la cama (guardia / ingreso directo) y todavía no está
--                  internado en PROGAL. El traslado nace en "Por Consolidar" con nombre libre y, para
--                  consolidar, Admisión lo vincula a un paciente real (api/tickets.ts lo exige).
-- paciente_declarado  Lo que tipeó Coordinación; se conserva aunque después se vincule al paciente real.
-- evento_internacion  `${EVE_ORIGEN}-${EVE_NUMERO}` del paciente vinculado (null hasta consolidar).
alter table public.traslados
  add column if not exists hab_compartida     boolean not null default false,
  add column if not exists urgencia           boolean not null default false,
  add column if not exists paciente_declarado text,
  add column if not exists evento_internacion text;
