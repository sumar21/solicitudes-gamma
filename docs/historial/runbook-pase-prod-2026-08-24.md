# Runbook — Pase a PROD "todo junto" (2026-08-24)

Pase completo develop→main **con flip de flags a PRODUCTIVO**: cirugía, pre-ticket, limpiezas,
**enrich→Supabase** y **push de dieta/ayuno por webhook**, todo en una misma ventana.

Regla de oro: "todo junto" ≠ "todo en el mismo instante". Los pasos tienen un **orden obligatorio**.
Elegí una **ventana de baja actividad clínica** (no pico).

---

## Fase 0 — Pre-requisitos (verificar ANTES de tocar nada)

| Check | Estado | Cómo |
|---|---|---|
| `ENTORNO=PRODUCTIVO` en Vercel prod | ✅ verificado | 2089 traslados PROD, último hoy |
| Edge Function `notify-push` deployada = repo | ✅ v13 | list_edge_functions |
| Edge Function `notify-change` deployada = repo | ✅ v10 (maneja cirugia_eventos/cambios) | get_edge_function |
| Secret del webhook sincronizado (Edge + `webhook_config`) | ✅ cerrado | 401 sin header en ambas funciones |
| VAPID + SUPABASE creds en Vercel prod | ⬜ confirmar (prod corre desde 07-30, deberían estar) | — |
| **[Cliente]** ABM: `notif_cirugia_*` a roles + pre-ticket (crear→Coordinadora, completar+notif→Admisión) | ⬜ lo hacen ellos | ABM. Impacta al **re-login** |
| Queries de monitoreo a mano | ⬜ | ver Fase 4 |

> Sin los permisos del ABM, cirugía y pre-ticket **no notifican**. Puede hacerse justo antes o
> después del merge (el resync es al re-login del usuario).

---

## Fase 1 — Preparar el código en `develop` (antes del merge)

Cambios a incluir en el merge (se preparan y se pushean a develop):

1. **`api/enrich-store.ts`** — flip de enrich:
   - `ENRICH_WRITE_SUPABASE = ['TESTING','PRODUCTIVO']`
   - `ENRICH_READ_SUPABASE  = ['TESTING','PRODUCTIVO']`
   - Seguro porque el read tiene **fallback a SP**: con `enrich_camas` vacía, el mapa se llena
     de SharePoint (`fillEnrichMapFromSP`, onlyMissing) y se va poblando Supabase con el dual-write.
2. **`api/cron-enrich-beds.ts`** — flip del push dieta/ayuno:
   - `WEBHOOK_PUSH_ENTORNOS = ['TESTING','PRODUCTIVO']`
3. **Nueva migración** `..._notify_change_all_entornos.sql` — recrea `notify_change_dieta` y
   `notify_change_ayuno` **SIN** el `when (new.entorno = 'TESTING')` (para que disparen en PROD).
4. **(Recomendado — cierra B7)** hardening en `api/enrich-core.ts`/`gamma-client.ts`: validar que el
   evento de Gamma trae `DIETAS`/`AYUNOS` antes de pisar el enrich. Ahora que PROD **lee** de Supabase,
   un 200-parcial de Gamma podría escribir un enrich sin dieta y leerlo como falso "sin dieta".
5. Bump de `lib/version.ts` + `tsc --noEmit` + `npm run build` + scan NBSP/cirílico.
6. `git push origin develop`.

---

## Fase 2 — Secuencia del pase (ORDEN EXACTO)

El único punto delicado es dieta/ayuno: dos piezas (trigger en la DB + constante en Vercel) que no se
aplican en el mismo instante. **Regla: preferir un "tin" doble breve (inofensivo) antes que silencio
(noti perdida).** Por eso la migración va PRIMERO.

