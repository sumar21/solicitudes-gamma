# MediFlow — Tres features: diseño consolidado

> Documento de decisión. Incorpora las correcciones de la revisión adversarial: donde un diseño fue refutado, acá figura la versión corregida.

---

## 1. Resumen

| # | Feature | Qué se toca | Tamaño | Riesgo |
|---|---------|-------------|--------|--------|
| 1 | Tag de sexo sugerido en camas libres | `lib/utils.ts` (helper nuevo) + `views/BedsView.tsx` (celda + modal) | Chico (~60 líneas) | **Bajo** — aditivo, sin cambios de tipos ni props |
| 2 | Buscador en el monitor de comandas | `lib/utils.ts` (`normalizeText`) + `views/ComandasManagementView.tsx` | Chico (~45 líneas) | **Bajo** — filtro sobre una variable local, sin backend |
| 3 | Limpiezas dentro de Operativa | `types.ts`, `App.tsx`, `RequestsView.tsx`, `CleaningManagementView.tsx`, `RoleManagementView.tsx`, `useHospitalState.ts`, `docs/` | Medio-grande (7 archivos + **migración de datos en SP**) | **Alto** — toca navegación, gates de acceso y datos productivos de roles |

Los features 1 y 2 son independientes entre sí y del 3. El 3 requiere una decisión de datos **antes** de escribir código (§8, pregunta 1).

---

## 2. Estado actual

### Feature 1 — sexo en la UI

| Existe | Ref |
|---|---|
| `Bed.sex?: 'M' \| 'F'`, viene del enrich (cron 15 min → SP `12.EnrichCamas` → merge) | `types.ts:81`, `api/enrich-core.ts:62`, `api/beds.ts:115` |
| `roomSexConflict(beds, originLabel, destLabel)` — habitación = `roomCode` + `area` | `lib/utils.ts:235-250` |
| Warning no bloqueante de sexo al crear traslado | `components/modals/NewRequestModal.tsx:123-125, 211-217` |
| Tile "Sexo" en el modal, **solo si OCCUPIED** | `views/BedsView.tsx:2446-2449` (dentro del bloque `isOccupied` de `:2332`) |
| Columna "Sexo" en los **tres** PDFs, vacía si no está ocupada | `views/BedsView.tsx:1119`, `:1363`, `:1594` |
| **NO existe** un componente de celda: la cama es un `<button>` inline en el map | `views/BedsView.tsx:2144-2243` |
| **NO existe** indicador de sexo en la grilla, ni filtro por sexo, ni `sex` en el buscador | `views/BedsView.tsx:784-804`, `:806-829` |
| **NO existe** inverso de `roomSexConflict` ni helper `isAssignable(bed)` | — |

Esquinas de la celda ya ocupadas: sup-der = punto de estado, **siempre** (`:2173`); sup-izq = aislamiento / bloqueo / contacto preventivo (`:2174`, `:2188`, `:2194`); inf-izq = pill multi-aislamiento (`:2182`); inf-der = contenedor **flex** de comanda + ayuno (`:2202`, con comentario en `:2199` que dice explícitamente que es flex "para que no se pisen").

### Feature 2 — buscador de comandas

| Existe | Ref |
|---|---|
| Tabs `activas \| historico`, ambas alimentan la misma variable `data` | `views/ComandasManagementView.tsx:273` |
| Datepickers desde/hasta, botón PDF (jsPDF+autotable), botón Planificación | `:326-368` |
| `formatBedName`, `areaLabel`, `comandaTipoPill`, `STATUS_PILL` ya disponibles | `lib/utils.ts`, `views/BedsView.tsx:169` |
| Idiom NFD duplicado **7 veces** (no 5) | `lib/utils.ts:19, :30, :261`, `api/isolations-summary.ts:42`, `api/push-utils.ts:136`, `views/BedsView.tsx:93, :1540` |
| `COMANDA_STATUS` reusa la columna de soft-delete: PENDIENTE=`'Activo'`, ANULADA=`'Inactivo'` | `types.ts:148-152` |
| El GET de comandas vivas filtra `Activo or Entregado` → **las anuladas no llegan a "De hoy"** | `api/dietas.ts:45, :144` |
| Histórico pagina hasta 20.000 filas | `api/dietas.ts:104-106` |
| **NO existe** search bar; el pill de estado **no está** en las tarjetas mobile (solo en la tabla desktop) | `:396-421` vs `:492` |

### Feature 3 — limpiezas

| Existe | Ref |
|---|---|
| `ViewMode` incluye `'CLEANINGS'` | `types.ts:270` |
| `ROLE_MODULES` incluye `'Gestion Limpieza'` | `types.ts:307` |
| 6 puntos de cableado en App.tsx: import, `SprayCanIcon` inline, gate, 2 sidebars, título, render | `App.tsx:20, 47, 155, 388, 502, 438, 663` |
| 2 fallbacks de landing view que leen `modules` **crudo** con `.includes()` | `hooks/useHospitalState.ts:405`, `:1430` |
| `CleaningManagementView`: 4 props, tabs propios, fetch propio a `/api/limpiezas?history=1`, padding de página propio | `views/CleaningManagementView.tsx:44-49, :126, :95-110, :124` |
| `PERMISSION_GROUPS`: `consolidar_limpieza` vive en el grupo `'Gestion Limpieza'`; `confirmar_limpieza` en `'Operativa'` | `views/RoleManagementView.tsx:58-63`, `:52` |
| Un grupo solo se renderiza si el módulo está tildado | `views/RoleManagementView.tsx:525-526` |
| `MODULES` es una copia manual de `ROLE_MODULES`, tipada como `string` (tsc no las cruza) | `views/RoleManagementView.tsx:32-40` |
| **`syncSessionRole` refresca módulos/permisos de toda sesión viva cada 60 s** sin re-login | `hooks/useHospitalState.ts:956-989` |
| **NO existe** ningún `setCurrentView('CLEANINGS')`, ni router, ni deep-link; el SW nunca setea vista | `src-sw/sw.ts:180-202`, `hooks/useHospitalState.ts:2420-2431` |
| `onTap` de notificación navega a `'REQUESTS'` | `App.tsx:342` |
| Import muerto de `Tabs/TabsList/TabsTrigger` | `views/RequestsView.tsx:12` |
| Botón "Operativa" duplicado en dos ramas idénticas, en ambos sidebars | `App.tsx:376-381`, `:490-495` |

### Baseline de `tsc` — ✅ ACTUALIZADO (2026-07-21): está en CERO

Cuando se escribió este plan, `npm run lint` tenía 2 errores y **no chequeaba las props de ningún
componente**, porque faltaba `@types/react`.

**Ya está instalado** (`@types/react@^18` + `@types/react-dom@^18`). Resultado:

- Los 2 errores de `BadgeProps` eran **falsos positivos**: `key` es una prop especial que
  `@types/react` agrega vía `JSX.IntrinsicAttributes`. Sin esos tipos, TS la buscaba en `BadgeProps`
  y no la encontraba. Desaparecieron solos.
- Aparecieron **2 errores reales** en `views/RequestsView.tsx:201-202`: un `as string` sobre un
  `Area[]` que el cast venía tapando. Corregidos con un guard explícito.

**`npm run lint` da 0 errores**, y ahora sí chequea props (verificado rompiendo una a propósito).

⚠️ Las advertencias de este documento que decían *"tsc NO va a marcar props rotas, enumerá los
call-sites con grep"* **ya no aplican**: el compilador es de nuevo una red de seguridad real.
Criterio para los 3 features: **mantener el lint en cero**.

## 3. Feature 1 — Tag de sexo sugerido en camas libres

### Diseño

Helper puro `suggestedRoomSex(beds)` en `lib/utils.ts`, hermano de `roomSexConflict`, que devuelve **`Map<roomKey, 'M'|'F'>`** con `roomKey = \`${area}|${roomCode}\`` — el sexo al que está *comprometida* cada habitación. La decisión de a qué camas mostrarlo vive **solo en la vista**, con un único criterio: `bed.status`.

Reglas:
- **Ocupante** = `bed.status === BedStatus.OCCUPIED && !!bed.sex`. Nada de `patientName`.
- 0 ocupantes con sexo conocido → sin sugerencia.
- Sexos distintos entre ocupantes → sin sugerencia (silencio > sugerencia engañosa).
- Habitación = `roomCode` + `area` (el criterio de `roomSexConflict`, `lib/utils.ts:245-246`).
- Se calcula sobre `beds` **completo**, nunca `filteredBeds`.

