# Plan — Pre-ticket de traslado

Estado: **en desarrollo** (rama `feat/pre-ticket`, desde 2026-08-21).

## Qué es

Un **pre-ticket** es un pedido de cama que carga una **Coordinadora** (rol nuevo, permiso exclusivo)
desde la pantalla Operativa, con lo mínimo: **paciente**, **movimiento** y **requisitos de la nueva
cama**. Admisión lo recibe, **configura el destino** y lo convierte en un traslado normal.

No es una entidad nueva: es **un traslado en una etapa más temprana de su ciclo de vida**. Se
implementa como un **estado nuevo** (`PRESOLICITUD`) en la tabla `traslados` existente → reutiliza
grilla, Realtime, notificaciones y la conversión (que es una simple transición de estado).

## Modelo de datos

| Concepto | Dónde vive |
|---|---|
| Estado del ciclo | `TicketStatus.PRESOLICITUD = 'Presolicitud'` |
| Tipo de traslado (badge) | `WorkflowType.PRE_TICKET = 'PRE_TICKET'` → label "Pre-Ticket" (persiste tras convertir) |
| Movimiento (el "motivo") | `motivo_cambio` — el desplegable de la Coordinadora |
| Requisitos (texto que ve/edita Admisión) | `observaciones` — compuestos como texto |
| Requisitos (estructurado, para medir) | `requisitos_cama text[]` — snapshot al crear, no se toca al editar |
| Precarga desde el paciente | `paciente`, `codigo_paciente`, `cama_origen`+códigos, `financiador` |

`status`/`workflow` son texto libre (sin CHECK) → los valores nuevos no necesitan migración de
constraint. El índice único de cama destino ya excluye filas con `cama_destino IS NULL`, así que un
pre-ticket (sin destino) no genera conflicto 409. Única migración: `requisitos_cama text[]` (aditiva,
nullable) — `supabase/migrations/20260821120000_traslados_requisitos_cama.sql`, aplicada 21/08.

## Movimiento (1 desplegable, 3 opciones)

`MOVIMIENTOS_PRETICKET` en `lib/constants.ts`:
1. Solicitud a internación general
2. Movimiento dentro de área crítica — UCO
3. Movimiento dentro de área crítica — UTI

## Requisitos de cama (5 checkboxes, iguales para los 3 movimientos)

`REQUISITOS_CAMA` en `lib/constants.ts`: Con colchón · Frente al office de enfermería · Diálisis ·
Intento autólisis · **Sin requerimiento** (EXCLUYENTE: al tildarlo destilda los otros y viceversa).

## Roles y permisos

- `crear_pre_ticket` → rol **Coordinadora** (crear).
- `completar_pre_ticket` → **Admisión** (ver el pre-ticket + "Configurar destino" + convertir).
- `notif_pre_ticket` → **Admisión** (push + campanita al crearse el pre-ticket).

Todo data en el ABM (`public.roles` es compartida TESTING/PRODUCTIVO). El rol Coordinadora se crea
tildando módulo Operativa + `crear_pre_ticket`.

## Flujo

1. **Coordinadora crea** (botón "Pre-ticket" en Operativa, gate `crear_pre_ticket`) → `PreTicketModal`:
   paciente (selector de camas ocupadas con búsqueda; precarga obra social + origen), movimiento
   (dropdown), requisitos (checkboxes), observación libre opcional. POST inserta traslado con
   `status = 'Presolicitud'`, `workflow = 'PRE_TICKET'`, sin destino.
2. **Notificación a Admisión**: el trigger `notify_push_traslados` dispara `notify-push`, que al ver
   `status === 'Presolicitud'` (INSERT) emite el tipo `PRE_TICKET` (permiso `notif_pre_ticket`) → llega
   solo a Admisión (excluye a la Coordinadora que lo creó). Push + campanita.
3. **Aparece arriba de todo**: los `Presolicitud` se pinnean al tope de la grilla y son visibles solo
   para quien tenga `crear_pre_ticket` o `completar_pre_ticket` (Coordinadora + Admisión); las
   azafatas no los ven.
4. **Admisión "Configura destino"**: modal prefill (paciente/origen/movimiento/requisitos en
   solo-lectura) donde elige **Destino** y puede ajustar la **observación**. Al confirmar, PATCH
   transiciona `Presolicitud` → `Habitacion Lista`/`Esperando Habitacion` (según estado de la cama
   destino, misma lógica que un alta normal).
5. **Se convierte**: al pasar de `Presolicitud` a estado vivo, `notify-push` lo trata como
   `NEW_TICKET` → notifica a azafatas/limpieza como cualquier traslado nuevo. Sigue el ciclo estándar.

## A verificar / riesgos

- **Orden de deploy (crítico)**: la Edge Function `notify-push` y el frontend deben salir **juntos**.
  Con la función vieja, un pre-ticket notificaría a las azafatas como ticket normal.
- Constraint de `status`/`workflow`: confirmado texto libre (sin CHECK). ✅
- Índice de conflicto de destino tolera `cama_destino` NULL. ✅

## Config no-code (post-merge)

- Crear rol **Coordinadora** (módulo Operativa + `crear_pre_ticket`).
- Asignar `completar_pre_ticket` + `notif_pre_ticket` a **Admisión**.
- Reasignar un usuario a Coordinadora impacta recién al re-loguear.

## Fases

1. **Data + permisos + ABM** — ✅ hecha (types, constants, permissions, ABM, migración).
2. **Coordinadora** — `PreTicketModal` + acción `createPreTicket` + push `PRE_TICKET` a Admisión.
3. **Admisión** — grilla (pin + visibilidad) + "Configurar destino" → conversión + `NEW_TICKET`.
4. **Pulido** — StatusBadge (✅), campanita, help, docs + QA end-to-end en TESTING.