```
PASO A. Aplicar la migración de triggers (MCP apply_migration).
        → El webhook YA puede disparar dieta/ayuno en PROD.
        → Vercel todavía es el viejo (cron también pushea) → arranca un "tin" DOBLE (ok, inofensivo).

PASO B. Merge develop→main  (git checkout main; git merge --ff-only develop; git push origin main).
        → Vercel PROD buildea ~3-5 min y va LIVE. Al ir live, de una:
          · WEBHOOK_PUSH_ENTORNOS incluye PROD  → el cron DEJA de pushear dieta/ayuno (webhook queda único). Cierra el "tin" doble.
          · enrich flags flipeados             → dual-write arranca + lectura de Supabase (con fallback a SP).
          · cirugía / pre-ticket / limpiezas   → código live.
```

Ventana de "tin" doble en dieta/ayuno = desde PASO A hasta que Vercel va live (~3-5 min). Como dieta/ayuno
no cambian cada segundo, es despreciable. **Nunca hay silencio** con este orden.

> Las Edge Functions **no se redeployan** en este pase (ya están en la versión correcta).

---

## Fase 3 — Verificación post-deploy (subsistema por subsistema, EN ORDEN)

Apenas Vercel esté live (badge de versión = la nueva). Verificar en este orden para aislar culpables:

1. **Traslados/pre-ticket**: crear un pre-ticket de prueba → Admisión recibe **una** noti, sin
   "Modificación de Solicitud" fantasma. Configurar destino → una "Nueva Solicitud".
2. **Cirugía**: correr una operatoria de prueba (alta → cada paso) → **1 campanita + 1 push por paso**,
   actor excluido, un doble-tap da 409 sin duplicar.
3. **Dieta/ayuno**: forzar un cambio de dieta → **UN** push (no doble, no cero). Confirmar en
   `net._http_response` que el llamado dio 200.
4. **Enrich**: el mapa de camas muestra dieta/ayuno/aislamiento bien (vía fallback SP mientras
   `enrich_camas` se llena). A los ~30 min, confirmar que `enrich_camas` tiene filas PRODUCTIVO.
5. **Monitoreo continuo** (primeras horas): `net._http_response` sin códigos ≠ 200.

---

## Fase 4 — Monitoreo (queries)

```sql
-- Salud de los push de las últimas 3 horas: querés SOLO status_code = 200
select status_code, count(*) as llamados, max(created) as ultimo
from net._http_response
where created > now() - interval '3 hours'
group by status_code order by status_code;

-- Detalle de fallos (401 = secret desincronizado; 5xx/error_msg = hipo de la Edge)
select id, status_code, error_msg, created
from net._http_response
where created > now() - interval '3 hours' and (status_code is null or status_code <> 200)
order by created desc limit 50;

-- Enrich poblándose en PROD (correr a los ~15-30 min)
select entorno, count(*) from public.enrich_camas group by entorno;

-- Cirugía naciendo en PROD
select entorno, count(*) from public.cirugia_traslados group by entorno;
```

---

## Fase 5 — Rollback (si algo se rompe)

1. **Rollback total (más rápido)**: revertir el merge → redeploy del main anterior en Vercel.
   Los flags vuelven a `['TESTING']` (son código) → enrich y dieta/ayuno vuelven al path legacy.
   - **Seguro para enrich**: el dual-write nunca dejó de escribir SP, así que **SP siempre fue la
     fuente de verdad completa** → revertir el read-flip no pierde datos.
2. **Solo dieta/ayuno mal (doble persistente o silencio)**: revertir la migración de triggers
   (volver a poner el `when (new.entorno='TESTING')`) y/o revertir el deploy de la constante.
3. **Cirugía / pre-ticket rotos**: son features aditivas; si fallan, revertir el merge. No hay dato
   que migrar de vuelta.

---

## Resumen en 4 líneas
1. Preparar código en develop (2 flags + 1 migración + B7 + bump).
2. Aplicar la migración de triggers (MCP) → arranca "tin" doble breve.
3. Merge → Vercel live → cierra el doble, enrich flipeado, cirugía/pre-ticket live.
4. Verificar subsistema por subsistema, monitorear `net._http_response`. Rollback = revertir el merge.