**Por qué `status` y no `patientName`** (corrección de la revisión, era bloqueante): en este repo `patientName` sobrevive a la cama. `hooks/useHospitalState.ts:243-247` pasa una cama de PREPARATION a AVAILABLE sin llamar a `clearPatientFromBed`; `api/beds.ts:141-143` documenta explícitamente residuos (*"puede tener status=Ocupada y eventOrigin/Number residual del array general tras moverse el paciente"*); `copyPatientToBed` (`:97-102`) escribe `patientName` en camas ASSIGNED. Peor: `reapplyEnrichFromMap` (`:119-127`, invocado en `:524`) hace `Object.assign(bed, snap)` con solo chequear `patientCode`, sin mirar status, y `sex` está en `ENRICH_FIELDS` (`:74`) — o sea que un paciente fantasma podía comprometer una habitación vacía. `status === OCCUPIED` es el criterio que usa todo el resto del archivo (`views/BedsView.tsx:1067, :1316, :1594, :2265`).

Efecto colateral deseado: **ASSIGNED nunca compromete la habitación**, en ninguna fase del ticket. Sin esto, el merge de `IN_TRANSPORT` (`:195-201`) y `WAITING_CONSOLIDATION` (`:213-222`) hacía que la misma situación clínica diera sugerencias distintas según la fase del traslado.

### Archivos

| Archivo | Acción |
|---|---|
| `lib/utils.ts` | Agregar `suggestedRoomSex()` después de `roomSexConflict` (`:250`). Sumar `BedStatus` al import existente de `../types` (`:3`) |
| `views/BedsView.tsx` | 5 ediciones: import, memo, gate, chip en la celda, bloque en el modal |

### Pasos

**1.** `lib/utils.ts`, después de la línea 250:

```ts
/**
 * Sexo al que está COMPROMETIDA cada habitación por sus ocupantes actuales.
 * Inverso de roomSexConflict: en vez de avisar el conflicto al mover un paciente concreto,
 * adelanta a qué sexo conviene destinar las camas libres del cuarto.
 * Habitación = mismo roomCode + misma area (mismo criterio que roomSexConflict).
 * Ocupante = status OCCUPIED con `sex` conocido. NO se usa patientName: queda residual
 * en camas ya liberadas (useHospitalState.ts:243-247, api/beds.ts:141-143).
 * Devuelve por HABITACIÓN, no por cama: quién ve la sugerencia lo decide la vista.
 * Best-effort: `sex` viene del enrich y puede faltar → sin sugerencia, sin ruido.
 * Pasar la lista COMPLETA de camas, no la filtrada.
 */
export function suggestedRoomSex(beds: Bed[]): Map<string, 'M' | 'F'> {
  const rooms = new Map<string, Set<'M' | 'F'>>();
  for (const b of beds) {
    if (!b.roomCode || b.status !== BedStatus.OCCUPIED || !b.sex) continue;
    const key = `${b.area}|${b.roomCode}`;
    if (!rooms.has(key)) rooms.set(key, new Set());
    rooms.get(key)!.add(b.sex);
  }
  const out = new Map<string, 'M' | 'F'>();
  for (const [key, sexes] of rooms) {
    if (sexes.size === 1) out.set(key, [...sexes][0]);
  }
  return out;
}
```

**2.** `views/BedsView.tsx:6` — sumar `suggestedRoomSex` al import de `../lib/utils`.

**3.** Después del cierre del memo `blockedByIsolation` (`:679`), antes de `bedTicketMap` (`:682`):

```ts
// Sobre `beds` COMPLETO — igual que blockedByIsolation (:655) — para que los filtros de la
// vista no oculten al ocupante y hagan desaparecer la sugerencia sin explicación.
const suggestedSexByRoom = useMemo(() => suggestedRoomSex(beds), [beds]);

// Gate único para los dos puntos de render (celda + modal). Función plana: se invoca dentro
// del map, no viaja como prop, no memoiza nada río abajo.
const suggestedSexFor = (bed: Bed | null | undefined): 'M' | 'F' | null => {
  if (!bed || !bed.roomCode) return null;
  if (bed.status !== BedStatus.AVAILABLE && bed.status !== BedStatus.PREPARATION) return null;
  if (blockedByIsolation.has(bed.label)) return null;      // no asignable (violeta) → no sugerir
  if (CRITICAL_AREAS_NO_BLOCK.includes(bed.area)) return null; // cubículos independientes / sillones
  return suggestedSexByRoom.get(`${bed.area}|${bed.roomCode}`) ?? null;
};
```

`CRITICAL_AREAS_NO_BLOCK` ya existe en `views/BedsView.tsx:644` (HUC/HUT/HIT/HRA). La exención es la misma que ya aplica el repo al bloqueo por aislamiento, con el mismo motivo documentado en `:642-644` (cubículos físicamente independientes). HRA además son sillones de sala de espera, ya excluidos del contador (`~:838`).

**4.** En las locales por cama del map (`:2145-2151`), agregar:

```ts
const hasMealTag = (canViewComanda && hasAnyMealLoad(bed.meals)) || hasLiveFasting(bed.fasting);
const suggestedSex = suggestedSexFor(bed);
```

**5.** `:2201` — cambiar la condición del wrapper a `{(hasMealTag || suggestedSex) && (` y meter el chip **dentro** del contenedor flex de `:2202`, después del platito de comanda y la pill de ayuno:

```tsx
{suggestedSex && (
  <div
    className={cn(
      "flex items-center justify-center w-3 h-3 md:w-3.5 md:h-3.5 rounded-full border",
      "text-[7px] md:text-[8px] font-black leading-none",
      suggestedSex === 'F'
        ? "bg-rose-50 border-rose-300 text-rose-500"
        : "bg-blue-50 border-blue-300 text-blue-500",
    )}
    title={`Sexo sugerido: ${suggestedSex === 'F' ? 'Femenino' : 'Masculino'} — por los pacientes de la habitación`}
  >
    {suggestedSex}
  </div>
)}
```

**Corrección de la revisión:** el diseño original suprimía el chip si había comanda/ayuno (`!hasMealTag`). Eso es una pérdida silenciosa con probabilidad real: el overlay de comandas (`hooks/useHospitalState.ts:259`) filtra con `if (m.patientCode && bed.patientCode && m.patientCode !== bed.patientCode) continue` — si la cama libre **no** tiene `patientCode`, la condición es falsa y la carga vieja se adjunta igual. El contenedor flex de `:2202` fue creado exactamente para este caso (ver comentario en `:2199-2200`); usarlo elimina la supresión.

**6.** Modal, después del bloque `isPrep` (cierra en `:2720`) y antes de `isDisabled` (`:2722`):

```tsx
{(() => {
  // selectedBed es el snapshot del click (ver :566); con el poll de 60s puede estar vencido.
  const liveBed = beds.find(b => b.label === selectedBed.label) ?? selectedBed;
  const sugg = suggestedSexFor(liveBed);
  if (!sugg) return null;
  return (
    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 flex items-center gap-2">
      <UserIcon className="w-4 h-4 text-slate-400 shrink-0" />
      <p className="text-xs font-medium text-slate-600">
        Sexo sugerido: <span className="font-bold text-slate-800">{sugg === 'F' ? 'Femenino' : 'Masculino'}</span>
        <span className="text-slate-400"> — por los pacientes de la habitación {liveBed.roomCode}</span>
      </p>
    </div>
  );
})()}
```

El patrón `liveBed` ya se usa dos veces en el archivo (`:2613`, variante por id en `:572`). `UserIcon` ya está importado como `User as UserIcon`.

**7.** Verificar: `tsc --noEmit` valida el helper (código de módulo). El JSX **no** lo valida nadie (`@types/react` sin instalar) → verificación visual obligatoria.

### Criterios de aceptación

1. Habitación (mismo `roomCode` + misma `area`) con ≥1 cama **OCCUPIED** con `sex` conocido y todos los ocupantes del mismo sexo → cada cama AVAILABLE/PREPARATION del cuarto muestra un chip pálido M/F.
2. Ocupantes con sexos distintos → **ninguna** cama del cuarto muestra chip.
3. Ningún ocupante con `sex` (enrich ausente) → sin chip, sin errores en consola.
4. Una cama con `patientName` residual pero `status !== OCCUPIED` **no** cuenta como ocupante ni bloquea la sugerencia de su propio cuarto.
5. Camas OCCUPIED, ASSIGNED y DISABLED nunca muestran chip. Bloqueadas por aislamiento (violeta) tampoco. Contacto preventivo (cyan) **sí**.
6. Áreas HUC/HUT/HIT/HRA nunca muestran chip.
7. Con filtro de estado "Disponible" activo, los chips siguen apareciendo igual que sin filtro.
8. El chip **convive** con el platito de comanda y la pill de ayuno en la misma esquina inf-der, sin pisarse y sin que ninguno desaparezca.
9. El chip no tapa el código corto `{roomCode}-{bedCode}` y se ve en mobile (375 px, `grid-cols-5`).
10. Modal de cama con sugerencia: aparece la línea "Sexo sugerido: … — por los pacientes de la habitación {roomCode}". Sin sugerencia, el modal queda idéntico a hoy.
11. Los **tres** PDFs quedan sin cambios: `views/BedsView.tsx:1119` (normal), `:1363` (alfabético), `:1594` (dietas).
12. `tsc --noEmit` no agrega errores nuevos sobre el baseline de 2.

