Mantené la **documentación viva** del repo (`CLAUDE.md` + `docs/`) sincronizada con el código, para
que cualquier dev pueda entrar por un ticket y que Claude Code resuelva el issue con contexto fresco
y correcto. La doc es la fuente de verdad técnica: si miente, manda a resolver mal.

## 1. Determinar el alcance (qué cambió desde la última actualización de docs)

No uses un rango fijo. Calculá desde cuándo la doc quedó atrás:

1. Último commit que tocó la doc: `git log -1 --format="%h %ci" -- docs/ CLAUDE.md`
2. Qué código cambió desde ahí: `git diff <ese_hash>..HEAD --stat` y leé los diffs relevantes
   (`git diff <ese_hash>..HEAD -- <archivo>`).
3. Sumá lo que esté sin commitear: `git status --short` y `git diff` / `git diff --staged`.

Armá una lista concreta de cambios de código que la doc debería reflejar. Si no hay cambios
documentables, decilo y terminá (no inventes secciones).

## 2. Mapear cada cambio a la doc correcta

- **`docs/arquitectura.md`** — *qué hay y cómo está armado*: endpoints nuevos en `api/`, listas y
  columnas de SharePoint, crons, variables de entorno, flujo de datos, vistas/módulos, integraciones
  (Gamma/PROGAL, Graph).
- **`docs/decisiones.md`** — *por qué*: cuando hubo una decisión técnica con trade-off (se eligió X
  sobre Y). Respetá el formato existente (**Qué** / **Por qué** / alternativas / impacto). Esto es lo
  más valioso para resolver issues sin reintroducir bugs viejos.
- **`docs/convenciones.md`** — *cómo se escribe*: nuevos patrones de código, nombrado, estructura.
- **`CLAUDE.md`** — solo si cambian **reglas clave o punteros** (no detalle fino; eso va en `docs/`).
- **`docs/troubleshooting.md`** (crealo si no existe) — *síntoma → causa probable → qué mirar/escalar*,
  para soporte/QA. Agregá una fila cuando un cambio introduce un modo de falla nuevo (ej. una
  notificación que depende de un cron, una acción que depende de un permiso de rol, un dato que viene
  del enrich).

## 3. Reglas de edición

- **Verificá contra el código antes de escribir.** No inventes nada. Citá rutas como `archivo:línea`.
  Lo que no puedas confirmar, marcalo `(verificar)` en vez de afirmarlo.
- **Actualizá en el lugar** los datos que cambiaron (un GUID, un nombre de columna, un estado, una ruta)
  y **agregá** cuando es información nueva. No dejes datos viejos contradiciendo a los nuevos.
- **Imitá el estilo y formato** de cada doc — mirá una sección vecina antes de editar.
- Convertí fechas relativas a absolutas (ej. "hoy" → la fecha real).
- **Nunca** documentes secretos ni credenciales (passwords, tokens). Los `LIST_ID` de SharePoint sí
  (son constantes estructurales, no secretos).

## 4. Checklist específico de este repo (lo que más se desincroniza)

- ¿**Endpoint nuevo** en `api/`? → ¿está registrado en `dev-server.ts` y en la tabla de endpoints de
  `arquitectura.md`?
- ¿**Lista SharePoint nueva o columna nueva**? → actualizá la tabla de listas (sección 9, con su GUID)
  y la tabla de segregación por `Entorno_*`.
- ¿**Cron nuevo o cambiado**? → ¿coincide con `vercel.json` (schedule + maxDuration) y la sección de
  crons?
- ¿**Variable de entorno nueva**? → documentala (nombre, para qué, default).
- ¿**Rol o permiso nuevo**? → catálogo de permisos / roles (`types.ts` `PERMISSIONS` y `Role`).
- ¿Cambió el **flujo del enrich, las notificaciones push o el ciclo de estados del ticket**? → son los
  que más impactan en issues; revisá que la descripción siga siendo cierta.

## 5. Salida

Cerrá con un resumen corto: qué archivos de doc tocaste, qué agregaste/actualizaste en cada uno, y
cualquier cosa que marcaste `(verificar)` para que un humano la confirme.

> Tip de proceso: corré esto **antes de mergear un PR** (o atado a un hook), así la doc nunca deriva.
> Una skill que existe pero no se corre = docs viejos = Claude Code respondiendo con confianza algo falso.
