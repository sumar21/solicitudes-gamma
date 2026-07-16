# MediFlow — Planificación de comandas + carga por turno con acompañantes

> ## ✅ ESTADO: IMPLEMENTADO (2026-07-15)
>
> Este documento nació como plan. **Se implementó casi todo**; lo que sigue vale como registro de
> decisiones. Lo que cambió respecto del plan original:
>
> | Cambio | Por qué |
> |---|---|
> | ❌ **`DiaComanda_D` DESCARTADO** | El plan lo metía en Fase 2 para arreglar que el upsert pisa la comanda de ayer. Es un **bug preexistente que el usuario no pidió arreglar** — quedó fuera de alcance. Ver "Deuda conocida" abajo. |
> | ❌ **Fase 4 sin arrastre** | El usuario definió carga de cero cada día (ver D14/P3). |
> | ✅ **Fase 0 corrigió un supuesto** | El site de SP está en **UTC-7**, no en ART. Ver D2. |
> | ⚠️ **`@types/react` NO está instalado** | Ver "Deuda conocida". Cambia cuánto vale un `npm run lint` verde. |
>
> ### 🔴 Deuda conocida #1 — `@types/react` no está instalado
>
> `package.json` tiene `@types/node` y `@types/web`, pero **no `@types/react`**. Consecuencia:
> `import React from 'react'` → `React` es `any` → `React.FC<Props>` es `any` → **las props de
> TODOS los componentes son `any`**.
>
> **`npm run lint` NO chequea las props de ningún componente del repo.** Se detectó en vivo:
> se cambió la forma de `Bed.meals` (`MealLoad` → `MealSlotLoad`) y `tsc` no marcó **ninguno** de
> los 3 sitios que rompía. Se encontraron a mano.
>
> Lo que SÍ chequea: constantes y helpers a nivel de módulo (por eso el `Record<MealSlot, string>`
> de `MEAL_PILL_CLS` sí fuerza exhaustividad — esa red es real).
>
> **Implicancia práctica:** un `lint` verde en este repo NO significa que el front esté bien tipado.
> Instalar `@types/react` probablemente destape muchos errores preexistentes; es un laburo aparte.
>
> ### 🟡 Deuda conocida #2 — la comanda de ayer se pisa
>
> El upsert de `api/dietas.ts` busca por `(CamaLabel_D + Comida_D + Status_D='Activo')` **sin día**.
> Cargar el almuerzo del martes **PATCHea la fila del lunes**: la comanda del lunes deja de existir.
> El GET de "hoy" filtra por `artDay(FechaCarga_D) === hoy`, así que el día a día **se ve bien** —
> pero el tab **Histórico** no es un histórico real: es "filas cuya última edición cayó en el rango".
>
> Se arregla con una columna `DiaComanda_D` (Texto indexado) en la clave del upsert.
> **Decisión del usuario: fuera de alcance por ahora.**
>
> ### 🟡 Deuda conocida #3 — el dev-server no lee `.env`
>
> `dev-server.ts` solo carga `.env.local`, que **no existe** (el repo tiene `.env`). Arranca sin
> ninguna variable → sin `JWT_SECRET` ni credenciales de SP. Workaround: `set -a && . ./.env && set +a && npx tsx dev-server.ts`.

**Documento de workflow anclado al código real.** Consolida el diseño de las 5 fases con las correcciones de revisión aplicadas. Todo lo que dice "hoy" está verificado contra el repo con `archivo:linea`.

---

## 1. Estado actual

### Lo que YA existe

| Qué | Dónde | Detalle |
|---|---|---|
| Vista del módulo Comandas | `views/ComandasManagementView.tsx` | 305 líneas, **solo lectura**. 2 tabs: "De hoy" (deriva de `bed.meals`, no pega a la API — `:69-88`) e "Histórico" (`GET /api/dietas?history=1` — `:103-131`). Exporta PDF con jsPDF (`:136-161`). |
| Endpoint único de comandas | `api/dietas.ts` | 263 líneas. GET hoy / GET history / POST upsert / PATCH soft-delete. `LIST_ID = DIETAS_LIST_ID ?? '891ddeb5-...'` = **15.CargaComandas** (`:22`). |
| Carga de comanda en la tarjeta | `views/BedsView.tsx:175-275` | `MealSlotEditor`. 2 turnos, selector de 2 botones, input detalle, textarea obs, guard anti-poll (`:188-199`). |
| Pill de tipo compartido | `views/BedsView.tsx:170-173` | `comandaTipoPill` — ya lo importa `ComandasManagementView.tsx:4`. |
| Datepicker (primitivo) | `components/ui/calendar.tsx:6-12` | API mínima `{selected, onSelect}`, emite `'YYYY-MM-DD'` construido por partes (`:48`). Sin min/max, sin disabled. |
| Modal (primitivo propio) | `components/ui/dialog.tsx` | No es radix. Escape a nivel document (`:64-71`), `overflow: clip` + `isolation: isolate` (`:88`). |
| Molde CRUD 4 verbos | `api/roles.ts:1-164` | Único endpoint del repo con GET/POST/PATCH/DELETE + soft-delete. |
| Resolución de rol server-side | `api/tickets.ts:359-372` | `getUserAreasById(userId)` → `perfil` → `getRoleByName` → 403. |
| Segregación por Entorno + `esc()` | `api/limpiezas.ts:25-30` | `ENTORNO = process.env.ENTORNO ?? 'TESTING'`. |
| Rango de fechas en JS (no OData) | `api/dietas.ts:89-92`, `api/limpiezas.ts:53-56` | Regla documentada del repo. |
| Colapsable ad-hoc (precedente) | `views/RoleManagementView.tsx:114-122` | `expandedGroups: Set<string>`. |

### Lo que NO existe (verificado por grep, 0 hits)

| Falta | Consecuencia |
|---|---|
| **Cualquier referencia a 16.CargaMenu** | `'CargaMenu'`, `'f6720c30'`, `'_CM'`, `'planificacion'` → 0 hits. Toda la Parte 1 es greenfield. |
| **DESAYUNO / MERIENDA** | `COMIDAS = ['ALMUERZO','CENA']` (`api/dietas.ts:27`), `type MealSlot = 'almuerzo'\|'cena'` (`types.ts:141`), `MEAL_SLOTS` con 2 items (`BedsView.tsx:161-164`). |
| **Concepto de TURNO** | Solo existe `Comida_D` con 2 valores. |
| **ACOMPAÑANTE** | `grep -i 'acompan\|companion\|invitado'` → 0. Ni columna, ni tipo, ni UI. |
| **"Otros" seleccionable** | El selector solo pinta `['MENU','OPCION']` (`BedsView.tsx:241`). `OTROS` se **impone** por dieta vía `forceOtros` (`:183`). |
| **Boxes colapsables** | `MealSlotEditor` renderiza siempre expandido. No hay Accordion/Collapsible en `components/ui/`. |
| **Autocompletado / plantilla** | `detalle` se inicializa solo de `meal?.detalle` (`BedsView.tsx:185`). |
| **Fecha de negocio en 15.CargaComandas** | No hay `Fecha_D`/`DiaComanda_D`. El "día" se deriva de `artDay(FechaCarga_D)` en JS (`api/dietas.ts:129-133`), y `FechaCarga_D` se **reescribe** en cada update (`:180`). |
| **Validación de solapamiento de rangos** | 0 precedentes. |
| **Permisos del módulo Gestión Comandas** | `PERMISSION_GROUPS` solo declara módulos: Operativa, Gestion Limpieza, Mapa de Camas, Configuracion, `__cross__` (`RoleManagementView.tsx:46,59,65,72,79`). `cargar_dieta`/`ver_dieta` viven bajo **Mapa de Camas** (`:65-70`). |
| **Enforcement de permisos server-side** | `grep -rn 'permissions.includes' api/` → **1 hit**, `api/push-utils.ts:221` (relevancia de push, no authz). Ningún endpoint enforcea permisos hoy — ni `api/roles.ts`. |
| **Tests del módulo** | 0. |

### Bugs latentes que este feature activa

> ✅ **Los 4 primeros (todo el cluster del "turno binario") están ARREGLADOS** — 2026-07-15, fix independiente
> previo a Fase 2. Se introdujo un **catálogo único** `MEAL_SLOTS` en `types.ts` (D1) del que se derivan el tipo
> `MealSlot`, el mapeo bidireccional (`spFromMealSlot` / `mealSlotFromSp`), los labels y la validación del endpoint
> (`api/dietas.ts` importa `MEAL_SLOTS_SP`). **Ningún archivo enumera ya `almuerzo`/`cena` a mano.**
>
> **Verificado, no asumido:** se agregó `desayuno` al catálogo de forma temporal y (a) `tsc` **frenó** con
> `TS2741: Property 'desayuno' is missing in type ... Record<"desayuno"|"almuerzo"|"cena", string>`
> (el `MEAL_PILL_CLS` fuerza exhaustividad), y (b) un test de runtime confirmó `spFromMealSlot('desayuno') = 'DESAYUNO'`
> mientras el ternario viejo daba `'CENA'`. Round-trip SP↔app OK; valores desconocidos → `null` sin inventar.
>
> **Consecuencia para Fase 2:** agregar Desayuno y Merienda es **una línea en el catálogo**; el compilador señala
> todo lo que haya que completar. El paso 5 de Fase 2 (arreglar el ternario) **ya no hace falta**.

| Bug | Ref | Qué pasa |
|---|---|---|
| ~~**Ternario binario de turno**~~ ✅ | `hooks/useHospitalState.ts:690`, `:721` | ~~`comida === 'almuerzo' ? 'ALMUERZO' : 'CENA'` → un desayuno se guarda y se borra como CENA.~~ **Arreglado:** ahora `spFromMealSlot(comida)`. |
| ~~**Mapeo inverso falla safe**~~ ✅ | `hooks/useHospitalState.ts:653` | ~~Enmascaraba el bug anterior.~~ **Arreglado:** `mealSlotFromSp()`. El `continue` se conserva a propósito (una fila con `Comida_D` desconocido **debe** descartarse), pero ya no tapa nada porque el forward mapping no puede errar. |
| ~~**Claves fijas enumeradas a mano**~~ ✅ | 6 sitios | **Eliminados.** `Bed.meals` es `Partial<Record<MealSlot, MealLoad>>`; los recorridos usan `MEAL_SLOTS`. Barrido con grep: 0 hits fuera del catálogo. |
| ~~**Pill de comida binario**~~ ✅ | `ComandasManagementView.tsx:28-31` | **Arreglado:** `MEAL_PILL_CLS: Record<MealSlot, string>` → `tsc` exige color por turno nuevo. Turno desconocido → pill neutro con el crudo, sin etiquetarlo "Cena". |
| **`$top=1000` sin paginar** | `api/dietas.ts:105` | Es tamaño de página, no tope. El GET history sí pagina (`:62-71`); el de hoy no. |
| **Duplicado por fallo transitorio** | `api/dietas.ts:169` | Si el lookup de existencia falla (`!existing.ok`), el código **cae al POST** (`:187`) y crea una fila duplicada activa. `fetchMeals` la enmascara con last-one-wins (`useHospitalState.ts:663`). |
| **Reversión muda** | `useHospitalState.ts:702-705` | `saveMealLoad` ignora el body del error y solo llama `fetchMeals()`. El usuario ve su carga "revertirse sola" sin mensaje. |

---

## 2. Modelo de datos

### 16.CargaMenu — PLANIFICACIÓN (plantilla)

`id = f6720c30-aecb-4e7e-ad50-2ba108498bd3`, creada 2026-07-15, **0 filas**.

| Columna | Tipo | Uso | Notas |
|---|---|---|---|
| `Title` | Texto | `'[sumar]'` siempre | Convención del repo |
| `Turno_CM` | Texto ✅ indexada | `DESAYUNO\|ALMUERZO\|MERIENDA\|CENA` | Validado en el endpoint, no en SP |
| `Tipo_CM` | Texto ✅ indexada | `MENU\|OPCION` | **Sin OTROS** — ver decisión D5 |
| `FechaInicio_CM` | **Fecha (date-only)** ✅ indexada | día calendario | ⚠️ Ver decisión D2 |
| `FechaFin_CM` | **Fecha (date-only)** ✅ indexada | día calendario | ✅ Migración Texto→Fecha **hecha** (verificada 2026-07-15) |
| `Comanda_CM` | Texto | el texto del menú | ⚠️ **single-line, maxLength 255** (ver pregunta P5) |
| `Status_CM` | Texto libre ✅ indexada | `Activo\|Inactivo` | ⚠️ No es Choice → sin red contra typos |
| `Entorno_CM` | Texto ✅ indexada | `PRODUCTIVO\|TESTING` | |
| `NombreUserCarga_CM` | Texto | auditoría | |
| `UserID_CM` | **Número** | auditoría | ⚠️ Rechaza string vacío → guard obligatorio |
| `FechaCarga_CM` | Fecha y hora | instante de alta/modificación | ISO UTC completo |

**Cambios de esquema propuestos:**

| Cambio | Por qué | Fase |
|---|---|---|
| `FechaBaja_CM` (Fecha y hora) | Paridad con `FechaCierre_D` / `FechaCierre_L`. Hoy el soft-delete no deja timestamp de cuándo. | 1 |
| ~~Indexar `Status_CM` + `Entorno_CM`~~ | ✅ **YA HECHO** — ver abajo. | ~~0~~ |