---

## 4. Feature 2 — Buscador en el monitor de comandas

### Diseño

Un input en la barra de filtros que ya existe (`views/ComandasManagementView.tsx:326`), que filtra `data` (`:273`) antes de renderizar. **Multi-término con AND** sobre el registro completo: `"juan 405"` = paciente Juan en la cama 405, sin importar en qué campo cayó cada palabra. Substring, no prefijo (es lo que ya hace todo el repo: `BedsView:783-791`, `RequestsView:181-182`).

El haystack por fila se **precalcula** en un `useMemo` que depende de `data`. Con hasta ~5.000 filas en el rango default de 7 días, correr `normalize('NFD')` sobre 11 campos en cada tecla sí se siente; precalculado, el trabajo por tecla es N `includes()` sobre strings ya normalizados → **no hace falta debounce**.

Se indexa **lo que el usuario ve**, no el crudo de SP. Crítico: `status` crudo es `'Activo'`/`'Inactivo'` (`types.ts:148-152`) pero en pantalla dice "Pendiente"/"Anulada"; `tipo` vacío se pinta como "Otros" (`comandaTipoPill`, `BedsView.tsx:169-172`). Indexar el crudo sería un bug silencioso.

Aplica a **las dos tabs**: comparten `data`, tabla, tarjetas, contador y PDF. Restringirlo al histórico sería *más* código para dar menos.

### Archivos

| Archivo | Acción |
|---|---|
| `lib/utils.ts` | `export function normalizeText()` al final. **No** refactorizar los 7 call-sites existentes |
| `views/ComandasManagementView.tsx` | Imports, helper `rowHaystack`, estado, filtro, input, contador, PDF, empty state, 5 reemplazos de `data` |

### Pasos

**1.** `lib/utils.ts`, al final:

```ts
/**
 * Normaliza texto para búsquedas: minúsculas, sin diacríticos, espacios colapsados.
 * PROGAL manda nombres con tildes y mayúsculas inconsistentes ("MARÍA JOSÉ" / "Maria jose").
 * Idiom ya duplicado 7 veces en el repo (lib/utils.ts:19,:30,:261; views/BedsView.tsx:93,:1540;
 * api/isolations-summary.ts:42; api/push-utils.ts:136). No se refactorizan acá.
 */
export function normalizeText(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

El rango de diacríticos va **escapado** (`\u0300-\u036f`), no con caracteres combinantes literales como el resto del repo: es el helper al que a futuro van a apuntar 7 call-sites, y un copy-paste roto ahí es invisible.

**2.** Imports en `ComandasManagementView.tsx`: `normalizeText` a la línea 3; `Search` a la lista de lucide-react de la línea 11 (mantiene la consistencia interna del archivo, que ya importa directo de ahí — **nota:** `docs/convenciones.md §9.2` solo exceptúa a `BedsView.tsx`, así que este archivo es un infractor no documentado. Ver §8, pregunta 4); `Input` desde `'../components/ui/input'`.

**3.** Helper de módulo, después del tipo `ComandaRow` (`~:142`):

```ts
/** Texto buscable de una fila. Se indexa lo que se VE, no el crudo de SP. */
const rowHaystack = (r: ComandaRow): string => normalizeText([
  r.patientName,
  r.bedLabel, formatBedName(r.bedLabel), formatBedName(r.bedLabel).replace(/[\s-]/g, ''),
  r.area, areaLabel(r.area), areaLabel(r.area).replace(/\s+/g, ''),
  r.comida,
  r.comensal,
  comandaTipoPill(r.tipo).label,
  r.detalle,
  r.observaciones,
  r.by,
  (STATUS_PILL[r.status] ?? STATUS_PILL[COMANDA_STATUS.PENDIENTE]).label,
].join(' '));
```

Las formas **sin espacios** (`"40902"`, `"piso5"`) son la corrección de la revisión: sin ellas, tipear `"piso 5"` devuelve habitaciones del Piso 4 (el término `5` matchea el `405` del bedLabel y `piso` matchea "Piso 4"), y `"409-02"` no matchea nada. Con ellas, el filtro exacto se tipea junto.

No se indexa la fecha `at`: ya tiene los datepickers (`:329-343`) y meter `"21/07/26, 14:30"` en cada haystack ensucia justo las búsquedas numéricas por cama.

**4.** Estado, junto a `planOpen` (`~:204`): `const [searchFilter, setSearchFilter] = useState('');`

**5.** Filtro, reemplazando `:273`:

```ts
const data = tab === 'activas' ? rows : history;

// Precalculado por FILA, no por tecla: `data` solo cambia con un poll o un re-fetch del
// histórico. Con esto el filtro por tecla es N includes() → no hace falta debounce.
const indexed = useMemo(() => data.map(r => ({ r, h: rowHaystack(r) })), [data]);

const terms = normalizeText(searchFilter).split(' ').filter(Boolean);
const filtered = useMemo(
  () => (terms.length === 0 ? data : indexed.filter(({ h }) => terms.every(t => h.includes(t))).map(({ r }) => r)),
  [data, indexed, searchFilter],
);
```

`terms` es un `const` plano — splitear un string corto por tecla es gratis y saca una dependencia.

**6.** Input, primer hijo del div de la barra de filtros (`:326`), **fuera** de los condicionales de tab:

```tsx
{/* max-w-sm es lo que preserva el ml-auto del contador de más abajo. No sacarlo. */}
<div className="relative flex-1 min-w-[180px] max-w-sm">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
  <Input
    placeholder="Paciente, cama, sector, turno, comanda, obs..."
    value={searchFilter}
    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchFilter(e.target.value)}
    className="pl-9 h-9 text-xs rounded-xl border-slate-200"
  />
  {searchFilter && (
    <button onClick={() => setSearchFilter('')}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
      <X className="h-3.5 w-3.5" />
    </button>
  )}
</div>
```

**7.** Contador (`:366-368`): `{filtered.length} comandas` + sufijo `de {data.length}` cuando hay filtro activo que oculta algo.

**8.** PDF: `:282` → `filtered.length`; `:287` → `filtered.map(...)`; `:356` → `disabled={filtered.length === 0}`. Agregar el término al subtítulo (`· filtro: "..."`) para que el papel diga con qué se generó. El **nombre del archivo no cambia** — el query es texto libre y puede traer `/`, `\`, `:` y romper `doc.save()`.

**9.** Empty state nuevo, **antes** de la rama `data.length === 0` (`:382`): "Sin resultados para «…»" + total disponible + botón "Limpiar búsqueda". La rama vieja queda intacta: distingue "no hay comandas" de "el filtro no matchea".

**10.** Render: `:396` (tarjetas mobile) y `:444` (tabla desktop) → `filtered.map(...)`.

**Inventario exacto de `data` en el archivo** (verificado por grep): `238/239` (shadow local dentro de `fetchHistory` — **no tocar**), `273` (declaración), `282`, `287`, `356`, `396`, `444` → pasan a `filtered`; `367` y `382` quedan **mixtos** (usan ambos, a propósito).

**11.** Verificar: `tsc --noEmit` valida `normalizeText` y `rowHaystack`; el JSX no. Grep de control: `normalizeText` debe aparecer en exactamente 2 archivos.

### Criterios de aceptación

1. `"jose"` encuentra "JOSÉ PÉREZ" y `"josé"` encuentra "JOSE PEREZ".
2. `"juan 405"` devuelve solo las comandas de Juan en la cama 405; agregar un término siempre acota, nunca amplía.
3. Son buscables: `"milanesa"` (detalle), `"sin sal"` (observaciones), `"cena"` (turno), `"acompañante"` (comensal), `"uco"` y `"piso5"` (sector), `"menu"`/`"opcion"`/`"otros"` (tipo), el nombre de quien registró, `"409"` y `"40902"` (cama).
4. Estado: `"pendiente"` y `"entregado"` matchean en ambas tabs. **`"anulada"` matchea solo en Histórico** — el backend filtra las anuladas de las comandas vivas (`VIVAS_FILTER`, `api/dietas.ts:45`, usado en `:144`), así que en "De hoy" nunca hay una.
5. El contador muestra la cantidad filtrada y, con filtro activo, el sufijo " de N".
6. Filtro activo con 0 resultados → empty state "Sin resultados", visiblemente distinto de "No hay comandas cargadas hoy", con botón para limpiar.
7. PDF: conteo del subtítulo, cuerpo de la tabla y texto del filtro coinciden con la pantalla. Nombre de archivo sin cambios. Botón deshabilitado con 0 resultados.
8. El input es visible y funcional en las dos tabs (sin prometer paridad de resultados por estado, ver #4).
9. Con el histórico a 30 días cargado, tipear no produce lag perceptible, sin debounce.
10. Vaciar el input restaura la lista completa **en el orden original** (el filtro preserva orden).
11. `tsc --noEmit` no agrega errores nuevos sobre el baseline de 2 (`views/RoleManagementView.tsx:366` y `:422`).

---

## 5. Feature 3 — Limpiezas dentro de Operativa

> ### ⚠️ ESTA SECCIÓN FUE REESCRITA (2026-07-21)
>
> El workflow diseñó este feature **eliminando el módulo `Gestion Limpieza` y migrando `Acceso_RT`
> en SharePoint**. El usuario descartó ese enfoque: *"si pasamos los permisos de limpieza dentro de
> operativa en el ABM de roles, lo que hoy está en productivo se rompe"*.
>
> Lo que sigue es el enfoque acordado: **cero migración de datos**.

### 5.1 Diseño — el módulo se conserva, solo cambia dónde se ve

`Gestion Limpieza` **sigue existiendo** en `ROLE_MODULES` y en `Acceso_RT` de SharePoint, con el
mismo valor. Deja de ser una entrada del sidebar y pasa a controlar **la solapa Limpiezas dentro de
Operativa**. Los permisos quedan separados; solo se reagrupan visualmente.

**Por qué así y no eliminando el módulo:**

- **Cero migración.** Los 6 roles que hoy tienen `Gestion Limpieza` siguen andando sin tocar una fila.
- **La lista de roles NO tiene `Entorno_RT`** (verificado: 12 filas compartidas entre prod y testing;
  usuarios idem, 95 filas). Cualquier migración de roles impacta **producción al instante**, sin
  posibilidad de probarla antes. Este enfoque la evita por completo.
- El ABM **ya separa `label` de `value`** (`views/RoleManagementView.tsx`, const `MODULES`), así que
  se puede cambiar lo que ve el admin sin tocar lo que se persiste.

#### El cambio, completo

```ts
// views/RoleManagementView.tsx — SOLO el label. El value queda intacto.
{ label: 'Operativa · Limpiezas', value: 'Gestion Limpieza' },

