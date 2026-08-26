-- Snapshot del tipo de internación del paciente al crear el traslado ("Q" quirúrgica, "C" clínica,
-- etc., de admissionTypeCode/PROGAL). Lo usa notify-push para el aviso de INGRESO QUIRÚRGICO a
-- Enfermería (workflow ITR_TO_FLOOR + tipo_internacion='Q'). Columna aditiva y nullable: no afecta
-- ningún traslado existente ni ninguna query actual.
alter table public.traslados
  add column if not exists tipo_internacion text;
