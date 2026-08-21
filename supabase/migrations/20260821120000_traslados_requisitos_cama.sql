-- ══════════════ PRE-TICKET DE TRASLADO — requisitos de cama ══════════════
-- Feature pre-ticket (Coordinadora pide cama → Admisión configura destino). Ver docs/planes/pre-ticket.md.
--
-- La Coordinadora tilda requisitos de la nueva cama (Con colchón, Frente al office, Diálisis,
-- Intento autólisis, Sin requerimiento). Se guardan estructurados acá PARA MEDIR (no depender de
-- parsear el texto libre de `observaciones`, donde también se componen para que Admisión los lea).
-- Se escribe una sola vez al crear el pre-ticket y NO se toca al editar la observación.
--
-- Columna nullable y aditiva: no afecta ningún traslado existente ni ninguna query actual.
-- Estado 'Presolicitud' y workflow 'PRE_TICKET' NO necesitan migración: status/workflow son text
-- libre (sin CHECK) y el índice único de cama destino ya excluye filas con cama_destino IS NULL.
alter table public.traslados
  add column if not exists requisitos_cama text[];