// App.tsx — el sidebar se habilita con cualquiera de los dos
const canViewOperativa = hasModule(user, 'Operativa') || hasModule(user, 'Gestion Limpieza');
```

#### Esto NO es un alias

La revisión adversarial descartó, con razón, un `LEGACY_MODULE_ALIASES` que mapeara
`'Gestion Limpieza' → 'Operativa'`: eso le daría a un rol de limpieza **acceso a la lista de
traslados con nombres de pacientes**.

Acá no pasa, porque hay **dos gates independientes**:

| Gate | Controla |
|---|---|
| `hasModule('Operativa') \|\| hasModule('Gestion Limpieza')` | que aparezca la entrada del sidebar |
| `hasModule('Operativa')` | la solapa **Traslados** |
| `hasModule('Gestion Limpieza')` | la solapa **Limpiezas** |

Un rol con solo Limpieza ve la entrada y **únicamente** la solapa de Limpiezas. No hay ampliación
de acceso.

#### Los 3 casos

| Rol tiene | Sidebar | Aterriza en | Botonera |
|---|---|---|---|
| Operativa + Limpieza | ✅ | Traslados | Las 2 solapas |
| Solo Operativa | ✅ | Traslados | Oculta (1 sola opción) |
| **Solo Limpieza** | ✅ | **Limpiezas** ⚠️ | Oculta (1 sola opción) |

**Regla:** la solapa inicial es la **primera a la que el rol tiene acceso**; si solo hay una, la
botonera no se renderiza.

El tercer caso **hoy no existe** — verificado contra SP: los 6 roles con `Gestion Limpieza`
(Admin, Admision, Jefatura Enfermeria, Hoteleria Admin, Admisión Admin, Gerencia) **también tienen
`Operativa`**. Pero es configurable desde el ABM, así que el código debe contemplarlo: mandarlo a
Traslados le mostraría una pantalla vacía o datos que no le corresponden.

#### Nadie cambia de acceso

Matriz verificada contra SharePoint (12 roles activos):

| Grupo | Hoy ve Operativa | Después |
|---|---|---|
| Los 8 con `Operativa` | ✅ | ✅ igual |
| Catering, Dirección, Soporte HPR, Cirugía (sin Operativa ni Limpieza) | ❌ | ❌ **igual** |
| Con Limpieza y sin Operativa | — | **no existe ninguno** |

El `||` no le abre Operativa a ningún rol nuevo.

### 5.2 Sin migración de datos

**No se toca `Acceso_RT`.** No hay paso de migración, no hay ventana de deploy coordinada, no hay
riesgo de lockout.

Lo que el workflow proponía (y queda descartado): eliminar `'Gestion Limpieza'` de `ROLE_MODULES`,
editar los 6 roles en SP, y apoyarse en que `syncSessionRole` propaga en ≤60 s. El mecanismo de
propagación es real (`hooks/useHospitalState.ts:956-989`), pero **el problema no era la propagación
sino el riesgo**: sin `Entorno_RT`, esa edición pega en producción sin poder ensayarla.

#### Lo que sí hay que mirar: `ViewMode 'CLEANINGS'`

Se elimina. Verificado por el mapeo: **no existe ningún `setCurrentView('CLEANINGS')`** en el repo,
no hay router, no hay deep-link, y el SW solo abre `/?notifTicketId=..&notifType=..`
(`src-sw/sw.ts:180-202`), que `useHospitalState.ts:2420-2431` consume sin tocar la vista.

⚠️ Pero **hay dos fallbacks de landing view que leen `modules` crudo con `.includes()`**
(`hooks/useHospitalState.ts:405` y `:1430`). Si alguno resuelve a `'CLEANINGS'`, hay que
redirigirlo a `'REQUESTS'`. Y como **`@types/react` no está instalado**, `tsc` **no** va a marcar
props rotas: los call-sites hay que enumerarlos con grep, no confiar en el compilador.

#### `consolidar_limpieza` en el ABM

Se mueve al grupo `'Operativa'` de `PERMISSION_GROUPS`, **pero el módulo `Gestion Limpieza` se
conserva** en `MODULES` (con el label nuevo). Eso arregla de paso un bug preexistente: hoy
`views/RoleManagementView.tsx:526` oculta el grupo si el módulo no está tildado, así que es
imposible dar `consolidar_limpieza` a un rol que tenga Operativa pero no Limpieza.

### 5.2b El toggle vive en `useHospitalState`, no local

(Se conserva del diseño original — era una corrección bloqueante correcta.)

`App.tsx:342` hace `onTap={(n) => { if (n.ticketId) actions.setCurrentView('REQUESTS'); }}`. Si el
usuario está en la solapa Limpiezas y toca el toast de un ticket, `currentView` **ya vale**
`'REQUESTS'` → no hay cambio de estado, no hay re-render, y la notificación se ve muerta. App.tsx no
puede resetear un estado que viva dentro de RequestsView.

```ts
// hooks/useHospitalState.ts
const [operativaSubview, setOperativaSubview] = useState<'traslados' | 'limpiezas'>('traslados');
```

Al tocar una notificación de ticket hay que forzar `setOperativaSubview('traslados')` además de la
vista. Bonus: la solapa se recuerda al ir a Mapa de Camas y volver.

### 5.3 Archivos

| Archivo | Acción |
|---|---|
| `types.ts` | `:270` sacar `'CLEANINGS'` de `ViewMode`. `:307` sacar `'Gestion Limpieza'` de `ROLE_MODULES`. `:285` actualizar el comentario de `consolidar_limpieza` (hoy dice "Acción del módulo Gestión de Limpieza") |
| `hooks/useHospitalState.ts` | Agregar `operativaSubview` + setter. Corregir las 2 cadenas de landing view (`:405`, `:1430`) — ver 5.4 |
| `App.tsx` | 6 borrados + 2 props nuevas a `<RequestsView>` + reset de sub-vista en el `onTap` (`:342`) |
| `views/RequestsView.tsx` | Botonera, envoltorio condicional, 2 props nuevas, `SprayCanIcon` local, borrar import muerto de `:12` |
| `views/CleaningManagementView.tsx` | Solo `:124`: sacar el padding de página |
| `views/RoleManagementView.tsx` | Solo el **label** de `MODULES` (`:37`) + mover `consolidar_limpieza` al grupo Operativa en `PERMISSION_GROUPS` (`:52`, `:58-63`). El `value` NO se toca |
| `docs/arquitectura.md` + `docs/decisiones.md` | §6.1, §6.2 y tabla de vistas de `:299`; entrada nueva de decisión |

### 5.4 Pasos

**1.** `hooks/useHospitalState.ts`: agregar `operativaSubview` / `setOperativaSubview` y exponerlos en los barrels de state y actions.

**2.** `views/RequestsView.tsx`:
- Borrar el import muerto de `Tabs, TabsList, TabsTrigger` (`:12`) — nunca se renderiza.
- Agregar `LayoutDashboard` a la lista de import existente de `'../components/Icons'` (`:4-7`). **Está exportado** (`components/Icons.tsx:21, :77`) pero **no** está hoy en esa lista.
- Mover el SVG de `SprayCanIcon` acá, arriba del componente, **con el comentario de `App.tsx:44-46` intacto** (documenta que el `SprayCan` del barrel de lucide no renderiza en el sidebar y que el `width/height="24"` + `shrink-0` explícitos son necesarios).

  **Corrección:** el diseño original lo mandaba a `components/Icons.tsx`, invocando `docs/convenciones.md §9.2`. Pero ese archivo son 111 líneas de re-exports puros de lucide, sin un solo componente propio, y **ya re-exporta `SprayCan`** en `:66` — justo el que está roto. Dejar `SprayCan` (roto) y `SprayCanIcon` (workaround) juntos en el mismo barrel garantiza que alguien importe el equivocado. `RequestsView` pasa a ser el único consumidor.
- Props nuevas en `RequestsViewProps` (`:21-44`): `subview`, `onSubviewChange`, `onConsolidateCleaning`, `onRefresh?`.
- Botonera como primer hijo del root (`:345`), **antes** del header row de `:346`:

```tsx
<div className="flex items-center gap-1 self-start bg-white p-1 rounded-xl border border-slate-200 shadow-sm w-full sm:w-auto">
  {([['traslados', 'Traslados', LayoutDashboard], ['limpiezas', 'Limpiezas', SprayCanIcon]] as const).map(([key, label, Icon]) => (
    <button key={key} onClick={() => onSubviewChange(key)}
      className={cn(
        "flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg",
        "text-[10px] font-black uppercase tracking-tight whitespace-nowrap transition-all",
        subview === key ? "bg-emerald-950 text-white shadow-md" : "text-slate-400 hover:bg-slate-100"
      )}>
      <Icon className="w-3.5 h-3.5" />{label}
    </button>
  ))}
