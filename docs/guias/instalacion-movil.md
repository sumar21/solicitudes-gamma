# Instalación de MediFlow en tu celular

MediFlow es una aplicación web progresiva (PWA) que se instala directamente desde el navegador, sin necesidad de tiendas de aplicaciones.

---

## Android (Chrome)

### Paso 1 — Abrir la app
Abrí **Google Chrome** y navegá a la dirección de MediFlow que te proporcionó tu supervisor.

### Paso 2 — Iniciar sesión
Ingresá tu usuario y contraseña para acceder a la aplicación.

### Paso 3 — Instalar la app
Tenés dos opciones:

**Opción A — Desde el menú de la app:**
1. Tocá el ícono de menú (☰) en la esquina superior izquierda
2. Buscá el botón verde **"Instalar App"** en la parte inferior del menú
3. Tocá **"Instalar"** en el diálogo que aparece

**Opción B — Desde Chrome:**
1. Tocá los tres puntos (⋮) en la esquina superior derecha de Chrome
2. Seleccioná **"Instalar app"** o **"Agregar a pantalla de inicio"**
3. Confirmá tocando **"Instalar"**

### Paso 4 — Listo
La app aparece en tu pantalla de inicio con el ícono de Grupo Gamma (logo blanco sobre fondo verde oscuro). Abrila como cualquier otra app — funciona sin barra de navegación del browser.

### Activar notificaciones
Al iniciar sesión por primera vez, la app te pedirá permiso para enviar notificaciones. **Tocá "Permitir"** para recibir avisos de nuevos traslados y cambios de estado en tiempo real.

---

## iPhone / iPad (Safari)

### Paso 1 — Abrir en Safari
**Importante:** en iPhone solo funciona con **Safari** (no Chrome ni otro navegador).

Abrí **Safari** y navegá a la dirección de MediFlow.

### Paso 2 — Iniciar sesión
Ingresá tu usuario y contraseña.

### Paso 3 — Agregar a pantalla de inicio
1. Tocá el botón de **compartir** (⬆️ el cuadrado con flecha hacia arriba) en la barra inferior de Safari
2. Deslizá hacia abajo en el menú que aparece
3. Tocá **"Agregar a pantalla de inicio"**
4. Opcionalmente cambiá el nombre (o dejá "Grupo Gamma")
5. Tocá **"Agregar"** en la esquina superior derecha

### Paso 4 — Listo
La app aparece en tu pantalla de inicio. Abrila desde ahí — se abre en pantalla completa sin la barra de Safari.

### Nota sobre notificaciones en iPhone
Las notificaciones push en iPhone funcionan a partir de **iOS 16.4** y solo si la app fue instalada desde Safari siguiendo estos pasos. Al abrir la app por primera vez después de instalarla, aceptá el permiso de notificaciones.

---

## Vista previa de la aplicación

### Pantalla de login
```
┌──────────────────────────────┐
│                              │
│        [Logo Gamma]          │
│                              │
│        Bienvenido            │
│    Gestión de Traslados      │
│                              │
│   ┌──────────────────────┐   │
│   │  Correo electrónico  │   │
│   └──────────────────────┘   │
│   ┌──────────────────────┐   │
│   │  Contraseña      👁  │   │
│   └──────────────────────┘   │
│                              │
│   ┌──────────────────────┐   │
│   │      Ingresar        │   │
│   └──────────────────────┘   │
│                              │
│   Grupo Gamma · Red de Salud │
│        MediFlow v1.0         │
└──────────────────────────────┘
```

### Mapa de Camas (vista principal)
```
┌──────────────────────────────┐
│ ☰ Mapa de Camas    🔔 Admin │
├──────────────────────────────┤
│ 🔍 Buscar...    [8 sectores] │
│ ● DISP ● INHAB ● OCUP ● PREP│
├──────────────────────────────┤
│ ITR                          │
│ ┌────┐┌────┐┌────┐┌────┐    │
│ │7777│|7777│|7777│|7777│    │
│ │ -1 ││ -2 ││ -3 ││ -4 │    │
│ └────┘└────┘└────┘└────┘    │
│ Piso 4                      │
│ ┌────┐┌────┐┌────┐┌────┐    │
│ │401 ││403 ││403 ││405 │    │
│ │ -1 ││ -1 ││ -2 ││ -1 │    │
│ └────┘└────┘└────┘└────┘    │
│                              │
│ 🟢 Disponible  🔴 Ocupada   │
│ 🟡 Preparación 🔵 Asignada  │
└──────────────────────────────┘
```

### Detalle de cama (al tocar una cama ocupada)
```
┌──────────────────────────────┐
│ 🛏 Hab. 403 — Cama 1     ✕ │
│ ● OCUPADA                    │
├──────────────────────────────┤
│ PACIENTE                     │
│ MELITA JOSE SANTIAGO         │
├──────────────────────────────┤
│ DNI        EDAD    SEXO  EVT │
│ 12944930   68      M   HIN- │
│                      57879   │
├──────────────────────────────┤
│ FINANCIADOR    ID PACIENTE   │
│ IAPOS ROSARIO  1011072       │
├──────────────────────────────┤
│ PROFESIONAL                  │
│ MARTINEL LAMAS MARIA JIMENA  │
├──────────────────────────────┤
│ DIAGNÓSTICO                  │
│ CA DE COLON ESTADIO IV       │
└──────────────────────────────┘
```

### Operativa (tickets activos)
```
┌──────────────────────────────┐
│ ☰ Operativa         🔔 Azaf │
├──────────────────────────────┤
│ [ADMISIÓN] [AZAFATA]  ⏱ 82m │
│ 🔍 Paciente o ID...         │
├──────────────────────────────┤
│ Estado    Paciente    Acción │
├──────────────────────────────┤
│ Esperando MELITA     [HAB.  │
│ Hab.      JOSE S.    LISTA] │
│           403→411            │
├──────────────────────────────┤
│ Hab.      GARCÍA    [INICIAR│
│ Lista     JUAN      TRASL.] │
│           417→509            │
├──────────────────────────────┤
│ En        DÍAZ      [RECEP. │
│ Traslado  JORGE      OK]    │
│           403→407            │
└──────────────────────────────┘
```

### Notificación push (ejemplo)
```
┌──────────────────────────────┐
│ 🔔 MediFlow                  │
│ Nueva Solicitud de Traslado  │
│ MELITA JOSE SANTIAGO:        │
│ Hab 403 → Hab 411            │
└──────────────────────────────┘
```

---

## Solución de problemas

| Problema | Solución |
|----------|----------|
| No aparece "Instalar App" en Android | Asegurate de estar en Chrome. Si ya la instalaste antes, desinstalala y volvé a entrar |
| No llegan notificaciones | Verificá que diste permiso de notificaciones en Ajustes > Apps > Chrome > Notificaciones |
| La app no carga datos | Verificá tu conexión a internet. La app necesita conexión para funcionar |
| iPhone: no aparece "Agregar a pantalla de inicio" | Asegurate de estar en Safari, no en Chrome |
| La sesión se cerró | Tu token expiró. Volvé a iniciar sesión |
| El ícono aparece blanco | Desinstalá la app y volvé a instalarla |