> ✅ **RESUELTO (verificado por Graph el 2026-07-15).** Se re-leyó el esquema real de la lista:
> - `FechaFin_CM` **ya es `Fecha`** (la migración Texto→Fecha está hecha).
> - Hay **6 columnas indexadas**: `FechaInicio_CM`, `FechaFin_CM`, `Turno_CM`, `Tipo_CM`, `Status_CM`, `Entorno_CM`.
>
> Cubren la totalidad del `$filter` de vigencia (`Status + Entorno + Turno + Tipo + rango`), así que el
> `HonorNonIndexedQueriesWarningMayFailRandomly` deja de ser una ruleta. SP admite hasta 20 índices por lista.
> **Los ítems de esquema/índices de la Fase 0 quedan cerrados**; lo único que sigue abierto ahí es confirmar
> el `maxLength` real de `Comanda_CM` (ver P5) y el `ENTORNO` de Vercel prod (riesgo #5).

### 15.CargaComandas — EJECUCIÓN (instancia)

`id = 891ddeb5-3610-4a25-b6c0-512eb8e1648b`. Sufijo `_D` (el código la llama "15.CargasDieta" en comentarios — `api/dietas.ts:2` — pero `LIST_NAME` real es 15.CargaComandas, `scripts/create-dietas-list.mts:29`).

Columnas existentes: `CamaLabel_D`✅, `CamaCodigo_D`, `Habitacion_D`, `Area_D`✅, `PacienteNombre_D`, `PacienteCodigo_D`, `Comida_D`, `Tipo_D`, `Detalle_D`, `Observaciones_D`, `Status_D`✅ (Choice), `NutricionistaID_D` (Número), `NutricionistaNombre_D`, `FechaCarga_D`, `FechaCierre_D`, `Entorno_D`✅, `Title`. (✅ = indexada)

**Cambios de esquema propuestos:**

| Columna nueva | Tipo | Por qué | Fase |
|---|---|---|---|
| **`DiaComanda_D`** | **Texto INDEXADO**, `'YYYY-MM-DD'` ART | Hoy no existe fecha de negocio: el upsert por (cama+comida) **pisa la fila de ayer** y el "día" se deriva de `artDay(FechaCarga_D)` (`api/dietas.ts:129-133`), un timestamp de auditoría reescrito en cada update (`:180`). Eso contradice frontalmente la semántica que definiste ("la comanda real de CADA PACIENTE, CADA DÍA"). Y sin él, Fase 4 no tiene techo. Ver **D7**. | 2 |
| `Comensal_D` | Texto | `TITULAR\|ACOMPANANTE`. Vacío = TITULAR (retro-compat). | 4 |
| `OrdenComensal_D` | Texto | `'0'` titular, `'1'..'N'` acompañantes. Identidad, no posición. | 4 |

**El turno NO necesita columna nueva.** `Comida_D` ya es Texto libre y el script lo justifica textualmente (`scripts/create-dietas-list.mts:48-52`): *"Comida_D y Tipo_D son TEXTO (no Choice) a propósito: los valores válidos los valida api/dietas.ts (única fuente de verdad), no SP. Así sumar DESAYUNO/MERIENDA o menús planificados a futuro es solo cambiar código, sin migrar la columna."* El dominio nuevo es un **superset** del viejo → cero migración, las filas ALMUERZO/CENA siguen válidas.

### Relación plantilla → instancia

```
16.CargaMenu  (Turno_CM + Tipo_CM + [FechaInicio_CM..FechaFin_CM])  →  Comanda_CM
                                    │
                        COPIA POR VALOR al elegir Menú/Opción
                                    ↓
15.CargaComandas  (CamaLabel_D + Comida_D + DiaComanda_D + Comensal_D + Orden)  →  Detalle_D (editable)
```

No hay link vivo. Editar una planificación **no** reescribe lo ya cargado (ver P4).

**Mapeo de vocabulario — contrato duro:**

| Concepto | 16.CargaMenu | 15.CargaComandas | Front |
|---|---|---|---|
| Turno | `Turno_CM` = `'ALMUERZO'` | `Comida_D` = `'ALMUERZO'` | `MealSlot` = `'almuerzo'` |
| Tipo | `Tipo_CM` = `'MENU'` | `Tipo_D` = `'MENU'` | `'MENU'` |
| Texto | `Comanda_CM` | `Detalle_D` | `detalle` |

MAYÚSCULAS sin tildes en SP, minúsculas en el front. Si Fase 1 guarda `'Almuerzo'`/`'Menú'` (como los muestra el desplegable), el lookup **nunca matchea** y el síntoma es mudo: *"siempre dice que no hay comanda planificada"*.

---

## 3. Decisiones técnicas

### D1 — Catálogos: `as const` arrays en `types.ts`, importados por front y api

**Qué.** `export const TURNOS = ['DESAYUNO','ALMUERZO','MERIENDA','CENA'] as const; export type Turno = typeof TURNOS[number];` idem `TIPOS_PLAN`, `MEAL_SLOTS`, `COMENSALES`. `api/` los importa con `from '../types.js'`.

**Por qué.** Es el patrón vivo del propio `types.ts` (`PERMISSIONS` en `:155-171`, `ROLE_MODULES` en `:175`) y `docs/convenciones.md:2134` lo endosa explícitamente: *"Alternativa descartada — enum: los enums TypeScript son más pesados... Para catálogos puramente declarativos, `as const` arrays + `typeof[number]` es más idiomático."* Y **api/ SÍ puede importar `types.ts`**: `api/tickets.ts:12` ya hace `import { Ticket, TicketStatus, ... } from '../types.js'`. No es una apuesta.

> El mito a matar: *"api/ no puede importar de lib/"*. La restricción real es más chica — `lib/fasting.ts:19` importa `from '../types'` **sin extensión**, y eso sí rompe el build de api/. `types.ts` no importa nada, es dual-consumable.

**Alternativas.** (a) `enum Turno` — descartado, `convenciones.md:2134` lo descarta y no se itera limpio para poblar selectores. (b) Duplicar las constantes en `api/dietas.ts` (como hace hoy con `COMIDAS`/`TIPOS`) — descartado: es exactamente la deuda que causó el bug del ternario binario.

---

### D2 — Fechas: dos helpers distintos, y `artDay()` está **prohibido** sobre date-only

**Qué.**

| Caso | Helper | Ejemplo |
|---|---|---|
| **Instante** (`FechaCarga_D`, `FechaCarga_CM`) | `artDay(iso)` = `new Date(iso).toLocaleDateString('en-CA', {timeZone: ART})` | ✅ `api/dietas.ts:33-36` |
| **"Hoy"** | `artToday()` = `new Date().toLocaleDateString('en-CA', {timeZone: ART})` | ✅ nunca `toISOString().slice(0,10)` |
| **Fecha calendaria** (`FechaInicio_CM`, `FechaFin_CM`, `DiaComanda_D`) | `String(f.X ?? '').slice(0,10)` | ✅ nunca por `new Date` |

**Escritura:** `FechaInicio_CM: \`${desde}T12:00:00Z\`` — **mediodía UTC**, no medianoche.

> ### ✅ VERIFICADO CON DATOS REALES (probe de Fase 0, 2026-07-15)
>
> `scripts/probe-cargamenu-dates.mts` escribió el **mismo día** (`2026-07-15`) en 4 formatos contra la lista real
> y leyó lo que devuelve Graph:
>
> | Formato enviado | Crudo que devuelve Graph | `.slice(0,10)` | ¿Día OK? |
> |---|---|---|---|
> | `2026-07-15` (date-only puro) | `2026-07-15T07:00:00Z` | `2026-07-15` | ✅ |
> | `2026-07-15T00:00:00Z` | `2026-07-15T00:00:00Z` | `2026-07-15` | ✅ |
> | **`2026-07-15T12:00:00Z`** | `2026-07-15T12:00:00Z` | `2026-07-15` | ✅ **← el elegido** |
> | `2026-07-15T22:00:00-03:00` | `2026-07-16T01:00:00Z` | `2026-07-16` | ❌ **corre un día** |
>
> **Esquema confirmado:** `FechaInicio_CM` y `FechaFin_CM` son `dateTime(format=dateOnly)`, ambas `indexed=true`.
>
> #### 🔴 Hallazgo que corrige un supuesto de este doc: **el site NO está en hora Argentina**
>
> Escribir `'2026-07-15'` pelado devolvió **`T07:00:00Z`**. SharePoint interpreta una fecha sin hora como
> *medianoche en la zona regional del sitio* → medianoche local = 07:00Z ⇒ **el site está en UTC-7** (Pacific,
> PDT en julio), **no en UTC-3** como asumía la versión anterior de esta decisión.
>
> Eso **agrava** el problema de la medianoche UTC en vez de mitigarlo: `T00:00:00Z` se renderiza en la UI de SP
> como **14/07 17:00** — la columna muestra el día anterior. El round-trip por Graph da bien (`.slice` ✓, el feature
> anda), así que **el bug es invisible desde la app y solo se ve auditando la lista**. Es exactamente la trampa del
> riesgo #1, con 7 horas de margen en vez de 3.
>
> #### Por qué `T12:00:00Z` y no date-only pelado
>
> Los dos round-tripean bien hoy, pero **el pelado depende de la zona regional del site**: SP lo normaliza a
> medianoche local. Si mañana IT cambia la región a UTC+2, `'2026-07-15'` se guardaría como `2026-07-14T22:00:00Z`
> y `.slice(0,10)` daría **14/07**. `T12:00:00Z` es inmune a cualquier offset de ±11h en ambas direcciones —
> no depende de una config de SharePoint que nadie de este equipo controla.
>
> **Y nunca mandar un offset local** (`-03:00`): quedó demostrado que corre el día (22:00 ART = 01:00Z del día siguiente).

**Por qué.**
- `artDay()` es **correcto** para un instante e **incorrecto** para una fecha calendaria: `'2026-07-15T00:00:00Z'` → `toLocaleDateString('en-CA', {timeZone: ART})` → `'2026-07-14'`. Toda la vigencia se corre un día, y el bug solo aparece en el **primer y último día** de cada rango (invisible en el medio).
- **Medianoche UTC es el peor instante posible** para una columna Fecha: la UI de SharePoint renderiza contra la zona regional del sitio (**medida: UTC-7**). `'2026-07-01T00:00:00Z'` se muestra como **30/06 17:00** → la columna dice 30/06. El round-trip por Graph funciona (`.slice(0,10)` da `'2026-07-01'` ✓, el feature anda), pero negocio abre la lista a auditar y ve todos los rangos corridos un día. `T12:00:00Z` es inmune a cualquier offset de ±11h en las dos direcciones.
- El `Calendar` ya entrega `'YYYY-MM-DD'` construido por partes (`components/ui/calendar.tsx:48`) → el string viaja sin tocar `Date` nunca.
- `.slice(0,10)` tolera los dos shapes (`'2026-07-15'` de columna Texto y `'2026-07-15T12:00:00Z'` de columna Fecha) → cubre la migración en curso de `FechaFin_CM`.

> ⚠️ `.slice(0,10)` protege contra el **formato**, no contra el **off-by-one**. Si SP normalizara contra otra TZ, devuelve el día equivocado en silencio. Por eso Fase 0 es bloqueante.

**Alternativas.** (a) `new Date(desde).toISOString()` como hace todo el repo (`api/dietas.ts:149,180,205`) — descartado: elegir 15/07 a las 22:00 ART genera `'2026-07-16T01:00:00Z'`. (b) `T00:00:00Z` — descartado por lo de arriba. (c) Migrar las columnas a Texto — descartado: se pierde el orden/filtro nativo en la UI de SP, que es donde negocio audita.

---

### D3 — Rango de fechas: se resuelve **en JS**, nunca con `$filter` OData sobre DateTime

**Qué.** El `$filter` contra SP usa **solo** `Status_CM` + `Entorno_CM` (las dos indexadas). Turno, tipo y rango se resuelven en JS sobre `.slice(0,10)`. Header `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly` en todo `$filter`. Paginado por `@odata.nextLink`.

**Por qué.** Es la regla escrita del repo, en dos lugares: `api/limpiezas.ts:53-55` (*"Filtramos en SP solo por Status+Entorno (columnas indexadas) y el rango de fecha en JS — evita el filtro OData sobre DateTime (frágil, columna no indexada)"*) y `api/dietas.ts:60-61` (removieron hasta el `$orderby` por lo mismo). `grep -rE "fields/\w+ (ge|le|gt|lt)"` sobre todo el repo → **0 hits**. No hay precedente que copiar, sería código sin red. Y el volumen es ínfimo (una fila por rango planificado).

Comparación lexicográfica de `'YYYY-MM-DD'` = cronológica (mismo truco que el clamp de `DashboardView.tsx:197,211`).

**Rangos INCLUSIVOS** en ambos extremos: `aDesde <= bHasta && bDesde <= aHasta`. Un rango 01/07→31/07 significa que el 31/07 se sirve ese menú.

**Alternativas.** (a) `fields/FechaInicio_CM le 'X' and fields/FechaFin_CM ge 'X'` — descartado. (b) Copiar la ventana UTC de `api/limpiezas.ts:63-64` (`${from}T00:00:00Z` / `${to}T23:59:59Z`) — **descartado, es un bug latente del repo**: está corrida 3h respecto de ART. `api/dietas.ts:90-91` lo hace bien (por día ART). Copiar el de dietas, nunca el de limpiezas.

---

### D4 — Búsqueda de "planificación vigente": **server-side**, cacheada en dos niveles

**Qué.** `GET /api/carga-menu?vigentes=1[&date=YYYY-MM-DD]` → `{ day, plans }`. El server resuelve "hoy ART", el rango y el desempate. El cliente cachea en `useHospitalState` (Map keyed `${turno}|${tipo}`, poll 5 min). El server cachea en módulo (TTL 5 min) + invalidación explícita desde POST/PATCH/DELETE.

**Por qué.**
- **"Hoy" no puede depender de la TZ del device.** Una tablet mal configurada, o cualquier device entre 21:00 y 00:00 ART, autocompletaría el menú del día equivocado. Este repo ya se quemó con exactamente esto: `docs/decisiones.md:1060` — *"TZ bug: el cron corre en Vercel (UTC), new Date()+setHours(15) daba 15:00 UTC = 12:00 ART, corriendo todo 3hs"*.
- **Cache server-side obligatorio.** Sin él, cada cliente hace un table-scan de 16.CargaMenu cada 5 min. Con ~30 clientes = ~360 scans/hora sobre una lista cuyo set `Status_CM='Activo'` crece monótonamente (un rango vencido queda Activo para siempre). Precedente exacto: `api/role-cache.ts:14,28` (`let cache = null`, `TTL_MS = 5*60*1000`) + `invalidateRoleCache()` (`:75-76`) invalidado desde `api/roles.ts:93,134`.
- ⚠️ **Cache + invalidación van juntos o no van.** Si se agrega el cache server sin invalidar, `refreshMealPlans` (el refresh que dispara el modal al guardar) pega contra un cache stale hasta 5 min y rompe la promesa de "el que edita ve el efecto al instante".
- **Poll de 5 min, no 60s.** La plantilla cambia ~1 vez por día. Cada cliente ya hace 4 polls/min (`POLL_BEDS_MS = 60_000`, `useHospitalState.ts:262`). Un 5º poll/min es carga y superficie de fallo aleatorio a cambio de nada.
- **`deps: [authFetch]` y nada más.** Cualquier dep cambiante re-arma **todos** los `setInterval` del effect (`useHospitalState.ts:790-807`). Precedente correcto: `fetchMeals` solo depende de `authFetch` (`:667`). Por eso "hoy" lo pone el server y no es un param del fetcher.
- **Gate: solo `cargar_dieta`.** Un usuario con solo `ver_dieta` (catering) recibe `canEditMeal=false` (`BedsView.tsx:2330`) y el `MealSlotEditor` hace early-return al modo lectura (`:201`), que por diseño **no autocompleta nada**. Gatearlo con `ver_dieta` sería descargar la planificación cada 5 min para nunca usarla, desde el grupo de usuarios más numeroso.

**Alternativas.** (a) Traer todas las planificaciones y filtrar en memoria del cliente — descartado: reintroduce el bug de TZ en N devices en vez de en 1 server, y el payload crece sin techo. (b) Fetch on-demand al hacer click en Menú/Opción — descartado: pone una query lenta a SP en el hot path de un click (1-3s de espera), multiplicada por tarjeta × turno.

---

### D5 — Tipo_CM admite solo `MENU|OPCION`. **`OTROS` no es planificable**

**Qué.** `TIPOS_PLAN = ['MENU','OPCION'] as const`. El server rechaza `OTROS` con 400. Es un tipo **distinto** de `MealLoad.tipo` (3 valores, `types.ts:134`), no un alias.

**Por qué.** "Otros" significa por definición *"no hay plantilla de cocina, Nutrición escribe la comida específica"*. Planificar un Otros es una contradicción: si el texto es planificable, es un Menú o una Opción. Del lado de la tarjeta, elegir "Otros" es justamente lo que **apaga** el autocompletado. Modelarlos como el mismo tipo invitaría a que Fase 3 busque plantilla para "Otros" y muestre el aviso "no hay comanda planificada" cuando nunca debería buscar. Tipos separados hacen explícita la asimetría en el compilador.

**Alternativas.** Reusar el union de 3 y rechazar en runtime — descartado: deja pasar hasta el server un error que el compilador ataja, y la UI tendría que filtrar el catálogo a mano.

---

### D6 — Acompañantes: **una fila por comensal** en 15.CargaComandas

**Qué.** `Comensal_D` (`'TITULAR'|'ACOMPANANTE'`, vacío = TITULAR) + `OrdenComensal_D` (`'0'`, `'1'..'N'`). Ambas **Texto**. La cardinalidad pasa de "una fila activa por (cama, comida, entorno)" a "una fila activa por (cama, comida, **día**, comensal, orden, entorno)".

**Por qué.** Un acompañante **no es un atributo** de la comanda del paciente: es **otra comanda**, con los mismos 3 campos (tipo + detalle + observaciones) y el mismo ciclo de vida (se crea, se edita, se da de baja sola). Modelarlo como fila es reconocer que ya es la misma entidad. Consecuencias:
- Cocina ve **una fila = una bandeja** — la verdad física del dominio.
- El GET, el histórico y el PDF (`ComandasManagementView.tsx:144-149`) siguen operando sobre filas planas, sin parsers nuevos.
- El soft-delete de un acompañante es el **mismo PATCH** que ya existe (`api/dietas.ts:248-251`).
- Sigue siendo inspeccionable desde la UI de SharePoint — propiedad que `docs/decisiones.md §12.1` declara explícitamente valiosa.
- Los acompañantes heredan `PacienteCodigo_D` del titular → el guard anti-"dieta fantasma" de `mergeBeds` (`useHospitalState.ts:253`) los cubre gratis al reasignar la cama.
- Texto y no Choice/Número: es la convención explícita (`create-dietas-list.mts:48-52`), y `scripts/inspect-dietas-list.mts:35` define `BREAKS = new Set(['number','boolean'])` porque una columna **Número rechaza el string vacío** — de ahí el guard feo que ya arrastra `NutricionistaID_D` (`api/dietas.ts:158-159`).

**Alternativas.**
- **(b) JSON serializado en `Acompanantes_D`** — descartado. Rompe al consumidor principal: catering lee filas planas. El techo de MULTILINE es 500 chars (`create-dietas-list.mts:36`) mientras cada acompañante ya trae detalle 500 + obs 500 → **truncado silencioso** al segundo acompañante. Y el soft-delete por acompañante desaparece: borrar uno es reescribir el blob, perdiendo la auditoría por fila.
- **(c) Lista nueva 17.Acompanantes** — descartado. SP no tiene JOINs: habría que duplicar `CamaLabel_D`/`Comida_D`/`Area_D`/`PacienteCodigo_D`/`Entorno_D`/`Status_D` para poder atacharla, o sea recrear ~80% del esquema de 15 para guardar 3 campos. Suma un fetch, un poll, un Map y un merge nuevos.
- **(d) Separador `';'` estilo §12.1 (aislamientos)** — descartado, y es importante **por qué no aplica**: §12.1 serializa un multi-select de un **enum cerrado sin payload** (`'Covid;Contacto'`), donde el valor no puede contener el separador y el cambio es un toggle atómico. Acá cada acompañante son 3 campos de **texto libre de 500 chars donde el usuario puede tipear `';'`** → el separador es directamente inseguro. Y la ventaja que §12.1 reivindica ("cambios atómicos, un solo PATCH") no existe: los acompañantes se editan y borran de a uno.

**Sub-decisiones:**

| | Decisión | Por qué |
|---|---|---|
| **Alta** | INSERT explícito, nunca upsert por clave natural | Ante una carrera, el upsert **pisa en silencio** un acompañante (alguien se queda sin comer). El INSERT deja **dos filas visibles** en tarjeta/grilla/PDF, borrables con un click. Un duplicado visible > una pérdida silenciosa. |
| **Orden** | `OrdenComensal_D` es **identidad**, no posición. `max(orden del día)+1`, **nunca se renumera** | Renumerar = reescribir N filas sin transacción → fallo parcial deja duplicados o huecos (es el costo que `§12.1` identifica y evita). Con ordinal inmutable, borrar es **un PATCH a una fila**. La UI muestra índice **visual** 1..N recalculado en el render. |
| **Selección del titular** | En **JS** sobre el resultset, no `and fields/Comensal_D eq 'TITULAR'` en OData | Las filas pre-Fase 4 no tienen `Comensal_D`; `eq 'TITULAR'` no las encontraría y `eq null` sobre texto en SP es frágil → el titular "desaparece" y el upsert crea un duplicado. El helper con default TITULAR las cubre **sin depender de que el backfill haya corrido** (misma retro-compat que `api/isolations.ts:23-27`). |
| **Estructura en memoria** | `Bed.meals: Partial<Record<MealSlot, MealSlotLoad>>` donde `MealSlotLoad = { titular?: MealLoad; acompanantes: MealLoad[] }` — **anidada**, no un mapa paralelo | Dos mapas keyed por lo mismo se desincronizan y el que se olvide falla **en silencio** (es el modo de falla de `m.almuerzo \|\| m.cena`). Y `titular` **opcional** no es teórico: `'nada por boca'` está literalmente en `CUSTOM_COMANDA_DIETS` (`lib/utils.ts:255-258`) — paciente en ayuno con acompañante que sí come es un caso real. |
| **Alta en el cliente** | **Draft local**, sin update optimista. El bloque se persiste al Guardar; la fila entra al Map desde la respuesta (que trae `spItemId` **y** `orden`) | El `orden` lo asigna el server → el cliente **no puede** construir la fila optimista correcta; tendría que inventar un tempId y reconciliar, que es la maquinaria frágil que ya revierte mudo (`useHospitalState.ts:676-683, 702-705`). Con drafts no hay nada que reconciliar. |

---

### D7 — `DiaComanda_D`: la clave de upsert incluye el día

**Qué.** Columna `DiaComanda_D` (Texto **indexado**, `'YYYY-MM-DD'` ART). La clave de upsert pasa a `(CamaLabel_D + Comida_D + DiaComanda_D + Comensal_D + Orden + Entorno_D)`. El GET de hoy filtra en OData por `DiaComanda_D eq '<hoyART>' and Entorno_D eq '<E>'` (ambas indexadas) y resuelve `Status_D` en JS.

**Por qué — tres problemas de una:**
1. **Cumple la semántica que definiste.** Hoy la clave es `(cama, comida)` sin día (`api/dietas.ts:163-165`): la comanda de hoy **sobrescribe** la de ayer y solo sobrevive el último `FechaCarga_D`. "La comanda real de cada paciente, cada día" hoy no existe.
2. **Acota Fase 4 por construcción.** Sin él, la RAMA C de acompañantes hace INSERT siempre y **nada cierra esas filas nunca** → crecimiento lineal sin techo (N × 4 turnos × días). Cuando `Status_D='Activo'` matchee >5000 items, SP devuelve un **subconjunto parcial**. Es literalmente el incidente que `api/cron-cleanup-notifs.ts:6-12` documenta para 10.Notificaciones: *"la lista crecía sin tope (>25k filas) y superaba el list-view threshold (5000)... devuelven un subconjunto parcial/viejo que EXCLUYE las filas recientes"*. Modo de falla: **comandas que existen en SP no llegan a la app, sin error, y cocina no manda la bandeja.** La paginación no salva: sin `$orderby` (vetado, `api/dietas.ts:60-61`) no hay garantía de que las filas de hoy caigan en las primeras páginas.
3. **Arregla el `$top` de la resolución de fila.** El lookup del POST filtra por cama+comida sin día; con acompañantes acumulados 30 días, `$top=50` corta y el titular puede caer fuera → se crea un **segundo titular activo** (dos bandejas para el mismo paciente). Con el día en el filtro, el resultset es ≤ 1+MAX por construcción.

**Es Texto y no Fecha** a propósito: `'YYYY-MM-DD'` indexado permite `eq` en OData sin la fragilidad del DateTime, y compara lexicográficamente.

**Alternativas.** (a) Dejarlo como deuda para "Fase 6" — descartado: Fase 4 es la que introduce el crecimiento ilimitado, así que Fase 4 (o antes) lo acota. Descubrirlo con 3 meses de histórico sin la columna no es barato. (b) En RAMA C, cerrar los acompañantes de días anteriores antes del INSERT — mitigación parcial aceptable si se rechaza la columna, pero **no cubre** las camas que nadie vuelve a tocar tras el alta (quedan huérfanas para siempre) → seguiría haciendo falta un cron.

**Costo:** una columna + backfill (`DiaComanda_D = artDay(FechaCarga_D)` sobre las ~800 filas Activo) + cambiar el filtro del GET. Se hace en Fase 2, que ya toca `api/dietas.ts` y `useHospitalState`.

---

### D8 — Anti-solapamiento: **pre-check + 409**, sin post-verify

**Qué.** `POST`/`PATCH` hacen `findOverlaps(turno, tipo, desde, hasta, excludeId?)` y devuelven **409** `{ error, conflicts: [{spItemId, desde, hasta, comanda}] }`. Nada más. La red real la da la **lectura**: `pickVigente` con desempate determinístico.

**Por qué NO el post-verify + loser-backoff.**
- El post-verify se apoya en un `$filter` contra columnas recién escritas. SharePoint tiene **lag de indexado** entre el POST y que la fila vuelva en una query filtrada. Si ambos racers verifican antes de ver la fila del otro, los dos sobreviven → **narrows la ventana, no la cierra**.
- Prometer *"dos escrituras concurrentes terminan con exactamente una fila activa"* como criterio de aceptación es **falso e intesteable**. Peor que no tenerlo: alguien va a confiar.
- El análogo de **mucho más riesgo y concurrencia** (doble asignación de cama destino) se resuelve con pre-check + 409 y nada más — `api/tickets.ts:287-308` y `:377-399`. Es fail-open explícito (`if (conflictRes.ok)`, `:297`, con el comentario *"chequeo no-fatal (fail-open)"*).
- La rama de PATCH del post-verify era la peor: snapshot + reversión, y si la reversión falla queda una fila editada que perdió el desempate **pero no volvió a su valor anterior** — un estado peor que el duplicado.
- ~40 líneas sin precedente, en un repo sin un solo test, para un flujo de backoffice de baja frecuencia cuya concurrencia real es una **pregunta abierta** (P6).

**Desempate de lectura (`pickVigente`) — determinístico, obligatorio:**
1. `FechaInicio_CM` más **tardía** (la más específica: un rango de feriado pisa al rango largo estándar).
2. `FechaCarga_CM` más reciente.
3. `Number(spItemId)` **mayor** — desempate duro.

SP **no garantiza orden** sin `$orderby`, y `$orderby` sobre DateTime no indexado está vetado (`api/dietas.ts:60-61`) → se ordena en JS. Sin esta regla, dos usuarios ven autocompletados distintos para la misma cama/turno/día: el peor tipo de bug (no reproducible). Con ella, un duplicado eventual es **inocuo** para el autocompletado, visible en la grilla, borrable en dos clics.

**Alternativas.** (a) ETag / If-Match de SP — descartado: protege **un item** contra escrituras concurrentes, no un invariante de **conjunto** entre filas distintas. (b) Última-escritura-gana sin 409 — descartado: la grilla mostraría dos planificaciones contradictorias y negocio no sabría cuál rige. (c) Lock en otra lista SP — descartado: agrega un punto de falla (lock huérfano).

> ⚠️ Esta decisión asume **bloqueo duro**. Si negocio necesita "excepción dentro de un rango" (feriado), el modelo cambia — ver **P1**.

---

### D9 — Permisos: `ver_planificacion` + `abm_planificacion`, enforceados server-side por **user-id**

**Qué.**
- Dos códigos nuevos en `PERMISSIONS` (`types.ts:155-171`).
- Grupo nuevo en `PERMISSION_GROUPS` con `module: 'Gestion Comandas'` (valor exacto de `ROLE_MODULES`, `types.ts:175`).
- Gate cliente: `can(currentUser, 'ver_planificacion') || can(currentUser, 'abm_planificacion')`.
- Gate server en POST/PATCH/DELETE → **403**:

```ts
import { getUserAreasById } from './user-cache.js';
import { getRoleByName } from './role-cache.js';

async function userHasPermission(userId: string, perm: string): Promise<boolean> {
  const ua = await getUserAreasById(userId);
  const cfg = ua?.perfil ? await getRoleByName(ua.perfil) : null;
  return !!cfg?.permissions.includes(perm);
}
// call-site:
if (!(await userHasPermission(String(req.user?.id ?? ''), 'abm_planificacion')))
  return res.status(403).json({ error: 'No autorizado' });
```

**Por qué el user-id y NO `req.user.role`.** El JWT **no lleva el `NombreRol_RT`**: `api/auth.ts:141` firma `role: mapRole(perfilU)`, y `mapRole` (`:37-48`) colapsa el `Perfil_U` a un enum grueso (`'ADMIN'|'ADMISSION'|'HOSTESS'|...`). El `NombreRol_RT` crudo vive en `user.roleName` (`:153`), que **no se firma** (`AppTokenPayload`, `api/jwt.ts:14-20`). `getRoleByName` matchea contra `NombreRol_RT` (`api/role-cache.ts:68-73`) → `getRoleByName('NURSING')` devuelve `null` → `false` → **403 para todos, siempre**, incluido el admin. Ese es exactamente el motivo por el que `api/tickets.ts:361-362` usa `getUserAreasById(userId).perfil`.

Bonus: `user-cache` pega a 00.Usuarios por id con TTL 2 min (`api/user-cache.ts:16`) → una reasignación de rol se toma en 2 min, en vez de nunca (los tokens duran **~10 años**: `EXPIRY_DEFAULT '3650d'`, `api/jwt.ts:12`).

**Por qué NO reusar `cargar_dieta`.** Los checkboxes se renderizan **solo si el módulo del grupo está habilitado** en el rol (`RoleManagementView.tsx:42-43`), y `cargar_dieta` vive bajo `'Mapa de Camas'` (`:65-70`) → un rol con "Gestión de Comandas" pero sin "Mapa de Camas" **no puede ni tildarlo**: el botón sería inalcanzable para el rol al que va dirigido. Además su label es *"Cargar comanda / menú (Nutrición)"* — una acción por paciente, no la planificación de la cocina.

**El GET queda abierto** (solo `requireAuth`): el autocompletado (Fase 3) lo consume desde el Mapa de Camas con un usuario de Nutrición que puede no tener `ver_planificacion`. Gatearlo rompe el feature; el dato expuesto es un texto de menú.

**Alternativas.** (a) Solo gate en el cliente — descartado: el endpoint queda escribible por cualquier token válido. (b) Meter `permissions` en el JWT — descartado: un permiso revocado seguiría vivo 10 años. (c) Tres permisos crear/editar/eliminar — descartado: el repo solo desagrega por acción donde el flujo lo exige (Operativa); para un ABM el precedente es uno por CRUD (`abm_roles`, `abm_usuarios`).

> ⚠️ **`api/me.ts` NO es precedente de authz**: toma el `roleName` de un **query param del cliente** (`:26`) — confiar en eso para autorizar sería trivialmente bypasseable. El único precedente real es `api/tickets.ts:359-372` (enforcement por **pisos**). `carga-menu` sería el **primer endpoint del repo que enforcea un permiso server-side**. Deuda a asentar: `api/roles.ts` y `api/users.ts` hoy son solo `requireAuth` — cualquier token válido puede crear roles. No es tarea de este feature, pero que quede escrito.

---

### D10 — El GET falla **duro** (502), no fail-soft

**Qué.** `GET /api/carga-menu` devuelve **502** `{ error: 'sp_unavailable' }` ante fallo de SP. En el cliente, un flag `mealPlansLoaded` distingue "todavía no sé" de "sé que no hay".

**Por qué.** `api/roles.ts:41-44,59-62` devuelven 200 + `{roles: []}` cuando SP falla, enmascarando el error como "no hay datos". Acá esa mentira es **activamente dañina**: la spec pide mostrar *"No hay comanda planificada para este turno y tipo"*, así que un SP caído le diría a Nutrición que no hay planificación y la empujaría a escribir a mano lo que en realidad **sí estaba planificado**. Es la aplicación directa del patrón ya documentado en `convenciones.md` (*"Distinguir fetch falló de dato vacío antes de derivar un evento"*).

> ⚠️ **El 502 no sirve solo.** El fetcher del hook calca `fetchMeals` (`useHospitalState.ts:648`): `if (!r.ok) return;` — tira el status a la basura. En **cold start** con SP caído, el Map queda vacío → `noPlan = true` → aparece el aviso falso, exactamente lo que se quería evitar. **Obligatorio** el flag:

```ts
const [mealPlansLoaded, setMealPlansLoaded] = useState(false);
// en fetchMealPlans:
if (!r.ok) return;           // mantiene el cache, NO toca el flag
setMealPlans(map); setMealPlansLoaded(true);
// en el editor:
const noPlan = mealPlansLoaded && pickedRef.current && (tipo === 'MENU' || tipo === 'OPCION') && !activePlan;
```

Sin el flag, el 502 es ruido en los logs y hay que calcar el 200+`[]` de roles.ts para no dejar una divergencia de patrón que no aporta nada.

---

### D11 — Autocompletado **no destructivo**, atado a intención explícita

**Qué.** El autocompletado se dispara **solo** ante un cambio explícito de tipo (`op !== tipoActual`), **solo** si el campo está *pristine* (vacío, o igual a lo guardado, o igual a lo que puso el propio autocompletado vía `autoRef`), y **siempre** marca `editedRef.current = true`. Todo lo demás va por el botón "Usar planificada".

`noPlan` y `canUsePlan` se atan a un `pickedRef` (true solo dentro de `pickTipo`), no al estado derivado.

**Por qué.**
- **`editedRef.current = true` es obligatorio.** El guard de `BedsView.tsx:188-199` re-sincroniza el form contra el poll de 60s salvo que el usuario haya editado. Un `setDetalle` programático que no toque el ref hace que el texto autocompletado **desaparezca solo** en ≤60s.
- **`pristine` vía `autoRef` evita pérdida de datos obvia**: autocompletar "Milanesa" → agregar "sin sal" → cambiar a Opción → volver a Menú. Sin la regla, se pierde el "sin sal" en silencio.
- **`pickedRef` evita alarmas falsas masivas.** `effectiveTipo` sale del meal **ya guardado** (`BedsView.tsx:220`), sin que nadie toque nada. Sin el ref: (a) toda cama con comanda MENU guardada y sin plan vigente muestra el aviso amber al abrir la tarjeta — con 4 turnos × decenas de camas es ruido masivo; (b) `canUsePlan = plan.comanda !== detalle` queda **encendido para siempre** en toda comanda cuyo texto se editó — que **es el caso normal**, no el edge (el feature entero existe porque el texto es editable).
- El link "Usar planificada" además se condiciona a `pickedRef.current || !meal || plan.at > meal.at` — así solo aparece espontáneamente cuando la **plantilla cambió después** de que la comanda se guardó, que es la única señal objetiva.
- Nada de esto toca el modo lectura (`BedsView.tsx:201-216`): catering no autocompleta.

**Alternativas.** (a) Pisar siempre al clickear — descartado: pérdida silenciosa, y la app ya tiene fama de "revertir sola". (b) Autocompletar en el mount — descartado: escribiría texto que nadie pidió y `dirty` (`:221-224`) habilitaría Guardar solo, invitando a persistir algo no tipeado. (c) `readonly` cuando viene de plantilla — descartado, contradice la spec explícita ("es una COPIA, no un link vivo").

---

### D12 — Derogación de `forceOtros`: se conserva el conocimiento clínico como **preselección**

**Qué.** Se borra `forceOtros` (`BedsView.tsx:183`) y `effectiveTipo` (`:218-220`). Las 3 opciones siempre. `CUSTOM_COMANDA_DIETS` **se conserva** degradada a **preselección no bloqueante** de "Otros" cuando la dieta es terapéutica y el turno no tiene carga previa. `dietRequiresCustomComanda` → `dietSuggestsOtros`.

**Por qué.** La spec deroga la **restricción**, no el conocimiento clínico de que una dieta liviana/astringente no tiene menú estándar. Preseleccionar preserva la ergonomía de Nutrición (0 clicks en el caso frecuente) sin bloquear: el selector queda a la vista.

**Trampa que hay que evitar** (la preselección se pisaría sola y nadie se daría cuenta): el useEffect de re-sync (`BedsView.tsx:193-199`) tiene deps `[sig]` → **corre en el mount** y su guard es `if (editedRef.current) return`, que en el mount es `false`. Si la preselección vive solo en el `useState`, el primer commit del effect la borra a `''`. Extraer a un helper usado en **ambos**:

```ts
const initialTipo = (): 'MENU'|'OPCION'|'OTROS'|'' =>
  meal?.tipo ?? (!meal && dietSuggestsOtros(dietTypeOf(bed)) ? 'OTROS' : '');
// useState(initialTipo)  y  dentro del effect: setTipo(initialTipo())
```

> ⚠️ **`dietTypeOf` NO se borra.** Tiene 2 consumidores ajenos a comandas: `BedsView.tsx:468` (opciones del filtro por tipo de dieta del mapa) y `:544` (el filtro en sí). Solo es borrable `CUSTOM_COMANDA_DIETS` + la función, si se rechaza la preselección (P2).

**Alternativas.** (a) Borrar todo — camino más limpio, alineado a la spec literal, pero tira conocimiento de dominio codeado a propósito y suma clicks. Es **decisión de negocio** (P2). (b) Solo hint visual (chip "dieta especial") sin preseleccionar — punto medio, no ahorra el click.

---

### D13 — Colapso por **CSS**, estado en el padre, default derivado

**Qué.** El cuerpo del box se oculta con `className={cn(..., !open && 'hidden')}`, **nunca** con render condicional. El estado vive en `BedsView` como un `Set<MealSlot>` de **override**, no de default:

```ts
const [toggled, setToggled] = useState<Set<MealSlot>>(new Set()); // reseteado por cama
const open = toggled.has(slot) ? !meal : !!meal;  // default = !!meal; el Set marca los invertidos
```

**Por qué.**
- El state del form (`tipo/detalle/obs`, `BedsView.tsx:184-187`) y el `editedRef` viven **dentro** de `MealSlotEditor`: render condicional destruye lo tipeado sin guardar. Con 4 boxes + N acompañantes (drafts adentro), la probabilidad de perder trabajo es alta.
- El default "se abren los que tienen carga" **no puede guardarse en el Set**: se computa desde `liveBed.meals`, que se hidrata del poll de 60s. En cold start el effect ya corrió con `meals` vacío → los 4 quedan cerrados, justo para catering (lectura, su caso de uso principal). Agregar `liveBed.meals` a las deps es peor: pelearía contra el usuario que colapsó a mano. Derivarlo re-evalúa solo cuando llegan las comandas, sin pisar la intención.

**Alternativas.** (a) Abrir el turno vigente según la hora ART — necesita ventanas horarias (definición de negocio que no tenemos) y arrastra el riesgo de TZ. (b) Los 4 siempre abiertos — duplica el scroll bajo el formulario de PROGAL (`:2263-2315`). (c) Subir `tipo/detalle/obs` al padre — resolvería de paso el bug preexistente de perder lo tipeado al cambiar de tab, pero es un refactor mayor.

---

### D14 — **Sin arrastre**: la comanda (y el acompañante) es un hecho del día

> **Resuelta el 2026-07-15.** Se llegó a diseñar un mecanismo de arrastre y **se descartó** por definición
> explícita del usuario: *"es día a día, no se configura con lo de ayer, que lo agreguen cuando lo tengan que
> agregar y listo"*. Se documenta para no reabrirlo sin motivo.

**Qué.** Cada día arranca **en cero**. Ni el titular ni los acompañantes se pre-crean a partir del día anterior.
El acompañante se agrega a mano el día que corresponde, con "+ Agregar acompañante". No hay drafts arrastrados,
ni "copiar de ayer", ni cron de pre-creación.

**Por qué.**
- Es la semántica que `DiaComanda_D` (D7) ya impone: **una comanda pertenece a un día**. Sin arrastre el modelo
  queda internamente consistente — no hay dos reglas peleando.
- Un acompañante presente ayer **no implica** que esté hoy. Pre-crear su bloque genera una **bandeja fantasma**
  para alguien que se fue: cocina de más, y el error es *plausible* (nadie sospecha de un dato que "venía bien").
- Simplifica Fase 4 de forma material: **se cae** el fetch extendido a `ayerART`, el ref anti-regeneración por
  `(cama, turno, día)`, la interacción entre drafts arrastrados y drafts manuales, y su tope compartido.
  Era maquinaria para un requisito que no existe.
- Titular y acompañantes quedan bajo **la misma regla** → no hay asimetría que explicarle a Nutrición.

**Consecuencia operativa aceptada.** Si un acompañante se queda internado toda la semana, Nutrición lo re-agrega
cada día. Es fricción real y conocida, aceptada explícitamente a cambio de no tener bandejas fantasma.
Si con el uso molesta, el fallback más barato es un botón manual **"copiar de ayer"** por turno (opt-in, sin
automatismo) — **no se construye hasta que se pida**.

**Alternativas descartadas.**
- **(a) Arrastre de presencia** (bloque pre-creado con comanda vacía) — descartada por definición del usuario.
  Era la menos mala de las variantes con arrastre: nunca copiaba el `detalle` de ayer, que habría metido el
  **texto del menú viejo** en un día nuevo, reintroduciendo por la ventana el bug que D7 mata.
- **(b) Copia total** (tipo + detalle + obs de ayer) — descartada por lo mismo, agravado.
- **(c) Arrastre server-side por cron** — descartada: escribe filas que nadie confirmó y necesita infra nueva.

---

## 4. Las 5 fases

### Fase 0 — Probe de esquema (**bloqueante**, ~30 min → reducida)

Todo el diseño de fechas descansa en que `.slice(0,10)` recupere el día correcto, y hoy **la lista tiene 0 filas**: no hay un solo dato real contra el cual verificar el shape que devuelve Graph.

> ✅ **Parcialmente resuelto (2026-07-15).** El probe de columnas ya se corrió vía Graph:
> `FechaFin_CM` **ya es Fecha** (migración hecha) y **6 columnas están indexadas**
> (`FechaInicio_CM`, `FechaFin_CM`, `Turno_CM`, `Tipo_CM`, `Status_CM`, `Entorno_CM`).
> **Los puntos 1 (parcial) y el criterio de indexado quedan CERRADOS.** Sigue pendiente lo que
> requiere escribir datos reales: el **round-trip de fechas** (punto 2-3), el `maxLength` de
> `Comanda_CM` (P5) y el `ENTORNO` de Vercel prod.

**Crear:** `scripts/probe-cargamenu-dates.mts` (molde: `scripts/verify-dietas-write.mts`).

1. ~~**Leer las definiciones de columna**~~ ✅ hecho. Sigue pendiente solo:
   - `Comanda_CM` → ¿`maxLength`? (afecta P5)
2. **Round-trip.** Escribir filas de prueba (`Entorno_CM='MUESTRA'`, `Status_CM='Inactivo'`, hard-delete al final — no dejar rastro) con 4 variantes en `FechaInicio_CM`: `'2026-07-15'`, `'2026-07-15T00:00:00Z'`, **`'2026-07-15T12:00:00Z'`**, `'2026-07-15T22:00:00-03:00'`. Imprimir el **string crudo** que devuelve Graph y el resultado de `.slice(0,10)`.
3. **Verificar en la UI de SharePoint** que la variante `T12:00:00Z` muestra **15/07** (no 14/07). Este paso no se puede saltear: la API puede round-tripear bien y el web UI mostrar el día anterior.
4. Leer la zona regional del sitio (`GET /sites/{id}` + `regionalSettings`).

**Criterios de aceptación.**
- Queda documentado en el JSDoc de `api/carga-menu.ts` el string exacto que devuelve Graph para una columna date-only.
- Si `.slice(0,10)` de lo escrito ≠ lo escrito → **parar y rediseñar el mapeo**.
- ~~Si alguna de `Status_CM`/`Entorno_CM` da `indexed: false` → indexar ahora~~ → ✅ **ya indexadas** (6 columnas, verificado 2026-07-15).
- Verificar que **`ENTORNO` está seteada** en Vercel prod y preview. Default es `'TESTING'` (`api/dietas.ts:24`): si falta en prod, todo se escribe con `Entorno_CM='TESTING'` y el GET de prod no lo ve → síntoma *"guardé y no aparece"*, sin ningún error que seguir.

---

### Fase 1 — CRUD de planificación (16.CargaMenu) + permisos

**Archivos**

| Path | Acción |
|---|---|
| `types.ts` | `TURNOS`, `Turno`, `TIPOS_PLAN`, `TipoPlan`, `interface PlanMenu`, `rangesOverlap()`, `mealPlanKey()`, permisos `ver_planificacion`/`abm_planificacion` |
| `lib/utils.ts` | `formatDayMonth(iso)` → `'dd/mm'` por string-split; `turnoPill()` (4 turnos); **mover** `comandaTipoPill` acá |
| `views/BedsView.tsx` | Importar `comandaTipoPill` de `lib/utils` (era `:170-173`) |
| `views/ComandasManagementView.tsx` | Cambiar origen del import (`:4`); botón "Planificación de comandas" + gate |
| `api/carga-menu.ts` | **crear** — GET / POST / PATCH / DELETE |
| `dev-server.ts` | `'/api/carga-menu': () => import('./api/carga-menu'),` después de `:90` |
| `views/RoleManagementView.tsx` | Grupo `PERMISSION_GROUPS` con `module: 'Gestion Comandas'` |
| `components/modals/PlanificacionComandasModal.tsx` | **crear** |
| `scripts/setup-cargamenu-list.mts` | **crear** — solo add-columns + index + inspect |
| `components/ui/calendar.tsx` | (opcional, 1 línea) `:61` → `toLocaleDateString('en-CA', {timeZone: ART})` |

**Pasos**

1. **`types.ts`** — catálogos (D1) + `rangesOverlap` (función pura de strings; va acá porque `types.ts` es el módulo **dual-consumable probado**: `api/tickets.ts:12`) + los 2 permisos. Correr `npx tsc --noEmit`: `PERMISSIONS` es un `as const` del que deriva `type Permission` (`types.ts:172`) y toca `RoleManagementView` + `lib/permissions.ts`.
2. **`lib/utils.ts`** — `formatDayMonth` con puro string-split (`isoDate.slice(0,10).split('-')`), **nunca** `Date` (mismo motivo que `formatDateReadable`, `:66-68`). `turnoPill` con 4 entradas (desayuno rose / almuerzo sky / merienda teal / cena violet — sin pisar los del pill de tipo). **Mover** `comandaTipoPill` desde `BedsView.tsx:170-173`: sería su 3er consumidor y el repo ya dejó la regla escrita (`CleaningManagementView.tsx:12` — *"copiado de BedsView (no está exportado); exportar si un 3er lugar lo necesita"*). Además, importar de `views/` desde `components/modals/` sería la **primera inversión de dependencia** del repo (grep: hoy ningún archivo bajo `components/` importa de `views/`) y arrastraría un archivo de ~2400 líneas al grafo de un modal.
3. **`scripts/setup-cargamenu-list.mts`** — ⚠️ **hardcodear** `const LIST_ID = (process.env.CARGAMENU_LIST_ID ?? 'f6720c30-aecb-4e7e-ad50-2ba108498bd3').trim();` y **eliminar toda rama de lookup-por-nombre y de creación de lista**. El molde (`create-dietas-list.mts:94-107`) crea la lista si no la encuentra por `displayName` → cualquier discrepancia (espacio, tilde, name interno) crea **una segunda 16.CargaMenu vacía**, le pone 11 columnas, la indexa, e imprime un LIST_ID que no es `f6720c30`. A partir de ahí el endpoint apunta a una lista y negocio mira la otra. Validar con `GET /sites/{SITE_ID}/lists/{LIST_ID}` y abortar con error si 404. El script solo: agrega `FechaBaja_CM`, indexa lo que falte, imprime tipos.
4. **`api/carga-menu.ts` — helpers.** JSDoc de 4 verbos (molde `api/roles.ts:1-8`). Imports `.js`. `LIST_ID` por env con fallback (patrón `api/dietas.ts:22`). `ENTORNO` + `esc()` (`api/limpiezas.ts:28-30`). `isDayStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))`. `spDay = (v) => String(v ?? '').slice(0,10)` con **comentario explícito**: *protege contra el FORMATO (tolera Texto y dateOnly), NO contra el off-by-one; ver Fase 0*. `uidField(userId)` extraído a función del módulo:
   ```ts
   const uidField = (userId: unknown) => {
     const n = Number(userId);
     return String(userId ?? '').trim() !== '' && Number.isFinite(n) ? { UserID_CM: n } : {};
   };
   ```
   ⚠️ **Usarlo en POST *y* en PATCH.** `UserID_CM` es Número → rechaza el string vacío y hace fallar el request **entero** (`scripts/inspect-dietas-list.mts:35`, `BREAKS`). `api/dietas.ts` lo aplica en los dos verbos (`:178` y `:204`). El síntoma de olvidarlo en PATCH es *"no puedo editar nada"*, que no apunta al campo de usuario.
5. **GET (grilla).** `$filter=fields/Status_CM eq 'Activo' and fields/Entorno_CM eq '<E>'` + `Prefer: HonorNonIndexed...` + paginado `@odata.nextLink` con `$top=500` y backstop 5000 (calcado de `api/dietas.ts:62-71`). Ordenar **en JS** por `TURNOS.indexOf(turno)` → tipo → `desde` desc. **502** ante fallo (D10).
6. **`findOverlaps(turno, tipo, desde, hasta, excludeId?)`** — compartida por POST y PATCH. Trae por `Status_CM + Entorno_CM` (indexadas), filtra turno/tipo/rango **en JS** con `rangesOverlap` de `types.ts`.
7. **POST.** Guard `abm_planificacion` → 403 (D9). Validar: turno ∈ `TURNOS` → 400; tipo ∈ `TIPOS_PLAN` (incluye rechazar `'OTROS'` con mensaje explícito) → 400; `isDayStr(desde) && isDayStr(hasta)` → 400; `hasta >= desde` → 400; `comanda.trim() !== ''` → 400; truncar a `maxLength` real de `Comanda_CM` (Fase 0). Pre-check → **409** `{ error, conflicts }` (D8). Crear:
   ```ts
   { Title: '[sumar]', Turno_CM, Tipo_CM,
     FechaInicio_CM: `${desde}T12:00:00Z`, FechaFin_CM: `${hasta}T12:00:00Z`,   // ← mediodía UTC (D2)
     Comanda_CM, Status_CM: 'Activo', Entorno_CM: ENTORNO,
     NombreUserCarga_CM: String(userName ?? ''), ...uidField(userId),
     FechaCarga_CM: new Date().toISOString() }                                   // ← instante, ISO completo
   ```
   Asimetría deliberada, comentarla.
8. **PATCH.** Guard → GET del item → merge con el body (`x !== undefined`) → validar el **merge completo** → `findOverlaps(excludeId: spItemId)` → PATCH a `/fields` + re-estampar `NombreUserCarga_CM`/`uidField`/`FechaCarga_CM` (pasa a significar "última modificación" — no hay columnas separadas y para auditar importa más "quién dejó esto así").
9. **DELETE (soft).** Guard → `{ Status_CM: 'Inactivo', FechaBaja_CM: nowIso }`. ⚠️ `Status_CM` es **texto libre**, no Choice como `Status_D` (`create-dietas-list.mts:55`): un `'inactivo'` en minúscula se escribe sin error y la fila queda visible para siempre. La constante sale de un solo lugar. Verbo DELETE y no PATCH sobrecargado: el ABM tiene dos mutaciones distintas y el discriminador implícito ("si no vienen campos, borrá") causa borrados accidentales. `dev-server.ts:131` parsea el body para **todos** los métodos → funciona igual en dev y Vercel.
10. **405** + `export default requireAuth(handler)`. Todos los catch con `console.error('[carga-menu] ...', err)`.
11. **`dev-server.ts`** — registrar la ruta. **`vercel.json` no se toca** (solo declara `maxDuration` y `crons`).
12. **`RoleManagementView`** — grupo con `module: 'Gestion Comandas'` (entre "Gestion Limpieza" y "Mapa de Camas", respetando el orden de `MODULES`).
13. **Modal.** Props `{ open, onOpenChange, currentUser }` (patrón `RejectionModal.tsx:9-13`). `authFetch` local leyendo `localStorage 'mediflow_token'` (patrón `RoleManagementView.tsx:124-134`) — **no pasa por `useHospitalState`**: es un ABM autocontenido, sin cama, sin paciente, sin poll; meterlo en el hook agregaría un fetcher al `useCallback` del que depende el effect de polling (`:790-807`) sin ningún consumidor. Precedente: la tab Histórico ya pega directo a `/api/dietas` (`ComandasManagementView.tsx:103-131`). Grilla: Turno (`turnoPill`) / Tipo (`comandaTipoPill`) / `${formatDayMonth(desde)} - ${formatDayMonth(hasta)}` / Comanda / Acciones (`Pencil` + `Trash2` crudos, `RoleManagementView.tsx:437-446`). 3 estados: loading / **error** (banner + Reintentar) / vacío. Modo lectura si solo `ver_planificacion` (sin "Nueva planificación", sin columna Acciones).
14. **Subform.** ⚠️ **Turno y Tipo van con filas de botones-toggle, NO con desplegable.**
    - `components/ui/select.tsx` **no usa portal** (`SelectContent` es `absolute z-50`, `:95-101`) y `DialogContent` aplica `overflow: 'clip'` + `isolation: 'isolate'` (`dialog.tsx:88`) + envuelve children en `overflow-y-auto` (`:101`) → se recorta.
    - `SearchableSelect` **sí** portaliza, pero su estado `open` es **interno** y no expone `open`/`onOpenChange` (`searchable-select.tsx:11-32`) → **Escape con el desplegable abierto cierra el modal entero y se pierde el form**, y el guard no puede observarlo.
    - Botones-toggle: precedente real del módulo (`BedsView.tsx:241-249`), mejor UX para 4 y 2 opciones, cero clipping, cero Escape.
    - Datepickers: Popover + Calendar (el Popover **sí** portaliza con `z-[9999]`, `popover.tsx:14-20`). ⚠️ **No hay precedente en el repo de Popover/Calendar dentro de un Dialog** (los 4 usos de Calendar están en toolbars de vista) → validarlo temprano.
    - Clamp de rango al estilo `DashboardView.tsx:197,211`: al elegir desde, si `d > hasta` mover hasta; simétrico.
    - Default desde/hasta = **hoy ART**, nunca `toISOString().slice(0,10)`.
15. **Guard de Escape (obligatorio).** `DialogContent` registra un listener document-level que cierra con Escape **sin chequear `e.defaultPrevented`** (`dialog.tsx:64-71`) → Escape con el Calendar abierto cierra el datepicker **y el modal**. Fix sin tocar el primitivo:
    ```tsx
    onOpenChange={(v) => {
      if (!v && (openDesde || openHasta)) { setOpenDesde(false); setOpenHasta(false); return; }
      if (!v) resetForm();
      onOpenChange(v);
    }}
    ```
    ⚠️ **Comentar por qué funciona**: depende del orden de registro de listeners (DialogContent registra el suyo al montarse, antes que radix, y lee el `openDesde` todavía en `true` del closure). Es correcto pero frágil. Efecto lateral aceptado: con un picker abierto, el click en la X o el overlay no cierra el modal a la primera. Dejarlo documentado o el próximo que toque `dialog.tsx` lo rompe sin enterarse.
16. **Confirmación de borrado: inline en la fila** (`deleteTarget === plan.spItemId` → la celda de acciones muestra "¿Eliminar? [Sí] [Cancelar]"), **no un Dialog anidado**. Apilar un segundo `DialogContent` sobre el abierto no tiene precedente y choca con el primitivo: cada uno registra su propio listener de Escape (cerrarían los dos) y ambos overlays son `fixed inset-0 z-50`. El precedente de `RoleManagementView.tsx:643-665` es un Dialog **hermano**, nunca anidado.
17. **Validación cliente** espejo del server (misma `rangesOverlap` de `types.ts`) gobernando `disabled`. `handleSave` **siempre lee el body del error** — el 409 se renderiza como *"Ya existe una planificación de {Almuerzo} / {Menú} del {15/07} al {20/07}"*, **sin cerrar el subform ni perder lo tipeado**.

**Criterios de aceptación**

- El probe de Fase 0 corrió y su resultado está en el JSDoc de `api/carga-menu.ts`.
- Crear desde=15/07 hasta=20/07 deja en SP `FechaInicio_CM='2026-07-15T12:00:00Z'`, la **UI de SharePoint muestra 15/07** (no 14/07 ni 16/07) y la grilla muestra `'15/07 - 20/07'`. **Verificado también creando entre las 21:00 y 00:00 ART.**
- GET devuelve solo `Status_CM='Activo'` + `Entorno_CM` del deploy. Eliminar hace soft-delete: la fila sigue en SP con `Status_CM='Inactivo'` + `FechaBaja_CM`. **Cero DELETE físicos.**
- POST rechaza con 400: turno inválido, tipo inválido (incluido `'OTROS'`), fechas ausentes o con formato distinto, `hasta < desde`, comanda vacía o solo espacios. La comanda se persiste trimeada.
- **Solapamiento:** A = Almuerzo/Menú 01/07→31/07. Entonces: B 15/07→20/07 (contenido) → **409**; C 31/07→05/08 (comparte **un** día) → **409**; D 01/08→10/08 (adyacente) → **201**; E Cena/Menú 15/07→20/07 → **201**; F Almuerzo/Opción 15/07→20/07 → **201**. Editar A a 01/07→14/07 y reintentar B → **201**. Editar A sin cambiar fechas → **nunca** 409 contra sí misma.
- POST/PATCH/DELETE **sin `abm_planificacion` → 403** aunque el token sea válido (verificable con curl). **Con** el permiso → 201. GET → 200 solo con `requireAuth`.
- Los checkboxes de los permisos nuevos aparecen en el ABM de Roles **solo** al tildar el módulo "Gestión de Comandas" — sin necesidad de habilitar "Mapa de Camas".
- Con el datepicker abierto, Escape cierra **solo** el calendario y el form conserva lo cargado. Los selectores de Turno/Tipo no se recortan contra el borde del Dialog.
- El modal distingue **cargando / error de SP (banner + Reintentar) / vacío**. Un fallo de SP **nunca** se ve como "no hay planificaciones".
- `grep -rE "fields/Fecha\w*_CM (ge|le|gt|lt)"` → 0 hits. Todo `$filter` lleva `Prefer: HonorNonIndexed...`.
- `npx tsc --noEmit` limpio. La tarjeta de dieta sin cambios de comportamiento: `MealSlot` sigue siendo `'almuerzo'|'cena'` y `dietRequiresCustomComanda` intacta.

> ⚠️ **Paso manual post-deploy, no salteable.** Los permisos se hidratan como strings crudos desde `Permisos_RT` sin validar contra el catálogo (`api/role-cache.ts:53`, `api/auth.ts:147`). Al deployar, **ningún rol existente los tiene** → el botón es invisible para todos, **incluido el admin**, hasta que alguien con `abm_roles` entre a Configuración → Roles, habilite el módulo y tilde los permisos. Se va a reportar como "la feature no salió". Verificar además si hace falta re-login o si `api/me.ts:35` re-hidrata la sesión abierta.

---

### Fase 2 — 4 turnos + `DiaComanda_D` + boxes colapsables + derogación de "Otros por dieta"

**Archivos:** `scripts/create-dietas-list.mts`, `api/dietas.ts`, `types.ts`, `hooks/useHospitalState.ts`, `views/BedsView.tsx`, `views/ComandasManagementView.tsx`, `lib/utils.ts`, `docs/decisiones.md`

**Pasos**

1. **SP.** ⚠️ **No crear un script nuevo.** `scripts/create-dietas-list.mts` ya es idempotente para esto: detecta la lista existente (`:84-85`), saltea columnas existentes (`:117`) y saltea índices ya aplicados (`:135`). Agregar al array `COLUMNS` (`:41-61`): `{ name: 'DiaComanda_D', index: true, def: TEXT, desc: "Día de servicio 'YYYY-MM-DD' en ART. Clave de negocio." }`. Re-correr. **Backfill:** `DiaComanda_D = artDay(FechaCarga_D)` sobre las filas `Status_D='Activo'` del entorno (~800, trivial). Sin el backfill, el día del deploy catering pierde las comandas ya cargadas.
2. **`types.ts`.**
   ```ts
   export const MEAL_SLOTS = ['desayuno','almuerzo','merienda','cena'] as const;
   export type MealSlot = typeof MEAL_SLOTS[number];
   export const MEAL_SLOT_LABELS: Record<MealSlot, string> = { desayuno:'Desayuno', almuerzo:'Almuerzo', merienda:'Merienda', cena:'Cena' };
   export const isMealSlot = (s: string): s is MealSlot => (MEAL_SLOTS as readonly string[]).includes(s);
   export const SLOT_TO_TURNO: Record<MealSlot, Turno> = { desayuno:'DESAYUNO', almuerzo:'ALMUERZO', merienda:'MERIENDA', cena:'CENA' };
   ```
   `Bed.meals` (`:126`) → `Partial<Record<MealSlot, MealLoad>>`. Actualizar el comentario de `MealLoad.tipo` (`:132-133`).
3. ⚠️ **`tsc` NO va a marcar los call-sites peligrosos.** Ampliar el tipo deja **legales**: `bed.meals?.almuerzo || bed.meals?.cena` (`BedsView.tsx:1917,1919`), `hasAnyMeal` (`:2331`) y `for (const slot of ['almuerzo','cena'] as const)` (`ComandasManagementView.tsx:73`). Los únicos que marca son los que rompe el reshape de `MealsInfo`. Si alguien confía en el compilador, una cama con solo desayuno **no pinta el platito, no renderiza la sección Menú y no aparece en Gestión Comandas ni en el PDF** — sin un solo error de compilación. **Usar un checklist de grep:**
   ```
   grep -rnE "\.meals|almuerzo|cena|MealSlot|MEAL_SLOTS|MealsInfo" --include='*.ts' --include='*.tsx' . | grep -v node_modules
   ```
   → 5 archivos: `types.ts`, `hooks/useHospitalState.ts`, `views/BedsView.tsx`, `views/ComandasManagementView.tsx`, `App.tsx:662` (solo pasa props).
4. **`api/dietas.ts`.** `COMIDAS = ['DESAYUNO','ALMUERZO','MERIENDA','CENA']` (`:27`). Mensaje de error (`:147`). JSDoc (`:7`, y la cabecera: el modelo ya no es "una fila activa por cama+comida"). **`DiaComanda_D`:** al POST se estampa `artToday()`; la clave de upsert (`:163-165`) suma `and fields/DiaComanda_D eq '<hoyART>'`; el GET de hoy pasa a `$filter=fields/DiaComanda_D eq '<hoyART>' and fields/Entorno_D eq '<E>'` (ambas indexadas) + `Status_D` en JS, y **elimina** el filtrado en JS por `artDay(FechaCarga_D)` (`:129-133`). **Paginar** el GET de hoy con el bucle de `:62-71` (el `$top=1000` de `:105` es tamaño de página, no tope). **Fix del duplicado:** si `!existing.ok` (`:169`), devolver 500 en vez de caer al POST de creación (`:187`) — hoy un error transitorio de Graph crea silenciosamente una fila duplicada activa que nadie limpia. **No tocar** el backstop de OTROS (`:152-154`): ya implementa exactamente la regla nueva.
5. **`hooks/useHospitalState.ts`.** `MealsInfo` → `{ patientCode: string; slots: Partial<Record<MealSlot, MealLoad>> }` (sacar las cargas de la intersección con `patientCode` hace que "está vacío" sea `Object.keys(...).length` y elimina una clase entera de bug). `fetchMeals` (`:653`): `const s = String(m.comida ?? '').toLowerCase(); if (!isMealSlot(s)) continue;`. **`:690` y `:721`: `comida: comida.toUpperCase()`** — es **el fix del bug** que mandaría desayuno/merienda a SP como CENA. `mergeBeds` (`:254`): `if (Object.keys(m.slots).length) bed.meals = { ...m.slots };`. `clearMealLoad` (`:715`): `delete cur.slots[comida]; if (!Object.keys(cur.slots).length) n.delete(bed.label);`.
   > Los 4 slots son ASCII sin tildes → `toUpperCase()`/`toLowerCase()` (sin locale, inmune al edge turco) es biyectivo y no puede desincronizarse al sumar un 5º turno. Un switch de 4 casos funciona hoy y reintroduce el mismo bug la próxima — así se llegó al bug actual.
6. **Verificación intermedia (antes de tocar UI).** Guardar un ALMUERZO → la fila sigue igual (cero regresión en los 2 turnos viejos). Después, con curl directo, `comida='DESAYUNO'` → crea fila propia y el GET la devuelve. Valida el contrato **sin UI de por medio**.
7. **`BedsView` — derogar `forceOtros` (commit propio, revertible solo).** Borrar `forceOtros` (`:183`) y `effectiveTipo` (`:218-220`). Widenear el state (`:184`, `:196`) a `'MENU'|'OPCION'|'OTROS'|''` con el helper `initialTipo` (D12). Selector de 3 botones (`:241`) con los colores de `comandaTipoPill`; borrar el banner indigo (`:234-238`). `canSave = !!tipo && dirty && (tipo !== 'OTROS' || detalle.trim() !== '')` (`:226`) — **espeja exactamente el backstop de `api/dietas.ts:154`**; si divergen, se dispara un POST que devuelve 400 y el usuario ve la carga revertirse **sin mensaje** (`useHospitalState.ts:702-705`). Placeholder/estilo según `tipo === 'OTROS'` (`:252-255`).
8. **`BedsView` — colapso (D13).** `toggled: Set<MealSlot>` en `BedsView` junto a `detailTab` (`:285`), reseteado en el useEffect por cama (`:288-290`). Header clickeable con chevron + resumen (pill + detalle truncado + `fmtMealWhen`, o "Sin carga"). Cuerpo con `hidden`. **Verificar que el modo lectura (`:201-216`, catering) también colapsa y que su header muestra el resumen sin abrir** — es su caso de uso principal.
9. **`BedsView` — iterar `MEAL_SLOTS`** (`:2340`), `hasAnyMeal` (`:2331`) → `MEAL_SLOTS.some(s => !!liveBed.meals?.[s])`, indicador de la grilla (`:1917-1919`) igual.
   > **Sobre la `key`:** el fix propuesto originalmente (`key={\`${liveBed.label}-${slot}\`}`) es una **línea muerta**: el modal está detrás de `{selectedBed && ...}` (`:1970`) dentro de `<Dialog open={!!selectedBed}>` (`:1968`) y el overlay impide clickear otra cama → `selectedBed` siempre hace `bed → null → bed`, el editor **siempre se desmonta** y `label` es invariante mientras el modal está abierto. La única variante real es la **reasignación de paciente** con el modal abierto (mismo label, `patientCode` nuevo por el poll): ahí `mergeBeds` deja de adjuntar `bed.meals` (`useHospitalState.ts:253`), `sig` pasa a `'|'` y con `editedRef.current === true` el effect hace early-return (`:195`) → queda el texto del paciente anterior sobre el nuevo. **Si importa:** `key={\`${liveBed.patientCode ?? liveBed.label}-${slot}\`}` o incluir `patientCode` en `sig` (`:192`). **Si no importa:** no tocar la key y no anotar un riesgo que el código descarta.
10. **`ComandasManagementView`.** ⚠️ **Agregar `slot: MealSlot` a `ComandaRow`** (`:50-53`) y normalizar **una sola vez por mapper**, no tres. Hoy `comida` mezcla dos espacios de valores: en "activas" se llena con un label (`'Almuerzo'`, `:80`) y en "histórico" con el valor crudo de SP (`'ALMUERZO'`, `:120`) — por eso `comidaPill` ya tiene el parche `c.toUpperCase().startsWith('ALM') || c === 'Almuerzo'`. Con `slot`: pill = `MEAL_SLOT_PILL[r.slot]`, display = `MEAL_SLOT_LABELS[r.slot]`, sort = `MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot)` (hoy `:87` ordena `localeCompare` → alfabético: Almuerzo/Cena/Desayuno/Merienda). El PDF (`:146`) hereda el fix gratis.
11. **Docs.** `create-dietas-list.mts:51-52` (descripciones de `Comida_D`/`Tipo_D` — solo doc: el script saltea columnas existentes y no patchea descripciones). `docs/decisiones.md`: derogar "Otros solo terapéuticas" + ampliar turnos sin migrar SP + `DiaComanda_D`.

**Criterios de aceptación**

- 4 boxes en orden Desayuno/Almuerzo/Merienda/Cena, en modo edición **y** lectura.
- Colapsan con click; el header colapsado muestra pill + comanda truncada, o "Sin carga". Los que tienen carga arrancan abiertos; si no hay ninguna, los 4 cerrados. **Con el modal ya abierto y las comandas llegando por el poll, el default se aplica igual** (Set como override, no como default guardado).
- **Tipear, colapsar y expandir CONSERVA lo tipeado** (verifica que el colapso es CSS).
- Los 3 botones aparecen y son seleccionables en **todos** los turnos y **todas** las dietas: con dieta "Liviana" se puede elegir Menú; con "General" se puede elegir Otros. Ninguna rama oculta el selector. `grep -n 'forceOtros\|effectiveTipo' views/BedsView.tsx` → 0.
- **[si se acepta P2]** Abrir una cama de dieta "Liviana" **sin carga previa** muestra "Otros" ya seleccionado (y el Guardar deshabilitado hasta escribir la comanda).
- `tipo='OTROS'` + comanda vacía → Guardar deshabilitado (nunca se dispara un POST que devuelva 400). Con MENU/OPCION la comanda sigue opcional.
- Cargar los 4 turnos crea **4 filas activas** con `Comida_D` distinto, `DiaComanda_D` = hoy ART, `Title='[sumar]'`. Ninguna pisa a otra.
- Quitar **solo** el desayuno inactiva esa fila; los otros 3 siguen visibles y activos.
- Una cama con **solo desayuno** muestra el platito en la grilla y renderiza la sección Menú.
- Las cargas ALMUERZO/CENA preexistentes se leen, muestran y editan igual — cero filas migradas (más allá del backfill de `DiaComanda_D`).
- **Guardar hoy NO pisa la fila de ayer**: quedan dos filas con `DiaComanda_D` distinto.
- En Gestión Comandas (ambas tabs) Desayuno y Merienda tienen su pill correcto (**un Desayuno no se etiqueta "Cena"**) y el orden es cronológico. El PDF refleja lo mismo.
- El GET de hoy pagina: con >1000 filas activas del día no se pierde ninguna comanda.
- `grep -rnE "'almuerzo'|'cena'|\.almuerzo|\.cena" --include='*.ts' --include='*.tsx' . | grep -v node_modules` → 0 hits fuera de `MEAL_SLOTS`/`MEAL_SLOT_LABELS` en `types.ts`.
- `npx tsc --noEmit` limpio.

---

### Fase 3 — Autocompletado desde la planificación

**Archivos:** `api/carga-menu.ts`, `api/carga-menu-cache.ts` (**crear**), `types.ts`, `hooks/useHospitalState.ts`, `App.tsx`, `views/BedsView.tsx`, `docs/`

**Pasos**

1. **Contrato de valores.** Verificar qué escribe exactamente Fase 1 en `Turno_CM`/`Tipo_CM`. Si guarda `'Menú'`/`'Almuerzo'`, el lookup **nunca matchea** y el síntoma es mudo. Dejar el contrato en el JSDoc. Que el **server** también construya la key con el mismo `mealPlanKey()` de `types.ts` hace que el contrato plantilla↔instancia no pueda driftear entre capas.
2. **`api/carga-menu.ts` — branch `?vigentes=1[&date=]`**, **antes** del GET de grilla (mismo patrón que `?history=1` en `api/dietas.ts:54` — un archivo = un endpoint, el modo va por query param):
   ```ts
   if (req.method === 'GET' && String(req.query?.vigentes ?? '') === '1') {
     const raw = String(req.query?.date ?? '').slice(0, 10);
     const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : artToday();
     // cache de módulo keyed por `day`, TTL 5 min → si hit, devolver
     // ... traer por Status_CM + Entorno_CM (paginado) ...
     const plans = rows.map(spToPlan)
       .filter(p => TURNOS.includes(p.turno) && TIPOS_PLAN.includes(p.tipo) && p.comanda.trim() !== '')
       .filter(p => p.desde && p.hasta && p.desde <= day && day <= p.hasta)
       .sort(byVigencia);
     return res.status(200).json({ day, plans });   // 502 ante fallo de SP
   }
   ```
   `byVigencia` = `b.desde.localeCompare(a.desde) || String(b.at).localeCompare(String(a.at)) || (Number(b.spItemId) - Number(a.spItemId))` (D8). Tipar con **`MealPlan` de `types.ts`** (importado con `from '../types.js'`, precedente `api/tickets.ts:12`) — no inventar un `MealPlanRow` local.
   `norm()` (trim+upper+NFD sin tildes) en la lectura, por si Fase 1 guardó con casing/tildes.
3. **`api/carga-menu-cache.ts`.** Molde exacto: `api/role-cache.ts:14,28` + `invalidateRoleCache()` (`:75-76`). Cache keyed por `day`, TTL 5 min, `invalidateCargaMenuCache()` llamado desde POST/PATCH/DELETE. ⚠️ **Cache sin invalidación rompe `refreshMealPlans`** (D4).
4. **`hooks/useHospitalState.ts`.**
   ```ts
   const POLL_MEAL_PLANS_MS = 5 * 60_000;                   // junto a POLL_BEDS_MS (:262)
   const [mealPlans, setMealPlans] = useState<Map<string, MealPlan>>(new Map());
   const [mealPlansDay, setMealPlansDay] = useState('');
   const [mealPlansLoaded, setMealPlansLoaded] = useState(false);   // ← D10, obligatorio

   const fetchMealPlans = useCallback(async () => {
     if (!can(currentUserRef.current, 'cargar_dieta')) return;      // ← solo cargar_dieta (D4)
     try {
       const r = await authFetch('/api/carga-menu?vigentes=1');
       if (!r.ok) return;                                            // mantiene cache; NO toca el flag
       const data = await r.json();
       const map = new Map<string, MealPlan>();
       for (const p of (data.plans ?? []) as MealPlan[]) {
         const k = mealPlanKey(p.turno, p.tipo);
         if (!map.has(k)) map.set(k, p);                             // la primera es la ganadora
       }
       setMealPlans(map); setMealPlansDay(String(data.day ?? '')); setMealPlansLoaded(true);
     } catch { /* keep current */ }
   }, [authFetch]);                                                  // ← deps SOLO authFetch
   ```
   Cablear en el effect de polling (`:790-807`): mount + `setInterval` + `clearInterval` + dep. Sumar a `refreshAll` (`:1970`). Exportar `mealPlans`/`mealPlansDay`/`mealPlansLoaded` en `state` y `refreshMealPlans` en `actions` (`:2309`) — el modal de Fase 1 lo llama al guardar/eliminar. **No tocar `mergeBeds`**: la planificación no es por cama; meterla en `Bed` re-dispararía el merge de todas las camas en cada poll.
   **`mealPlansDay` se usa** (no es estado muerto): (a) texto honesto del aviso — *"No hay comanda planificada para este turno y tipo para hoy (15/07)"*, que resuelve P3 sin inventar un selector que no existe; (b) detección de rollover de medianoche ART (`mealPlansDay !== artToday()` → cache stale).
5. **`App.tsx:662`** — `mealPlans={state.mealPlans} mealPlansLoaded={state.mealPlansLoaded} mealPlansDay={state.mealPlansDay}`.
6. **`BedsView` / `MealSlotEditor`.**
   ```ts
   const planFor = (op: 'MENU'|'OPCION') => mealPlans?.get(mealPlanKey(SLOT_TO_TURNO[slot], op));
   const autoRef = React.useRef('');      // último texto que escribió el autocompletado
   const pickedRef = React.useRef(false); // ← el usuario tocó el selector en esta sesión (D11)
   const activePlan = (tipo === 'MENU' || tipo === 'OPCION') ? planFor(tipo) : undefined;
   const noPlan = mealPlansLoaded && pickedRef.current && (tipo === 'MENU' || tipo === 'OPCION') && !activePlan;
   const canUsePlan = !!activePlan && activePlan.comanda.trim() !== detalle.trim()
                      && (pickedRef.current || !meal || String(activePlan.at) > String(meal.at));

   const pickTipo = (op: 'MENU'|'OPCION'|'OTROS') => {
     if (op === tipo) return;                    // re-click: no-op
     editedRef.current = true; pickedRef.current = true;   // ¡clave! si no, el poll pisa lo autocompletado
     const pristine = detalle.trim() === '' || detalle === (meal?.detalle ?? '') || detalle === autoRef.current;
     if (op === 'OTROS') { if (pristine) { setDetalle(''); autoRef.current = ''; } }
     else {
       const plan = planFor(op);
       if (plan && pristine) { setDetalle(plan.comanda); autoRef.current = plan.comanda; }
       else if (!plan) autoRef.current = '';
     }
     setTipo(op);
   };
   ```
   Agregar `autoRef.current = '';` **dentro del efecto de re-sync** (`:193-199`, después del `if (editedRef.current) return`) y al resetear `editedRef` tras un guardado exitoso (`:261`) — mantiene la invariante "`autoRef` describe lo que el autocompletado puso en el campo ahora".
   Aviso amber + link "Usar planificada" debajo del selector, arriba del input. El `<input>` **no cambia**: sigue editable, sin `readonly`/`disabled`, `maxLength=500`.

**Criterios de aceptación**

- Con plan ALMUERZO/MENU 01/07→31/07 `'Milanesa con puré'`, en una cama sin comanda: clickear "Menú" completa el input y **sigue editable**.
- El texto autocompletado **sobrevive al poll**: >60s sin guardar y sigue ahí.
- Se persiste el texto **final**: autocompletar → editar a `'Milanesa con puré (sin sal)'` → Guardar → `Detalle_D` = el editado. La fila de 16.CargaMenu queda intacta.
- **Sin plan**: clickear "Opción" muestra *"No hay comanda planificada para este turno y tipo para hoy (15/07)"*, el input no se limpia ni se bloquea, y se puede guardar igual.
- **Abrir una tarjeta con comanda guardada y sin plan vigente NO muestra el aviso** (nadie pidió autocompletar). El link "Usar planificada" **no** aparece por el mero hecho de que el texto se haya editado.
- "Otros" con campo pristine → comanda vacía, Guardar deshabilitado, **sin** aviso de "no hay plan".
- **Borde del rango (off-by-one):** plan 15/07→15/07. `GET ?vigentes=1&date=2026-07-14|15|16` → `plans` vacío / 1 fila / vacío.
- **TZ del device:** navegador forzado a `Asia/Tokyo` (DevTools → Sensors) a las 22:00 ART → autocompleta el menú del **día ART**. `day` de la respuesta = día ART real.
- **Desempate:** plan "estándar" 01/07→31/07 + "feriado" 15/07→15/07 → el 15/07 autocompleta el feriado, el 16/07 el estándar. 5 llamadas consecutivas devuelven **lo mismo**.
- **No destructivo:** "Menú" → editar a "X" → "Opción" → **"X" no se pierde** y aparece "Usar planificada"; clickearlo reemplaza por la planificada de Opción.
- Un solo fetch cada 5 min (Network), no uno por tarjeta ni por click. **Un usuario sin `cargar_dieta` no dispara la llamada.** Guardar en el modal de Fase 1 refresca sin recargar y **sin re-armar los polls** de tickets/beds.
- **SP caído en cold start** (simulable con LIST_ID inválido): el endpoint da 502, el cache no se borra, **y el aviso "no hay comanda planificada" NO aparece** (`mealPlansLoaded === false` → la UI no afirma nada).

---

### Fase 4 — Acompañantes múltiples por turno

**Archivos:** `scripts/create-dietas-list.mts`, `api/dietas.ts`, `types.ts`, `hooks/useHospitalState.ts`, `views/BedsView.tsx`, `App.tsx`, `views/ComandasManagementView.tsx`, `docs/`

> **No hay endpoint nuevo.** `dev-server.ts` y `vercel.json` no se tocan.

**Pasos**

1. **SP.** Extender `COLUMNS` de `scripts/create-dietas-list.mts` con `Comensal_D` (TEXT, `index:false`) y `OrdenComensal_D` (TEXT, `index:false`) y re-correr. El backfill (`Comensal_D='TITULAR'`) **no es crítico** (el default read-side lo cubre) pero deja la lista legible desde la UI de SP.
2. **`api/dietas.ts` — helpers:**
   ```ts
   const COMENSALES = ['TITULAR','ACOMPANANTE'];
   const MAX_ACOMPANANTES = 6;   // espejo de types.ts — el catálogo lo valida el endpoint, no SP
   const comensalOf = (f) => String(f.Comensal_D ?? '').trim().toUpperCase() === 'ACOMPANANTE' ? 'ACOMPANANTE' : 'TITULAR';
   const ordenOf   = (f) => { const n = Number(String(f.OrdenComensal_D ?? '').trim()); return Number.isFinite(n) && n > 0 ? n : 0; };
   ```
   Comentar: *"`Comensal_D` vacío = fila anterior a Fase 4 → TITULAR (misma retro-compat que `parseTipos` en `api/isolations.ts:23-27`)"*.
3. **GET** (hoy e histórico): sumar `comensal` y `orden` al map.
4. **POST — validación.** Aceptar `comensal` y `spItemId`. `const comensalVal = COMENSALES.includes(String(comensal ?? 'TITULAR')) ? String(comensal ?? 'TITULAR') : '';` → 400 si vacío. El default `'TITULAR'` mantiene compatible a cualquier caller viejo. Las validaciones existentes aplican **igual** al acompañante; solo se ramifica la resolución de la fila destino.
5. **POST — resolución (el corazón).** **Una sola query**, gracias a `DiaComanda_D` de Fase 2:
   ```
   fields/CamaLabel_D eq '<esc>' and fields/Comida_D eq '<X>' and fields/DiaComanda_D eq '<hoyART>'
     and fields/Entorno_D eq '<E>'
   ```
   `$top=50` + `Prefer: HonorNonIndexed...`. **Sin `DiaComanda_D` en el filtro, el `$top` no es un tope** (`api/dietas.ts:59-61`) y una cama de 30 días acumula ~60 filas para ese exacto (cama, comida) → el titular puede caer fuera de la página → se crea un **segundo titular activo** (dos bandejas para el mismo paciente); el espejo en el soft-delete devuelve `{ ok: true, message: 'No active meal load found' }` (`:246`) → "Quitar" no hace nada y la UI dice que sí. Con el día en el filtro, el resultset es ≤ 1+MAX **por construcción**.
   - **RAMA A** — `spItemId` presente → ⚠️ **resolverlo desde ese mismo resultset**: `rows.find(r => String(r.id) === String(spItemId))`; si no aparece → **409** (fue cerrada por otro, o no pertenece a ese cama+comida+día). Nunca PATCHear un id arbitrario del cliente: con el poll de 60s, A elimina el acompañante 2 y B (stale) lo edita → PATCH sobre una fila `Inactivo` → 200, "guardado", y la comanda **nunca aparece**. Nunca tocar `Comensal_D`/`OrdenComensal_D` (la identidad de la fila es inmutable).
   - **RAMA B** — TITULAR → `rows.find(comensalOf === 'TITULAR')`; si existe PATCH (idéntico a hoy), si no INSERT con `Comensal_D:'TITULAR'`, `OrdenComensal_D:'0'`.
   - **RAMA C** — ACOMPAÑANTE sin `spItemId` → `acomps = rows.filter(comensalOf === 'ACOMPANANTE')`; si `>= MAX_ACOMPANANTES` → 400; `orden = Math.max(0, ...acomps.map(ordenOf)) + 1`; **INSERT siempre**.
   - Devolver `{ ok: true, spItemId, comensal, orden }` — el `orden` es lo que le permite al hook insertar la fila sin refetch.
6. **PATCH (soft-delete).** El camino por `spItemId` (`:230`) ya funciona. Arreglar el camino por (bedLabel+comida) (`:231-245`): hoy `$top=1` + `data.value[0]` → con acompañantes puede **dar de baja el acompañante en vez del titular**. `$top=50` + filtro de día + `rows.find(comensalOf === 'TITULAR')`.
7. **`types.ts`.** `Comensal`, `MAX_ACOMPANANTES`, `comensal`/`orden` en `MealLoad`, `interface MealSlotLoad { titular?: MealLoad; acompanantes: MealLoad[] }`, `Bed.meals: Partial<Record<MealSlot, MealSlotLoad>>`. `acompanantes` **siempre** array (nunca `undefined`).
8. **`hooks/useHospitalState.ts`.**
   - `fetchMeals`: agrupar bedLabel → slot → titular/acompanantes; ordenar por `orden` asc con desempate `Number(spItemId)` asc. ⚠️ **Obligatorio, no cosmético**: sin `$orderby` (vetado) los bloques **bailan** de posición entre polls mientras alguien tipea.
   - ⚠️ **Dos escrituras optimistas que dropean acompañantes bajo el shape anidado, y que el diseño original no enumeraba:**
     - `:680` — `cur[comida] = {...}` es **reemplazo total** → pisa el `MealSlotLoad` entero y borra `acompanantes`. Pasa a: `const s = cur.slots[comida] ?? { acompanantes: [] }; cur.slots[comida] = { ...s, titular: {...} };`
     - `:711/:715` — `delete cur[comida]` → "Quitar" el titular **borra el slot completo con sus acompañantes**. Pasa a: `delete cur.slots[comida].titular` + borrar el slot solo si `!titular && !acompanantes.length` + borrar la entry del bed solo si no queda ningún slot.
     
     El poll de 60s los restaura → el bug se ve como *"los acompañantes parpadean y vuelven"*, y en esa ventana el usuario puede re-agregar duplicados. `acompanantes` **requerido** hace que `tsc` marque (a); (b) es un `delete` que compila igual → verificar a mano.
   - `saveCompanionLoad(bed, comida, { spItemId?, tipo, detalle, observaciones }) → Promise<{ ok, spItemId? }>`: con `spItemId` = optimista (calca `:676-683`); sin él (alta) **no toca el Map** antes del POST y recién con `{ok, spItemId, orden}` inserta y reordena. Ante `!r.ok`/catch → `fetchMeals()` + `{ ok: false }`.
   - `clearCompanionLoad(bed, comida, spItemId)`: optimista + PATCH.
   - Deps: `[authFetch, currentUser, fetchMeals]`. **No** meter `meals` como dep (`clearMealLoad` ya lo hace y se recrea en cada poll) — usar el updater funcional de `setMeals`.
9. **`BedsView` — `CompanionEditor`** (después de `:275`). `companion === undefined` = **draft local**. Estado propio + **su propio `editedRef`** + **su propio efecto de re-sync** por `sig` (el guard de `:188-199` es **por instancia**; con 4 turnos × 6 acompañantes son hasta 28 instancias). Header `Acompañante {index}` con `index` = posición **visual** 1..N. `canSave = !!tipo && dirty && (tipo !== 'OTROS' || detalle.trim() !== '')`. Guardar → `if (r.ok) editedRef.current = false; else setError('No se pudo guardar. Reintentá.')`. Eliminar: draft → `onDiscardDraft` (sin red); persistido → `onRemove(bed, slot, spItemId)`. Modo lectura calcando `:201-216`.
10. **`BedsView` — `MealSlotEditor`.** `const meal = bed.meals?.[slot]?.titular;`, `const acomps = bed.meals?.[slot]?.acompanantes ?? [];`. `const [drafts, setDrafts] = useState<string[]>([])` con **contador local** (`const nextDraftId = useRef(0)`), no `crypto.randomUUID()` (0 usos en el repo, exige secure context — no vale introducir una API nueva del browser para la key de un array de ≤6). Sub-sección "Acompañante/s" + botón "+ Agregar acompañante" (solo si `canEdit`, oculto si `acomps.length + drafts.length >= MAX_ACOMPANANTES`). ⚠️ **El colapso de Fase 2 debe seguir siendo CSS**: con drafts adentro, desmontar borra un acompañante a medio tipear.
11. **`App.tsx:662`** — `onSaveCompanion` / `onClearCompanion`.
12. **`ComandasManagementView`.** `comensal`/`orden` en `ComandaRow`; una fila por bandeja en ambas tabs; `comensalLabel(r) = r.comensal === 'ACOMPANANTE' ? \`Acompañante ${r.orden}\` : 'Paciente'`; columna/pill "Comensal". ⚠️ **PDF:** `columnStyles: { 5: {...}, 6: {...} }` (`:155`) apunta **por índice** a Detalle/Observaciones — insertar la columna los corre a 6/7. Falla visual silenciosa que solo se ve imprimiendo. El contador "<n> comandas" pasa a contar **bandejas** — es correcto: cocina cuenta bandejas, no pacientes.

**Criterios de aceptación**

- "+ Agregar acompañante" agrega un bloque con selector + comanda + observaciones + eliminar. Se cargan **por turno**: uno en Almuerzo no aparece en Cena.
- Guardar crea **una fila nueva** con `Comensal_D='ACOMPANANTE'`, `OrdenComensal_D = max(orden del día)+1`, `DiaComanda_D` = hoy, y el mismo `CamaLabel_D`/`Comida_D`/`PacienteCodigo_D`/`Area_D` que el titular.
- El titular se guarda como hoy, con `Comensal_D='TITULAR'`/`OrdenComensal_D='0'`. **Guardar/actualizar el titular NO modifica ningún acompañante** ni lo hace parpadear.
- **"Quitar" en el titular inactiva solo la fila TITULAR**; los acompañantes siguen activos y visibles.
- Eliminar un acompañante inactiva **su** fila; los ordinales de los restantes **no cambian en SP** y la UI los re-etiqueta 1..N.
- Tras eliminar el acompañante 1 (con el 2 vivo) y agregar uno nuevo, el nuevo toma **orden 3** (no se reciclan ordinales).
- Un turno puede tener **acompañantes sin titular**: se renderizan, guardan y ven en Gestión Comandas.
- Las filas pre-Fase 4 (sin `Comensal_D`) se leen como TITULAR **con o sin backfill corrido**.
- Acompañante con "Otros" y comanda vacía: Guardar deshabilitado; si un caller igual manda el POST → 400.
- **Si el POST falla, el bloque NO se revierte en silencio**: error inline y conserva lo tipeado.

**Criterios de aceptación — sin arrastre (D14 / P3)**

- Cama con acompañante cargado **ayer** y nada hoy → al abrir el turno hoy **NO aparece ningún bloque de
  acompañante**. Arranca en cero; se agrega a mano con "+ Agregar acompañante".
- Ídem el **titular**: cama con titular cargado ayer y nada hoy → el bloque arranca **vacío**, sin la comanda de ayer.
- Abrir una tarjeta **nunca** crea filas en SharePoint (verificar por Graph que no hay filas con `DiaComanda_D = hoy`
  hasta que alguien toque Guardar).
- Lo cargado **ayer** sigue existiendo e íntegro en SP y en el histórico de Gestión Comandas (no se pisa ni se borra
  — eso es justamente lo que arregla `DiaComanda_D` / D7).
- Editar un acompañante que otro usuario eliminó → **409** + error inline (no un falso "guardado").
- Gestión Comandas y PDF: una fila por bandeja, columna Comensal, anchos correctos.
- El indicador del platito se enciende si el turno tiene **titular O acompañantes**.
- Usuario con solo `ver_dieta`: ve los acompañantes en lectura, sin "+ Agregar" ni eliminar.
- `dev-server.ts` y `vercel.json` sin cambios.

---

### Fase 5 — UX fina, feedback de error y docs

**Archivos:** `hooks/useHospitalState.ts`, `views/BedsView.tsx`, `views/ComandasManagementView.tsx`, `components/ui/calendar.tsx`, `docs/arquitectura.md`, `docs/decisiones.md`, `docs/convenciones.md`

**Pasos**

1. **Matar la reversión muda.** `saveMealLoad` (`useHospitalState.ts:670-706`) pasa de `Promise<void>` a `Promise<{ ok: boolean; error?: string }>`: leer el body (`const data = await r.json().catch(() => ({}))`) y devolver `data.error`. Hoy ante `!r.ok` solo llama `fetchMeals()` (`:703,705`) y revierte **sin feedback**. Con 4 turnos, autocompletado y comanda obligatoria en OTROS, eso es inaceptable. El cambio de negocio sigue en el hook (regla del repo); `BedsView` **solo pinta el string** en un `<p>` inline rojo dentro del box del turno (un toast global no diría cuál de los 4 falló).
2. **Confirmar** que `observaciones` sigue opcional en los 4 turnos y los 3 tipos (`BedsView.tsx:256-258`, placeholder "Observaciones (opcional)").
3. **`components/ui/calendar.tsx:61`** — `new Date().toISOString().split('T')[0]` → `toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })`. Hoy el puntito de "hoy" se calcula en **UTC** → entre las 21:00 y 00:00 ART marca **mañana**, justo cuando se eligen rangos de noche. Contradice `decisiones.md §18.8` y `convenciones.md:2355-2371`. Toca un componente compartido por 4 vistas pero es estrictamente display.
4. **Deuda de duplicación** (decidir explícitamente, no por inercia): `DateRangeTrigger` está copiado 3 veces (`CleaningManagementView.tsx:28-42`, `ComandasManagementView.tsx:33-47`, `HistoryView.tsx:41`) y `AREA_LABELS`/`fmtWhen` 2, **con un comentario que dice *"exportar si un 3er lugar lo necesita"*** (`CleaningManagementView.tsx:12`). El 3ero ya llegó. `artDay` está triplicado (`lib/fasting.ts:96`, `api/dietas.ts:33-36`, `ComandasManagementView.tsx:93`) y este feature agregaría una 4ta. **`api/art.ts` compartido es trivial** (import api→api normal, como `./graph.js`) — sigue siendo válido duplicar, pero que sea decisión.
5. **`docs/arquitectura.md`:** endpoint `api/carga-menu.ts`; lista 16.CargaMenu (GUID); tabla de columnas de 16.CargaMenu con indexado marcado; columnas nuevas de 15.CargaComandas (`DiaComanda_D`, `Comensal_D`, `OrdenComensal_D`) + la nota de cardinalidad; tabla de segregación por Entorno; el overlay `mealPlans` del hook y su poll.
6. **`docs/decisiones.md` §28** (la última es §27, `:1342`), formato Qué/Por qué/Alternativas/Impacto: 28.1 date-only round-trip (`T12:00:00Z` write, `.slice(0,10)` read, **prohibido `artDay` sobre date-only**); 28.2 solapamiento en JS; 28.3 pre-check + 409 **sin** post-verify + desempate determinístico de lectura; 28.4 `TIPOS_PLAN` sin OTROS; 28.5 permisos + enforcement server-side; 28.6 GET fail-hard; 28.7 `DiaComanda_D` y la clave de upsert; 28.8 acompañantes como fila (y **por qué §12.1 no aplica**); 28.9 derogación de "Otros por dieta".
   > ⚠️ En §28.5 citar **`api/tickets.ts:359-372`** como único precedente (y aclarar que es de **pisos**, no de permisos). **No citar `api/me.ts`**: toma el `roleName` de un **query param del cliente** (`:26`) — no es authz. Y asentar la deuda: `api/roles.ts`/`api/users.ts` hoy son solo `requireAuth`.
7. **`docs/convenciones.md`** — sección nueva con 3 patrones: (a) **"Fecha calendaria (date-only) vs instante"** — cuándo `.slice(0,10)` y cuándo `artDay()`, con la trampa explícita de que `artDay` sobre una columna Fecha **resta un día**, y por qué se escribe `T12:00:00Z` y no `T00:00:00Z`; (b) **"Un dominio se amplía por superset en columna Texto"** — el turno no necesitó columna nueva (`create-dietas-list.mts:48-52`); (c) **"Permiso enforceado server-side"** — el JWT trae `role` (enum grueso de `mapRole`, `api/auth.ts:37-48`) pero **no** el `NombreRol_RT` ni `permissions` → resolver por `getUserAreasById(userId).perfil`; el gate del cliente es UX, no seguridad.
8. Correr la skill `update-docs` al cierre.

**Criterios de aceptación**

- Un POST que devuelve 400 muestra el mensaje **inline en el box de ese turno**. Cero reversiones mudas.
- Observaciones vacía se guarda en los 4 turnos × 3 tipos.
- El puntito de "hoy" del Calendar marca el día ART entre las 21:00 y 00:00.
- `docs/arquitectura.md` tiene 16.CargaMenu en las 3 tablas + la de columnas; `decisiones.md` tiene §28; `convenciones.md` tiene la sección con la trampa de date-only escrita.

---

## 5. Riesgos y trampas (priorizados)

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **Off-by-one de fecha.** Basta que alguien "unifique" el mapeo reusando `artDay()` (el helper canónico del repo, y **correcto** para `FechaCarga_D`) sobre `FechaInicio_CM` para correr toda la vigencia un día. Solo se ve en el **primer y último día** de cada rango. Y `T00:00:00Z` rompe la UI de SP sin romper la API. | Fase 0 bloqueante. `T12:00:00Z`. Comentario explícito en el helper. Criterio de aceptación dedicado al borde. Verificar **en la UI de SP**, no solo por Graph. |
| 2 | ~~**Ternario binario de turno**~~ ✅ **CERRADO (2026-07-15)** — catálogo único `MEAL_SLOTS` en `types.ts` + `spFromMealSlot`/`mealSlotFromSp`. Verificado agregando `desayuno` temporalmente: `tsc` frena y el mapeo da `'DESAYUNO'` (el ternario viejo daba `'CENA'`). | — Ya no aplica. El paso 5 de Fase 2 se cae. |
| 3 | **Crecimiento sin techo de filas Activo** → `Status_D='Activo'` matchea >5000 → SP devuelve un **subconjunto parcial** → comandas que existen no llegan a la app, **sin error**. Es el incidente de `api/cron-cleanup-notifs.ts:6-12`. | `DiaComanda_D` indexada + filtro OData por día (D7, Fase 2). |
| 4 | **Rollout de permisos.** El día del deploy el botón es invisible **para todos**, incluido el admin. Se reporta como "la feature no salió". | Paso manual coordinado + verificar si hace falta re-login. |
| 5 | **`ENTORNO` con default `'TESTING'`** (`api/dietas.ts:24`). Si falta en Vercel prod, todo se escribe con `Entorno_CM='TESTING'` y el GET de prod no lo ve. Agravante: el usuario reintenta y, como el GET tampoco ve las anteriores, el pre-check no encuentra conflicto → **filas duplicadas invisibles**. | Fase 0. |
| 6 | **Titular pisando/borrando un acompañante.** `$top=1` + `data.value[0]` (`api/dietas.ts:162-169`, `:234-244`): con acompañantes, ese `[0]` puede ser un acompañante. | Fase 4 pasos 5-6. Es la regresión más probable de la fase — los criterios de aceptación existen para cazarla. |
| 7 | **Escrituras optimistas que dropean acompañantes** (`useHospitalState.ts:680`, `:715`) bajo el shape anidado. El poll las restaura → *"parpadean y vuelven"*, y en esa ventana se re-agregan duplicados. | Fase 4 paso 8. `acompanantes` requerido hace que `tsc` marque una de las dos; la otra hay que verificarla a mano. |
| 8 | **Escape / clipping en el modal.** `DialogContent` cierra con Escape sin chequear `defaultPrevented` (`dialog.tsx:64-71`) y aplica `overflow: clip` (`:88`). `select.tsx` no portaliza (`:95-101`). `SearchableSelect` portaliza pero **no expone `open`** (`:11-32`) → su Escape cierra el modal y el guard no puede verlo. **Cero precedente de Popover dentro de Dialog.** | Botones-toggle para Turno/Tipo. Guard de Escape solo para los 2 datepickers, **documentado**. |
| 9 | **Contrato de vocabulario.** Si Fase 1 guarda `'Almuerzo'`/`'Menú'`, el lookup nunca matchea. Síntoma **mudo**: *"siempre dice que no hay comanda planificada"*. | `norm()` en lectura + contrato en el JSDoc + `mealPlanKey()` compartido server/cliente. |
| 10 | **`Status_CM` es texto libre**, no Choice como `Status_D` (`create-dietas-list.mts:55`). Un `'inactivo'` en minúscula se escribe sin error y la fila queda visible **para siempre**. | Constante única en el endpoint. |
| 11 | **`UserID_CM` / `NutricionistaID_D` son Número** → rechazan el string vacío y hacen fallar el request **entero** (`inspect-dietas-list.mts:35`). Síntoma: *"no puedo crear/editar nada"*, que no apunta al campo de usuario. | `uidField()` extraído y usado en POST **y** PATCH. |
| 12 | **`Comanda_CM` es single-line 255**, mientras `Detalle_D` (donde Fase 3 copia) es multilínea 500. Un `<textarea>` contra single-line → SP strippea o rechaza. | Fase 0 confirma el `maxLength`. Ver **P5**. |
| 13 | **Duplicado por fallo transitorio** (`api/dietas.ts:169` → cae al POST de `:187`). `fetchMeals` lo enmascara con last-one-wins (`:663`). | Fase 2: devolver 500 si `!existing.ok`. |
| 14 | **Carrera en el alta.** Dos usuarios crean el mismo turno+tipo → pasan los dos el pre-check. SP no tiene transacciones ni constraints. **Consecuencia aceptada** (D8): el desempate de lectura lo hace inocuo y el duplicado es visible/borrable. | Documentar, no sobre-ingeniar. Ver **P6**. |
| 15 | **Colapso por render condicional** destruye lo tipeado y los drafts. Riesgo hermano preexistente que esta fase agrava: el tab Dieta se monta con `activeTab === 'dieta' && (...)` (`:2259`) → cambiar de tab ya hoy pierde lo tipeado, y con 4 boxes son 4× más chances. | `hidden`. El de tabs no se arregla acá (implica subir el state al padre) — dejarlo consciente. |
| 16 | **PWA con clientes cacheados.** Un bundle viejo descarta las filas DESAYUNO/MERIENDA (`:653`). Falla safe, pero el usuario reporta "no se guardó". | Solo visualización, no corrupción. |
| 17 | **PDF por índice.** `columnStyles: { 5, 6 }` (`ComandasManagementView.tsx:155`) apunta por índice a Detalle/Obs. Insertar "Comensal" los corre. Falla visual **silenciosa** que solo se ve imprimiendo. | Fase 4 paso 12. |
| 18 | **Poll de 5 min = staleness aceptada.** Si Nutrición edita la planificación y otra persona tiene la tarjeta abierta, autocompleta el texto viejo hasta 5 min. No es bug, es el ritmo del cache — decirlo en soporte. | Documentar. |
| 19 | **Docs stale a no copiar.** El JSDoc de `api/cron-diet-changes.ts:2-6` afirma que corre un cron que `vercel.json` **no programa** (`docs/arquitectura.md:1249`, `decisiones.md:1123`). La lógica viva de dieta está en `api/cron-enrich-beds.ts:307`. | No tomarlo como referencia. |
| 20 | **La comanda deja de arrastrarse — cambio visible para Nutrición.** Hoy la del titular persiste de un día al otro por **accidente** del upsert sin día (`api/dietas.ts:162-169`): la fila de ayer se pisa y parece "seguir ahí". Con `DiaComanda_D` (D7) + D14 eso termina: **cada día arranca en cero**. Es lo correcto y es lo que el usuario definió, pero Nutrición va a ver que "se borró lo de ayer" / "hay que cargar todo de nuevo" y lo va a reportar como bug. Aplica a titular **y** acompañantes (misma regla, sin asimetría). | Avisar a Nutrición **antes** del deploy de Fase 2 (no de la 4): es ahí donde entra `DiaComanda_D` y cambia el comportamiento. Aclarar que **lo de ayer no se perdió** (está en el histórico), solo que ya no se re-usa como plantilla del día. |

---

## 6. Preguntas abiertas → **todas resueltas** (2026-07-15)

> **Las 8 quedaron definidas por el usuario.** Ninguna bloquea la implementación. Resumen:
>
> | # | Definición | Impacto |
> |---|---|---|
> | **P1** | Sin excepciones dentro de un rango → 409 duro | Confirma D8. Sin cambios |
> | **P2** | `CUSTOM_COMANDA_DIETS` → preselección, no bloqueo | Confirma D12. Sin cambios |
> | **P3** | **Sin arrastre** — cada día en cero | **Cambió D14** (se descartó el arrastre) y **simplificó Fase 4** |
> | **P4** | Sin nombre de comensal, sin facturación | Sin columnas nuevas. `MAX_ACOMPANANTES=6` = backstop, no regla |
> | **P5** | Sin multilínea → single-line 255 | `<input>` + `maxLength`. **Cierra el riesgo #12** |
> | **P6** | Varios escritores, concurrencia improbable | Se mantiene el 409. Riesgo #14 = consecuencia aceptada |
> | **P7** | Menú **global**: ni por sede, ni por piso, ni por dieta | Clave = `Turno + Tipo`. El "por dieta" es posible a futuro → **mantener `mealPlanKey()` y `findOverlaps()` como helpers únicos** |
> | **P8** | Vivas editables, vencidas read-only | **Regla nueva** en Fase 1: validación server + filtro de grilla |
>
> **Único ítem que sigue necesitando un dato (no una definición):** el probe de Fase 0 — round-trip de fechas,
> `maxLength` real de `Comanda_CM`, y `ENTORNO` seteada en Vercel prod.

### P1 — ✅ RESUELTO: NO existe el caso "excepción dentro de un rango" → bloqueo duro (409)

**Definición del usuario:** no hay excepciones dentro de un rango. Un solo rango vigente por `Turno + Tipo`.

**Consecuencia (lo diseñado, sin cambios):**
- `findOverlaps` rechaza con **409** cualquier alta/edición que solape con una activa de igual `Turno + Tipo`
  (pre-check + 409, calcado de `api/tickets.ts` — ver **D8**).
- La precedencia **no** es lógica de negocio: no hay que resolver "cuál gana" ni mostrarlo en la tarjeta.
- El desempate de lectura se conserva **solo** como red defensiva para filas históricas y carreras (D8).

**Contexto original de la pregunta (para el registro):** el ejemplo era un menú planificado para todo julio
con el 09/07 (feriado) sirviendo otro. Ese caso exigiría rangos solapados + precedencia por especificidad.
Queda **explícitamente fuera de alcance**: si el negocio lo pide más adelante, es un cambio de modelo, no de UI.

### P2 — ✅ RESUELTO: se conserva como **preselección** no bloqueante

**Definición del usuario:** degradar `CUSTOM_COMANDA_DIETS` a preselección (opción recomendada). Es exactamente **D12**.

**Consecuencia:**
- Las 3 opciones (`MENU | OPCION | OTROS`) quedan **siempre** disponibles para todas las dietas y turnos (deroga `forceOtros` como restricción).
- Si la dieta del paciente está en `CUSTOM_COMANDA_DIETS` (`lib/utils.ts:255-258` — 13 dietas terapéuticas:
  liviana, líquida, espesada, astringente, blanda, hepática, "nada por boca"...), el turno **arranca preseleccionado
  en `OTROS`**, pero se puede cambiar libremente.
- **NO se borran** `CUSTOM_COMANDA_DIETS` ni `dietRequiresCustomComanda`: se conserva el conocimiento clínico,
  cambia solo su fuerza (de bloqueo → default).
- 0 clicks en el caso frecuente; el selector queda a la vista.

`dietTypeOf` se queda igual (lo usa el filtro por tipo de dieta del mapa — `BedsView.tsx:468,544`).

(`dietTypeOf` se queda en ambos casos: lo usa el filtro por tipo de dieta del mapa, `BedsView.tsx:468,544`.)

### P3 — ✅ RESUELTO (con matiz pendiente): los acompañantes **SÍ se arrastran** día a día

**Definición del usuario:** el acompañante se arrastra día a día — no se carga de cero cada día.

**Consecuencia:** hace falta un mecanismo de arrastre que **no existe en el diseño original de Fase 4**
(que asumía carga de cero por el `DiaComanda_D`). Ver **Fase 4, paso "arrastre"**.

> ⚠️ **Matiz a confirmar antes de codear Fase 4:** "se arrastra" puede significar dos cosas distintas:
> - **(a) Arrastre de presencia** *(interpretación por defecto, semánticamente más sólida)*: se arrastra el
>   **hecho de que hay un acompañante** (la fila/bloque aparece pre-creada al día siguiente), pero su
>   **comanda se resuelve fresca** para el día nuevo (autocompletada de la planificación de ese día).
>   Es lo correcto: el acompañante persiste durante la internación, pero el menú del martes no es el del lunes.
> - **(b) Copia total**: se copia tipo + comanda + observaciones tal cual de ayer.
>   Riesgo: arrastra el **texto del menú de ayer**, que casi seguro no es el de hoy.
>
> El diseño toma **(a)** salvo indicación contraria. **Relacionado:** con `DiaComanda_D` el **titular** deja de
> arrastrarse (hoy lo hace por accidente del upsert). Si el titular también debe arrastrarse, es el mismo mecanismo.

### P4 — ✅ RESUELTO: sin nombre, sin facturación

**Definición del usuario:** ninguna de las dos. Solo se marcó "se arrastra día a día" (P3).

- **`NombreComensal_D` → NO se agrega.** El acompañante lleva solo tipo + comanda + obs + eliminar (spec literal).
- **Facturación → NO se modela.** Sin `SinCargo_D`/`Facturable_D` ni reporte de cargos.
- **Tope:** `MAX_ACOMPANANTES = 6` queda como **backstop de seguridad inventado**, no como regla de negocio
  (no se definió un tope real). Es solo una guarda anti-abuso; si aparece un tope real, es una constante.

### P5 — ✅ RESUELTO: **no** hace falta multilínea → `Comanda_CM` queda single-line 255

**Definición del usuario:** *"no hace falta, dudo que escriban tanto texto"*.

> ### ✅ VERIFICADO (probe de Fase 0, 2026-07-15)
> - `Comanda_CM` = `text(maxLength=255, multiline=false)`. **255 confirmado**, no era un supuesto.
> - Se intentó escribir **300 chars** → SharePoint devolvió **`400 Invalid request`**. **No trunca: rechaza el
>   write entero.** Eso convierte el tope en un requisito duro del form: si el usuario pega 300 chars, el POST
>   falla completo y el error de SP (*"Invalid request"*) no dice **cuál** campo lo causó.
> - ⇒ **La validación en el cliente no es cosmética, es obligatoria.**

**Consecuencia:**
- **No se migra** `Comanda_CM`. Queda single-line, 255 chars.
- El form usa **`<input maxLength={255}>`**, no `<textarea>` (un textarea contra una columna single-line hace que
  SP strippee los saltos o rechace el write — riesgo #12, que con esto **se cierra**).
- **Validación en el endpoint también** (`comanda.trim().length > 255` → 400 con mensaje claro), porque el
  `maxLength` del input no protege de un paste programático ni de otro caller.
- Al copiar a `Detalle_D` (multilínea 500) no hay problema: 255 ≤ 500. La asimetría es inofensiva **en esa dirección**.

### P6 — ✅ RESUELTO: varias personas, pero concurrencia improbable → **se mantiene el pre-check + 409**

**Definición del usuario:** *"realmente no sé, serán varias por diferentes pisos, dudo que haya concurrencia"*.

**Consecuencia (lo diseñado, sin cambios):** se mantiene **D8** (pre-check + 409, calcado de `api/tickets.ts`).
Como hay **varios escritores potenciales**, no se puede asumir escritor único y sacar el chequeo. Y como el patrón
ya existe en el repo, el costo es copiar, no inventar. La carrera del alta (riesgo #14) queda como
**consecuencia aceptada y documentada**: es improbable, el desempate de lectura la hace inocua, y el duplicado
sería visible y borrable.

> 📌 **Detalle a no perder de vista.** "Varias **por diferentes pisos**" merece una confirmación cuando se encare
> Fase 1: el diseño asume que la **planificación del menú es global** (P7 — una sola planificación por
> `Turno + Tipo` y entorno, que es como cocina un hospital). Si resultara que **el menú planificado varía por piso**,
> el modelo cambia: haría falta `Area_CM` y la clave de solapamiento pasaría a `Turno + Tipo + Area`.
> La lectura por defecto es que los pisos reparten **quién carga las comandas de los pacientes**
> (`15.CargaComandas`, que ya tiene `Area_D`), no **qué menú se planifica**.

### P7 — ✅ RESUELTO: el menú es **global** — ni por sede, ni por piso, ni por dieta

**Definición del usuario:** *"por ahora sin sede"* + *"el menú es global, no es x piso, ni tampoco x dieta
(quizás sea x dieta más adelante, who knows)"*.

**Consecuencia (lo diseñado, sin cambios):** no se agregan `Sede_CM`, `Area_CM` ni `Dieta_CM`. La clave de
solapamiento y de lookup queda en **`Turno + Tipo`** (dentro de un `Entorno_CM`). Es como cocina un hospital:
un menú, una cocina.

**Los pisos NO son una dimensión de la planificación.** Los "varias por diferentes pisos" de P6 reparten
**quién carga las comandas de los pacientes** (`15.CargaComandas`, que ya tiene `Area_D`), no **qué menú se planifica**.
Confirmado por el usuario.

#### 📌 El "por dieta" ya tiene una respuesta implícita hoy — y es coherente

Que el menú planificado sea global plantea una pregunta obvia: *¿qué come el paciente con dieta hepática si el
"Menú" es uno solo para todos?* **La respuesta ya está en D12/P2:** las 13 dietas terapéuticas de
`CUSTOM_COMANDA_DIETS` (`lib/utils.ts:255-258`) **arrancan preseleccionadas en `OTROS`**, que exige comanda escrita
a mano. O sea: **el menú planificado es para las dietas generales; las terapéuticas se escriben caso por caso.**

Eso no es una casualidad del diseño — es exactamente por qué existe `CUSTOM_COMANDA_DIETS`. El sistema ya sabe
que el menú global no aplica a esas dietas, y por eso empuja a "Otros".

#### 📌 Si más adelante se planifica **por dieta** (deuda técnica consciente)

El usuario lo marcó como posible. Qué implicaría, para que nadie se sorprenda:

| Qué | Cómo |
|---|---|
| **Esquema** | `Dieta_CM` (Texto, indexada). Migración **barata**: las filas existentes = "aplica a todas" (centinela `'GENERAL'` o vacío). A diferencia de `Sede_CM`, acá el default retroactivo **no es ambiguo**. |
| **Clave** | Solapamiento y lookup pasan a `Turno + Tipo + Dieta`, con fallback a la fila `GENERAL` si no hay una específica. |
| **Blast radius** | **Contenido**, si se respeta el diseño: la clave está centralizada en `mealPlanKey()` (compartido server/cliente, ver riesgo #9) y el solapamiento en `findOverlaps()` (D8). Tocar esos dos + el filtro del GET alcanza. |
| **UX** | La preselección de "Otros" en dietas terapéuticas (D12) se **relajaría**: si hay menú planificado para "hepática", ya no hace falta empujar a "Otros". D12 quedaría solo para las dietas sin planificación. |

**Por qué NO se construye ahora:** el negocio no lo pidió, la migración es barata y no ambigua, y el cambio queda
contenido en 2 helpers. Agregar hoy una columna que sería siempre `'GENERAL'` es modelar una hipótesis
(*"who knows"*), no un requisito. **Requisito para que esto se cumpla:** que `mealPlanKey()` y `findOverlaps()`
existan como helpers únicos y no se inline la clave en 5 lugares — si eso se respeta, sumar la dimensión después
es barato; si no, es un refactor.

### P8 — ✅ RESUELTO: las **vivas** se editan; las **vencidas** no

**Definición del usuario:** *"se pueden editar sí, las vencidas no... claramente, pero las que están 'vivas' sí se pueden editar"*.

**Regla — una planificación es editable/eliminable solo si `FechaFin_CM >= hoyART`** (vigentes + futuras).
Si `FechaFin_CM < hoyART` está **vencida**: es histórico, read-only.

**Implementación (Fase 1):**
- **Server (fuente de verdad).** El PATCH valida `FechaFin_CM >= hoyART` **antes** de aplicar y devuelve **409**
  (`{ error: 'planificacion_vencida' }`) si no. No alcanza con esconder el botón: el poll de la grilla puede tener
  hasta 5 min de staleness (D4) y un rango que vencía anoche sigue mostrándose editable hasta el próximo refresh.
- **Cliente.** Acciones "Editar"/"Eliminar" deshabilitadas en las filas vencidas, con tooltip *"Planificación vencida"*.
  El 409 del server se muestra inline, no como reversión muda.
- **`hoyART`** con el helper date-only de **D2** (nunca `artDay()` — riesgo #1). El borde importa: una planificación
  que termina **hoy** es editable; recién mañana deja de serlo.

**Lo ya cargado NO se toca (confirmado).** Editar una planificación **no reescribe** retroactivamente lo cargado en
`15.CargaComandas`: es copia por valor, no link vivo (semántica del propio usuario). No hace falta flujo de
re-sincronización. Sí implica que editar una planificación **vigente** solo afecta a las comandas que se carguen
**de ahí en adelante** — las de esta mañana quedan con el texto viejo. Es lo correcto (una comanda ya emitida es un
hecho), pero conviene decirlo en soporte.

**Grilla del modal (sub-pregunta, resuelta por consecuencia).** Como las vencidas no se editan, se acumularían como
ruido. **Default: mostrar vigentes + futuras**, con un toggle *"Ver vencidas"* que las trae en modo lectura
(atenuadas). Sin esto, a los meses la grilla es inusable y el usuario tiene que scrollear historia para encontrar
lo de esta semana.