</div>
```

  Pill group deliberadamente distinto del `border-b-2` esmeralda que `CleaningManagementView` usa en `:126-136`, para que las dos barras no se lean como un solo control roto.
- Envolver **todo** lo que va de `:346` al cierre del Dialog de observaciones (`:717`) en `{subview === 'traslados' ? (<>...</>) : (<CleaningManagementView ... />)}`. Envolver, no ocultar: así el search (`:386`), el botón "Solicitud" (`:389`) y el switcher de rol (`:350`) no quedan visibles-pero-inertes.

**3.** `views/CleaningManagementView.tsx:124`: root de `"p-4 md:p-8 max-w-full w-full space-y-4 md:space-y-5 pb-24 md:pb-8"` a `"max-w-full w-full space-y-4 md:space-y-5 pb-20 md:pb-0"`. El padding lo aporta el root de RequestsView (`:345`); dejar ambos lo duplica. **Nada más se toca** — props, fetch propio, tabs internos, gate de `consolidar_limpieza` (`:70`) y dialog quedan idénticos: "mismas funcionalidades".

**4.** `App.tsx`: pasar las props nuevas a `<RequestsView>` (`:634-653`), incluyendo `onConsolidateCleaning={(label) => actions.undoBedClean(label, 'CONSOLIDADO')}` (el mismo callback de `:663`) y `onRefresh={actions.refreshAll}`.

> ⚠️ **No** reusar el nombre `onConsolidate`: `RequestsViewProps.onConsolidate` (`views/RequestsView.tsx:38`) ya existe y es consolidar **ticket** (`actions.handleConsolidate`, `App.tsx:647`). Sin `@types/react`, `tsc` no lo detectaría y el botón de limpieza llamaría a `handleConsolidate` con un `bedLabel` donde espera un `ticketId`.

Y en el `onTap` de notificaciones (`:342`):

```ts
onTap={(n) => { if (n.ticketId) { actions.setCurrentView('REQUESTS'); actions.setOperativaSubview('traslados'); } }}
```

**5.** Verificar visualmente el toggle **antes de borrar nada**. En este punto Limpiezas está en los dos lugares (sidebar viejo + sub-vista nueva) → momento ideal para comparar que se ve y se comporta igual.

**6.** `App.tsx`, borrar: import de `CleaningManagementView` (`:20`), `SprayCanIcon` inline (`:47`), `canViewCleanings` (`:155`), sidebar desktop (`:388-390`), sidebar mobile (`:502-504`), render (`:663`), y el tramo `'CLEANINGS'` del título (`:438`). De paso, colapsar el botón "Operativa" duplicado: `App.tsx:376-381` y `:490-495` renderizan JSX idéntico en dos ramas (`{canViewOperativa && !hasAzafataAccess && ...}` y `{hasAzafataAccess && canViewOperativa && ...}`) → `{canViewOperativa && (<Button .../>)}`. Son los bloques adyacentes a los que ya se están borrando.

**7.** `types.ts:270`: sacar `'CLEANINGS'`. Correr `tsc --noEmit`. **Debe fallar únicamente en referencias a `'CLEANINGS'`** — los 4 sitios de `App.tsx` (`:389, :438, :503, :663`) si aún no se borraron, más `hooks/useHospitalState.ts:405` y `:1430`. Si falla en otro lado, ahí hay un call-site que el mapa no tenía.

> Nota: `state.currentView === 'CLEANINGS'` en App.tsx **también** es error de `tsc` (TS2367, comparación sin overlap) — dispara aunque `tsconfig.json` no tenga `strict` (verificado: no lo tiene). O sea que el compilador enumera los 6, no solo los 2 de useHospitalState.

**8.** `hooks/useHospitalState.ts`, las 2 cadenas de landing view. **No alcanza con borrar la rama de `'CLEANINGS'`.**

Un rol legacy cuyo único módulo era `'Gestion Limpieza'` cae al `'HOME'` final de ambas cadenas (`:394-409` y `:1425-1432`), pero `canViewMonitor` (`App.tsx:151`) le da `false` → `<main>` (`App.tsx:630`) no renderiza nada: **pantalla en blanco al loguear**, aunque el sidebar sí le muestre Operativa. Y no hay ningún efecto de corrección: `App.tsx:168-169` dice textualmente *"This effect could be better handled in useEffect, but for now we control rendering"*.

Corrección: en ambas cadenas, reemplazar `modules.includes('Operativa')` / `mods.includes('Operativa')` por `hasModule(user, 'Operativa')` — `hasModule` ya está importado en `hooks/useHospitalState.ts:10` y el objeto `user` está en scope en los dos lugares (`:396` y `:1424`). Una sola fuente de verdad para el gate.

> Si la migración del paso 0 se hizo bien, este caso ni se da (esos roles ya tienen `'Operativa'` real en `Acceso_RT`). Se hace igual: es defensa en profundidad y cuesta dos líneas.

**9.** `types.ts:307`: sacar `'Gestion Limpieza'` de `ROLE_MODULES`. `tsc --noEmit` — debe fallar solo si quedó algún `hasModule(user, 'Gestion Limpieza')` sin borrar (safety net del paso 6). Actualizar también el comentario de `types.ts:285`.

**10.** `views/RoleManagementView.tsx`:
- Borrar `{ label: 'Gestión de Limpieza', value: 'Gestion Limpieza' }` de `MODULES` (`:37`) → quedan 6.
- Borrar el grupo `module: 'Gestion Limpieza'` de `PERMISSION_GROUPS` (`:58-63`) y mover su permiso al grupo `'Operativa'`, después de `confirmar_limpieza` (`:52`), relabeleado: `{ code: 'consolidar_limpieza', label: 'Consolidar limpieza de cama (sub-vista Limpiezas)' }`.

  El label **no** debe decir "Gestión de Limpieza": es el nombre del módulo que este mismo cambio elimina — justo la confusión que el feature pide corregir. "sub-vista Limpiezas" además lo desambigua bien de `confirmar_limpieza` ("Habitación Lista"), que ahora vive en el mismo grupo.
- ~~Agregar `normalizeAccess`~~ — eliminado del alcance (ver 5.5).

**11.** `tsc --noEmit`: baseline de 2 errores, ni uno más.

**12.** `docs/`: actualizar `docs/arquitectura.md` §6.1 (tabla de roles, `:311-317`), §6.2 (mapeo módulos→vistas, `:322+`), la tabla de vistas de `:299`, y la afirmación de `:307`. Agregar entrada en `docs/decisiones.md` explicando por qué se absorbió el módulo — el repo documenta decisiones de este calibre (ver §25.1 para el overlay de limpiezas). Documentar el `Acceso_RT` nuevo de cada rol migrado. Existe la skill `update-docs` para esto.

**13.** Prueba manual con dos roles reales: uno con Operativa de siempre, uno migrado en el paso 0.

### 5.5 ~~`normalizeAccess`~~ — YA NO APLICA

El diseño original necesitaba un `normalizeAccess` para **descartar** `'Gestion Limpieza'` de
`Acceso_RT`, porque el módulo se eliminaba y quedaba un valor huérfano sin checkbox que lo mostrara
ni permitiera quitarlo.

Con el enfoque acordado **el módulo se conserva y tiene su checkbox** (label `'Operativa · Limpiezas'`),
así que no hay valor huérfano y **no hace falta el helper**. Se elimina del alcance, y con él:
- el paso 10 de 5.4,
- los 3 call-sites que iba a tocar (`openEdit:180`, chips `:365` y `:421`),
- el riesgo R5 (que `trim()` borrara strings escritos a mano en SP).

> 📌 Lo único que sí conviene mirar en el paso 0: si algún `Acceso_RT` real trae **espacios
> alrededor** de los módulos, el `.split('/')` crudo actual ya falla hoy. Es un bug preexistente,
> independiente de este feature — si aparece, tratarlo aparte con su propio criterio.


### 5.6 Criterios de aceptación

**Navegación**
1. El sidebar (desktop `App.tsx:388`, mobile `:502`) ya no muestra "Limpiezas" para ningún rol.
2. En Operativa aparece una botonera de dos opciones — "Traslados" (default) y "Limpiezas" — visible en desktop y en mobile 375 px, sin scroll horizontal.
3. En "Limpiezas": todas las funcionalidades intactas (tabs Activas/Histórico, datepickers, Actualizar, contadores, tarjetas mobile + tablas desktop, dialog de confirmación, botón Consolidar solo con `consolidar_limpieza` y "Sin permiso" para el resto).
4. En "Limpiezas" no se ven controles de tickets: ni search, ni botón "Solicitud", ni switcher de rol, ni tabla/cards de traslados.
5. El padding no se duplica: el espaciado se ve igual que cuando era vista de primer nivel, en mobile y desktop.
6. Estando en "Limpiezas", tocar el toast de un ticket lleva a "Traslados" (regresión cubierta).
7. Ir a Mapa de Camas y volver a Operativa conserva la sub-vista elegida.

**Limpieza de código**
8. `tsc --noEmit` termina con el baseline de 2 errores. En el paso 7 falló **únicamente** en referencias a `'CLEANINGS'` y ninguna otra.
9. `grep -rn "CLEANINGS" --include=*.ts --include=*.tsx .` → 0 coincidencias.
10. `grep -rniE "gesti(o|ó)n( de)? limpieza" --include=*.ts --include=*.tsx .` → 0 coincidencias en código (sí puede haber en `docs/` describiendo el histórico).

**ABM y roles**
11. "Módulos de Acceso" muestra 6 checkboxes; ninguno dice "Gestión de Limpieza".
12. El permiso "Consolidar limpieza de cama (sub-vista Limpiezas)" aparece dentro del grupo "Operativa"; ya no existe el grupo colapsable "Gestión de Limpieza".
13. Un rol con Operativa y sin el módulo viejo puede recibir `consolidar_limpieza` — cosa que antes era imposible.
14. Al abrir un rol migrado, "Operativa" está tildado; al guardarlo, `GET /api/roles` devuelve su `access` sin `'Gestion Limpieza'` y sus `permissions` intactos, incluido `consolidar_limpieza`.
15. Los chips de módulos en la lista de roles (`:365`, `:421`) tampoco muestran el módulo viejo.
16. Todo rol migrado en el paso 0 puede loguearse, aterriza en una vista con contenido (no en blanco) y llega a Limpiezas por el toggle.
17. El título del header dice "Operativa" en ambas sub-vistas; ningún `ViewMode` cae en la rama por defecto "Historial" de `App.tsx:438`.

**Docs**
18. `docs/arquitectura.md` §6.1, §6.2 y la tabla de vistas no mencionan el módulo eliminado; `docs/decisiones.md` tiene la entrada nueva.

---

## 6. Decisiones técnicas

Solo las que tienen trade-off real.

### D1 — Ocupante = `status === OCCUPIED`, no `patientName` (F1)

**Qué:** el helper cuenta como ocupante solo camas con `status === BedStatus.OCCUPIED` y `sex` conocido.
**Por qué:** `patientName` y `patientCode` quedan residuales en camas ya liberadas — está documentado en el propio código (`hooks/useHospitalState.ts:243-247`, `api/beds.ts:141-143`) y `reapplyEnrichFromMap` (`:119-127`) reinyecta `sex` a cualquier cama con `patientCode`, sin mirar status. Usar `patientName` producía sugerencias sobre pacientes fantasma: exactamente la sugerencia engañosa que el feature dice querer evitar. `status === OCCUPIED` es el criterio de todo el resto del archivo (`BedsView.tsx:1067, :1316, :1594, :2265`).
**Alternativas:** `!patientName` (descartada, ver arriba). Criterio mixto (`OCCUPIED || patientName`) — descartada: dos criterios dentro del mismo feature es exactamente lo que rompía el diseño original, donde el helper filtraba por `patientName` y la vista por `status`.

### D2 — El helper devuelve por habitación, no por cama (F1)

**Qué:** `Map<\`${area}|${roomCode}\`, 'M'|'F'>` en vez de `Map<bedLabel, sex>`.
**Por qué:** deja **un solo criterio** de "cama libre" (el `status` de la vista) y saca del helper una decisión de presentación. También es menos código: se elimina el loop que emitía por cama. `lib/utils.ts` sigue siendo puro y la vista decide.
**Alternativas:** emitir por cama (descartada: obligaba al helper a decidir qué es "libre", duplicando el criterio). Un helper por cama tipo `roomSexConflict` — descartada: O(n²) en el map de la grilla, que re-renderiza con cada tecla del buscador y cada poll de 60 s.

