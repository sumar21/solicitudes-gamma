-- Habilita el push de dieta/ayuno por WEBHOOK en TODOS los entornos (incl. PRODUCTIVO).
-- Recrea notify_change_dieta / notify_change_ayuno SIN el `when (new.entorno = 'TESTING')` que tenían
-- en 20260817140100_webhook_notify_change.sql. La función notify_change() queda igual.
--
-- ⚠️ VA JUNTO con WEBHOOK_PUSH_ENTORNOS += 'PRODUCTIVO' en api/cron-enrich-beds.ts. Las dos piezas son
-- EXCLUYENTES por entorno: en los entornos donde el push sale del webhook, el cron (push-utils/Vercel)
-- NO pushea; en el resto, pushea el cron y el trigger NO dispara. Aplicar esta migración ANTES del
-- deploy de Vercel (PASO A del runbook) → el peor caso es un "tin" doble de segundos (inofensivo);
-- el orden inverso daría silencio (noti clínica perdida). Ver docs/historial/runbook-pase-prod-2026-08-24.md.
drop trigger if exists notify_change_dieta on public.dieta_cambios;
create trigger notify_change_dieta
  after insert on public.dieta_cambios
  for each row
  execute function public.notify_change();

drop trigger if exists notify_change_ayuno on public.ayuno_cambios;
create trigger notify_change_ayuno
  after insert on public.ayuno_cambios
  for each row
  execute function public.notify_change();
