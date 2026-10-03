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
   `NEW_TICKET` → notifica a azafatas/limpieza como cualquier traslado nuevo. Sigue el ciclo estándar
   (salvo que tenga requisitos reales o la habitación sea compartida con vecino ocupado: entonces queda en
   `Esperando Habitación` hasta que la azafata confirme, §48.5).

## Variante: urgencia / ingreso directo (2026-10-02)

El mismo modal tiene un checkbox **"Urgencia / ingreso directo"** para el paciente que va **directo a la
cama** sin pasar por Admisión y que casi siempre todavía **no está internado en PROGAL** (no hay cama de
origen que elegir). Diseño y decisiones: [arquitectura.md §48.4](../arquitectura/arquitectura.md) y
[decisiones.md §29.4](../arquitectura/decisiones.md).

- **Carga (Coordinación, `crear_pre_ticket`):** nombre y apellido (texto libre, ≥ 3 letras) + **destino**
  (Disponible/En preparación; nunca ITR/Sala de Espera). Sin movimiento ni requisitos.
- **No pasa por `Presolicitud`:** nace directo en **`Por Consolidar`** con `urgencia=true`,
  `paciente_declarado`, `cama_origen = 'Urgencia / Ingreso directo'`, `workflow = PRE_TICKET` y sin
  `codigo_paciente`. No hay circuito de azafata ni "Configurar destino".
- **Aviso:** `PRE_TICKET` "Ingreso por urgencia" a Admisión (mismo permiso `notif_pre_ticket`); los pisos no
  reciben `NEW_TICKET`.
- **Consolidar = vincular:** Admisión usa **"Vincular y consolidar"**, elige al paciente que ya ingresó en
  PROGAL (se sugiere el ocupante de la cama destino) y el ticket queda con `codigo_paciente` y
  `evento_internacion` reales; lo tipeado se conserva en `paciente_declarado`. **Sin vínculo no se consolida**
  (UI + `422` en `api/tickets.ts`).
- **No se edita** (cancelar y recargar); cancelan `cancelar_ticket` o `cancelar_pre_ticket`.
- El aviso de 15 min en `Por Consolidar` (§48.1) también le aplica ("Urgencia pendiente de consolidar").

Además, **el pre-ticket con requisitos reales** (colchón, autólisis… no "Sin requerimiento") ya no se
convierte directo en "Habitación Lista": al "Configurar destino" el traslado queda **`Esperando Habitación`**
y la azafata lo confirma (§48.5).

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