### D3 — Sexos mixtos en la habitación → silencio (F1)

**Qué:** `sexes.size !== 1` → sin sugerencia. Colapsa "no sé" y "es mixta" en la misma rama.
**Por qué:** un tag "M" en un cuarto donde también hay una mujer es peor que ningún tag: induce una asignación equivocada y erosiona la confianza en los otros 4 indicadores de la celda. Y desde el frontend no se puede distinguir cuarto legítimamente mixto de dato sucio del enrich.
**Alternativas:** sexo mayoritario (descartada: inventa una regla de negocio que nadie definió y produce el tag más peligroso — parece confiable, no lo es). Tag "Mixta" (descartada por ahora: tercer estado visual en una celda saturada, para un caso cuya frecuencia real desconocemos. Ver §8 pregunta 2).

### D4 — Exención de HUC/HUT/HIT/HRA (F1)

**Qué:** reusar `CRITICAL_AREAS_NO_BLOCK` (`views/BedsView.tsx:644`) en el gate.
**Por qué:** el repo ya las exime del bloqueo por aislamiento con el motivo documentado en `:642-644` (cubículos físicamente independientes) — la premisa de convivencia/pudor por habitación no aplica. HRA son sillones de sala de espera, ya excluidos del contador (`~:838`); si comparten `roomCode`, un solo ocupante pintaría chips en toda la sala.
**Alternativas:** dejarlo como pregunta abierta (descartada: es una línea, y el ruido en 4 sectores es concreto). Sacar la exención después es igual de barato si UCO/UTI resulta que sí la quiere.

### D5 — El chip convive con comanda/ayuno, no la cede (F1)

**Qué:** el chip va **dentro** del contenedor flex de `views/BedsView.tsx:2202`, con el wrapper condicionado a `hasMealTag || suggestedSex`.
**Por qué:** el overlay de comandas (`hooks/useHospitalState.ts:259`) adjunta cargas viejas a camas sin `patientCode` — o sea que una cama libre **sí** puede tener `bed.meals`, y suprimir el chip sería una pérdida silenciosa justo donde importa. El contenedor flex fue creado para este caso (comentario en `:2199-2200`).
**Alternativas:** guarda `!hasMealTag` (descartada, ver arriba). Esquina inf-izq (descartada: el pill multi-aislamiento de `:2182` no está gateado por `status` en el código; "está libre porque la cama está vacía" sería un supuesto de datos, no una garantía).

### D6 — Se indexan labels, nunca valores crudos (F2)

**Qué:** `comandaTipoPill(r.tipo).label` y `STATUS_PILL[r.status].label`.
**Por qué:** `COMANDA_STATUS` reusa la columna de soft-delete (`types.ts:148-152`): PENDIENTE=`'Activo'`, ANULADA=`'Inactivo'`. Indexar el crudo haría que buscar "anulada" no devuelva nada y que "activo" devuelva filas rotuladas "Pendiente". Con `tipo` pasa en el borde: vacío se pinta "Otros".
**Alternativas:** crudo + label "por las dudas" — descartada: en MENU/OPCION ambos normalizan al mismo string, y en status el crudo es directamente engañoso (filtraría por vocabulario que no existe en la UI).

### D7 — Haystack precalculado por fila, sin debounce (F2)

**Qué:** `useMemo` dependiente de `data`; por tecla solo `includes()`.
**Por qué:** el histórico pagina hasta 20.000 filas (`api/dietas.ts:104-106`); ~500-800 filas/día × 7 días de rango default ≈ 4.000-5.000. `normalize('NFD')` sobre 11 campos × 5.000 filas en cada tecla se siente. Un debounce trataría el síntoma y agregaría latencia percibida.
**Alternativas:** debounce 200 ms (descartada: más código y el input se siente laggy). Guardar el haystack dentro de `ComandaRow` (descartada: habría que construirlo en los dos builders — el `useMemo` de `rows` y el `.map` de `fetchHistory` — dos lugares que se desincronizan, y ensucia un tipo que hoy es puro dato de dominio).

### D8 — El PDF exporta lo filtrado (F2)

**Qué:** `filtered`, con el término impreso en el subtítulo; el nombre de archivo no cambia.
**Por qué:** WYSIWYG. Si el usuario filtra "piso5 cena" y toca PDF, espera ese papel — es probablemente el caso de uso más fuerte del feature (cocina imprimiendo un subconjunto). El término en el subtítulo evita el riesgo inverso: que alguien reciba un PDF parcial creyéndolo total. El nombre queda igual porque el query es texto libre y puede traer `/`, `\`, `:` y romper `doc.save()`.
**Alternativas:** PDF siempre completo (descartada: viola mínima sorpresa). Dos botones (descartada: limpiar la búsqueda y re-exportar ya da esa opción).

### D9 — El módulo `Gestion Limpieza` se CONSERVA; solo cambia su label y dónde se ve (F3)

**Qué.** `ROLE_MODULES` y `Acceso_RT` quedan intactos. En el ABM cambia solo el `label`
(`'Gestión de Limpieza'` → `'Operativa · Limpiezas'`); el `value` persistido sigue siendo
`'Gestion Limpieza'`. El sidebar se gatea con `hasModule('Operativa') || hasModule('Gestion Limpieza')`
y **cada solapa se gatea por separado**.

**Por qué.** Cero migración de datos → producción no se rompe. Y es decisivo que la lista de roles
**no tenga `Entorno_RT`**: prod y testing comparten las 12 filas, así que cualquier edición de
`Acceso_RT` pega en producción sin poder ensayarla. El ABM ya separa `label` de `value`, así que el
cambio de presentación sale gratis.

**Alternativas descartadas.**
- *(a) Eliminar el módulo y migrar los 6 roles en SP* — lo que proponía el workflow. Técnicamente
  viable (`syncSessionRole` propaga en ≤60 s), pero toca datos productivos sin red de ensayo.
  Descartado por el usuario: *"lo que hoy está en productivo se rompe"*.
- *(b) `LEGACY_MODULE_ALIASES` client-side* (`'Gestion Limpieza' → 'Operativa'`) — descartado con
  razón por la revisión: le daría a un rol de limpieza acceso a la lista de traslados con nombres de
  pacientes. **El diseño elegido NO es esto**: el `||` habilita solo la entrada del sidebar, y las
  solapas mantienen gates independientes.


### D10 — El toggle vive en `useHospitalState`, no local (F3)

**Qué:** `operativaSubview` en el hook central + prop desde App.tsx.
**Por qué:** `App.tsx:342` navega a `'REQUESTS'` desde el tap de notificación. Con estado local, un usuario parado en Limpiezas toca el toast y no pasa nada (`currentView` ya vale `'REQUESTS'`, no hay re-render) — es pérdida de funcionalidad existente, no una comodidad. También habilita componer el título y recordar la sub-vista al volver de otra vista.
**Alternativas:** `useState` local (descartada, ver arriba; el "precedente" del tab de `CleaningManagementView.tsx:80` no aplica: ese componente no es destino de navegación). Query param (descartada: no hay router; habría que escribir el parseo de `location.search` y el `history.replaceState` a mano).

### D11 — La solapa inicial es la primera accesible; con una sola, no hay botonera (F3)

**Qué.** El landing dentro de Operativa es la primera solapa a la que el rol tiene acceso
(Traslados si tiene `Operativa`, si no Limpiezas). Si solo tiene acceso a una, la botonera no se
renderiza.

**Por qué.** Un rol con solo `Gestion Limpieza` entra por la entrada "Operativa" del sidebar; si
aterrizara en Traslados vería una pantalla vacía o datos que no le corresponden. Hoy ese caso **no
existe** (los 6 roles con Limpieza también tienen Operativa, verificado en SP), pero es configurable
desde el ABM y el costo de contemplarlo es de una línea.

**Alternativas.** *(a) Landing fijo en Traslados* — rompe el caso solo-Limpieza. *(b) Mostrar la
botonera siempre* — una botonera de un solo botón es ruido.


### D12 — `SprayCanIcon` va a `RequestsView`, no al barrel de Icons (F3)

**Qué:** mover el SVG a `views/RequestsView.tsx`, arriba del componente, con su comentario.
**Por qué:** `components/Icons.tsx` son 111 líneas de re-exports puros de lucide, sin componentes propios, y **ya re-exporta `SprayCan`** en `:66` — justo el que `App.tsx:44-46` documenta como roto. Tener los dos exportados del mismo archivo garantiza que alguien importe el equivocado. RequestsView pasa a ser el único consumidor.
**Alternativas:** `components/Icons.tsx` (descartada, ver arriba). `components/SprayCanIcon.tsx` propio (aceptable si se quiere reutilizable; hoy no hay segundo consumidor). Dejarlo en App.tsx y exportarlo (descartada: una view importando de App crea ciclo de imports).

---

## 7. Riesgos priorizados

| # | Riesgo | F | Sev | Mitigación |
|---|---|---|---|---|
| R1 | Deployar F3 sin migrar los roles en SP → roles con `'Gestion Limpieza'` sin `'Operativa'` pierden acceso a Limpiezas | 3 | **Alta** | Paso 0 obligatorio: `GET /api/roles` y migración desde el ABM **antes** del deploy. Recuperable en 2 min si pasa, pero evitable |
| R2 | Rol legacy con módulo único → landing view cae en `'HOME'` sin `canViewMonitor` → **pantalla en blanco** (`App.tsx:630`, sin efecto de corrección según `:168-169`) | 3 | **Alta** | Paso 8: usar `hasModule(user, 'Operativa')` en las 2 cadenas (`useHospitalState.ts:405`, `:1430`). Redundante si R1 se mitigó, se hace igual |
| R3 | Colisión `onConsolidate` (ticket) vs limpieza — `tsc` no lo detecta por la deuda de `@types/react`; el bug pasa silencioso a prod | 3 | **Alta** | Nombre distinto: `onConsolidateCleaning`. Call-site único: `<RequestsView` solo aparece en `App.tsx:634-653` |
| ~~R4~~ | ~~`'Gestion Limpieza'` huérfano en `Acceso_RT`~~ — **ya no aplica**: el módulo se conserva y tiene checkbox propio | — | — | Eliminado con el rediseño de §5 |
| ~~R5~~ | ~~`normalizeAccess` borra strings escritos a mano~~ — **ya no aplica**: no se toca `Acceso_RT` | — | — | Eliminado con el rediseño de §5 |
| R6 | Doble nivel de tabs en modo Limpiezas: el pill group nuevo + el underline "Activas \| Histórico" (`CleaningManagementView.tsx:126-136`), ambos esmeralda | 3 | Media | Diferenciados por forma (pill con fondo/borde vs `border-b-2`). **Mirar renderizado en 375 px**, donde ambos ocupan ancho completo a ~50 px de distancia. Si se lee roto: fusionar en un nivel de 3 opciones (más invasivo) |
| R7 | Ampliación de acceso: si se usara el alias, un rol de limpieza vería la lista de traslados con nombres de pacientes | 3 | Media | **Ya mitigado**: se descartó el alias (D9). Si el negocio lo reintroduce, el riesgo vuelve |
| R8 | `sex` es best-effort: si el enrich falta o está atrasado (cron 15 min), no hay sugerencia → el feature va a parecer "intermitente" sin que nada esté roto | 1 | Media | Degradación silenciosa deliberada. **Avisarlo a Admisión** al comunicar el cambio |
| R9 | La ausencia de tag es ambigua por diseño: cubre cuarto vacío, enrich faltante y cuarto mixto. Reclamos tipo "no me sugiere nada en el 412" requieren mirar el enrich, sin señal en la UI | 1 | Baja | Precio aceptado de no mostrar sugerencias engañosas. El bloque del modal explica el caso positivo, no el negativo |
| R10 | Sin `@types/react`: nada del JSX nuevo lo valida `tsc`. Props nuevas de `RequestsView` son `any` de facto | 1,2,3 | Media | Verificación visual obligatoria en los 3. En F3, aprovechar lo que `tsc` **sí** chequea: `ViewMode`, `RoleModule` y la firma de `hasModule` — de ahí que los pasos 7 y 9 lo usen como enumerador de call-sites |
| R11 | Densidad visual: la celda ya puede mostrar 4 indicadores; se suma un quinto en un cuadrado de ~66 px en mobile | 1 | Baja | `overflow-hidden` (`:2163`) garantiza que nada rompe el grid. Si en QA se ve cargado, revisar antes de recortar — limitar a `md:` mataría el uso móvil de las azafatas |
| R12 | Remontaje de `CleaningManagementView` al alternar el toggle: pierde `tab`, rango `from`/`to` e `history` (`:80-88`) | 3 | Baja | Remonta en `tab='activas'` → **no** se re-dispara el fetch (el `useEffect` de `:113` solo corre en 'historico'), sin presión extra sobre SP. Molestia menor; si molesta, montar ambos con `hidden` |
| R13 | Query numéricos cortos ("4", "02") matchean mucho: el haystack mezcla nro de habitación, de cama y ordinal de acompañante | 2 | Baja | Inherente a buscar sobre el registro completo. El contador "N de M" lo hace evidente. Excluir la fecha del índice ya sacó la peor fuente de ruido |
| R14 | `busyId` en vuelo sobre una fila que deja de matchear: el spinner desaparece mientras el PATCH sigue corriendo | 2 | Baja | No rompe nada (`doAction` limpia en el `finally`, y el banner de error de `:373` está **fuera** del bloque filtrado). Verificar a mano |
| R15 | El query se conserva al alternar tabs (mismo patrón que hoy confunde en `RequestsView`) | 2 | Baja | Deliberado; cubierto por el contador "N de M" y el empty state dedicado. Si molesta en QA: `useEffect(() => setSearchFilter(''), [tab])` |
| R16 | `consolidar_limpieza` se pierde al destildar Operativa (`toggleModule:196-199` lo borra; `originalPermissions:122` solo restaura dentro de la sesión del modal) | 3 | Baja | Preexistente y consistente con los otros 7 permisos de Operativa; ahora afecta a uno más. **No se arregla acá** (fuera de alcance); mencionárselo a quien administre roles |
| R17 | Sin cobertura de tests: no hay `tests/` ni `*.test.*` en el repo | 1,2,3 | Media | Los pasos están ordenados para compensar: F3 paso 5 (comparar sub-vista nueva contra sidebar viejo antes de borrar) y pasos 7/9 (`tsc` como enumerador) |

---

## 8. Preguntas abiertas — necesitan definición antes de codear

**1. (F3, bloqueante) ¿Qué roles tienen hoy `'Gestion Limpieza'` en `Acceso_RT`, y cuáles de ésos no tienen además `'Operativa'`?**
No se puede saber desde el repo. Se obtiene con `GET /api/roles` o mirando `99.ABMRoles_Traslados` (`68836bbe-18c5-4cb2-8cc6-e21ecae96710`). Determina si la migración son 2 clicks o si hace falta otra estrategia. **Sin este dato no se puede empezar el Feature 3.** De paso, chequear si algún `Acceso_RT` tiene espacios alrededor de los `/` (R5).

**2. (F1) ¿Existen en HPR habitaciones legítimamente mixtas?** (pediatría, acompañantes, privadas con dos camas para un matrimonio).
Si sí, el silencio propuesto es correcto pero quizá convenga un tag "Mixta". Si **no** existen, entonces un cuarto con ambos sexos es siempre dato sucio y podría valer marcarlo como anomalía en el modal para que Admisión lo reporte.

**3. (F2) ¿Se busca por código de paciente / DNI?**
Está disponible **simétricamente** en ambas tabs con ~2 líneas: `Bed.patientCode` existe (`types.ts:76`) y `api/dietas.ts:120` ya lo devuelve en el histórico. No lo indexo porque no se muestra en ninguna de las dos vistas ni en el PDF (criterio "se indexa lo que el usuario ve"), pero el spec pidió "mayor campos, mejor" y es como Nutrición identifica pacientes. Decisión de negocio, no técnica.

**4. (F2) ¿`ComandasManagementView` se agrega a las excepciones de `docs/convenciones.md §9.2`, o se migran sus iconos a `components/Icons.tsx`?**
§9.2 (`:947`) lista a `BedsView.tsx` como única excepción; este archivo ya importa directo de lucide (`:11`) sin estar documentado. Agregar `Search` ahí mantiene consistencia interna pero perpetúa la deuda. Alternativa: importar `Search` desde `'../components/Icons'` (está re-exportado en `:18` y `:74`) y anotar la migración del resto como follow-up.

**5. (F3) ¿El toggle "Limpiezas" lo ve todo rol con Operativa, o solo quien tenga `consolidar_limpieza`?**
El diseño asume lo primero (D11). Si el negocio quiere lo segundo, es agregar `{can(currentUser, 'consolidar_limpieza') && ...}` sobre la botonera — pero ojo: hoy ese permiso solo se pudo otorgar a roles con el módulo viejo, así que quedaría invisible para casi todos hasta re-configurar roles.

**6. (F3) ¿Hay manuales, instructivos o capturas para el personal de limpieza que muestren el ítem del sidebar?**
El cambio de navegación afecta a azafatas que operan desde mobile. Puede necesitar aviso previo o una nota en `docs/`.

---

## 9. Orden sugerido de implementación

### 1º — Feature 2 (buscador de comandas)

Es el más aislado: un archivo de vista, un helper nuevo, cero cambios de tipos compartidos, cero backend, cero datos. No depende de ninguna decisión pendiente salvo la pregunta 3, que es aditiva (se puede sumar `patientCode` después sin tocar nada de lo hecho).

Además **establece el baseline de `tsc`**: al terminar tenés confirmado que los 2 errores de `RoleManagementView.tsx:366/:422` son preexistentes y no tuyos. Eso importa para el Feature 3, que toca ese mismo archivo.

Y deja `normalizeText` exportado en `lib/utils.ts` — útil como follow-up para los 7 call-sites duplicados, pero sin obligación.

### 2º — Feature 1 (sexo sugerido)

También aislado (`lib/utils.ts` + `BedsView.tsx`), sin cambios de props ni tipos que viajen. Va segundo y no primero porque tiene una pregunta abierta de negocio (habitaciones mixtas) que conviene resolver mientras se hace el Feature 2, y porque su verificación es más laboriosa: requiere buscar en la app real un cuarto con ocupante enriquecido, probar con filtros activos, y mirar la celda en mobile.

El helper es lo único que `tsc` valida, y es nuevo (cero call-sites previos que enumerar por grep).

### 3º — Feature 3 (limpiezas en Operativa)

Va último por tres razones:

1. **Depende de un dato externo** (pregunta 1). Sin `GET /api/roles` no se puede planificar la migración, y sin migración no se puede deployar sin riesgo de romper accesos.
2. **Toca `views/RoleManagementView.tsx`**, que tiene 2 errores preexistentes de `tsc`. Haciéndolo último ya sabés cuáles son y no los confundís con los tuyos ni caés en la tentación de arreglarlos (scope creep).
3. **Es el único con migración de datos productivos.** Conviene tener los otros dos ya en `develop` y verificados, para que si algo sale mal el rollback sea de un feature y no de tres.

Dentro del Feature 3, el orden de los 13 pasos de §5.4 no es arbitrario: el **paso 5** ("verificar el toggle antes de borrar nada") existe para tener el estado intermedio donde Limpiezas está en los dos lugares y se pueden comparar lado a lado. Y los **pasos 7 y 9** usan `tsc` deliberadamente como enumerador de call-sites: si falla en un lugar que este documento no lista, encontraste algo que el mapa no tenía y hay que investigarlo antes de seguir.