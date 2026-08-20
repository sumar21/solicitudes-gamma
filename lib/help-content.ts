// ─────────────────────────────────────────────────────────────────────────────
// Contenido del botón de AYUDA por módulo. Cada acción/notificación está keyed por su
// permiso real; el componente <ModuleHelp> filtra con can(user, permiso) — la MISMA función
// que gatea los botones de la app, así la ayuda nunca miente y es dinámica: si tildás un permiso
// en el ABM, esa acción aparece sola en la ayuda de ese rol (sin tocar código).
//
// VOZ: texto en lenguaje simple para el usuario final — QUÉ puede hacer y DESDE DÓNDE (qué botón /
// qué solapa). Nada de detalles técnicos: sin API/endpoints, sin PROGAL/enrich/cron/webhook, sin
// nombres de componentes ni referencias a código. Al mantener/agregar items, respetá esa voz.
// permission '*' = siempre visible para quien ve el módulo. scopeNote solo se muestra si el rol
// filtra por pisos (badge azul de alcance).
// ─────────────────────────────────────────────────────────────────────────────

export interface HelpItem {
  /** Código de PERMISSIONS que habilita la acción, o '*' si es siempre visible en el módulo. */
  permission: string;
  title: string;
  description: string;
  /** Nota de alcance por pisos (solo se muestra si el rol tiene filter_by_floors). */
  scopeNote?: string;
  /** Dónde vive en la UI (view/solapa/botón). */
  uiLocation?: string;
}
export interface HelpNotif { permission: string; title: string; description: string; }
export interface HelpModule {
  key: string;
  label: string;
  overview: string;
  capabilities: HelpItem[];
  notifications: HelpNotif[];
  tips: string[];
}

/** Keyed por moduleKey (Operativa, MapaCamas, Comandas, Monitor, Historial, Configuracion). */
export const HELP_CONTENT: Record<string, HelpModule> = {
  Operativa: {
    key: "Operativa",
    label: "Operativa",
    overview: "Operativa es el tablero del día a día: desde acá creás y hacés avanzar los traslados de pacientes, cerrás las limpiezas de camas y seguís el circuito de cirugías paso a paso. Se organiza en tres solapas (Traslados, Limpiezas y Cirugías); qué solapas y botones ves depende de tu rol.",
    capabilities: [
      {
        permission: "crear_ticket",
        title: "Crear una solicitud de traslado",
        description: "Abrí el formulario para pedir el traslado de un paciente (origen, destino y tipo). También te habilita el selector 'actuar como' (Admisión / Azafata) para ver los botones de cada rol.",
        uiLocation: "Operativa → Traslados → botón 'Solicitud' (arriba a la derecha)",
      },
      {
        permission: "editar_ticket",
        title: "Editar un traslado",
        description: "Modificá los datos de un traslado activo (destino, motivo, etc.).",
        scopeNote: "Solo mientras el traslado sigue activo y ninguna azafata intervino todavía.",
        uiLocation: "Operativa → Traslados → botón 'Editar' de la fila",
      },
      {
        permission: "cancelar_ticket",
        title: "Cancelar un traslado",
        description: "Cancelá un traslado en cualquier momento antes de cerrarse; te pide un motivo.",
        uiLocation: "Operativa → Traslados → botón 'Cancelar' de la fila",
      },
      {
        permission: "consolidar",
        title: "Consolidar un traslado (cerrarlo)",
        description: "Cerrá el traslado una vez recibido el paciente. Es el último paso del circuito.",
        uiLocation: "Operativa → Traslados → botón 'Consolidar PROGAL' (aparece cuando el traslado está 'Por Consolidar')",
      },
      {
        permission: "confirmar_limpieza",
        title: "Marcar la habitación de destino como lista",
        description: "Confirmá que la habitación de destino está lista, para que pueda arrancar el traslado.",
        scopeNote: "Si tu rol filtra por pisos, solo la azafata del sector de destino ve el botón.",
        uiLocation: "Operativa → Traslados → solapa Azafata → botón 'Habitación Lista'",
      },
      {
        permission: "iniciar_traslado",
        title: "Iniciar el traslado del paciente",
        description: "Arrancá el traslado del paciente cuando la habitación de destino ya está lista.",
        scopeNote: "Si tu rol filtra por pisos, solo la azafata del sector de origen ve el botón.",
        uiLocation: "Operativa → Traslados → solapa Azafata → botón 'Iniciar Traslado'",
      },
      {
        permission: "confirmar_recepcion",
        title: "Confirmar la recepción del paciente",
        description: "Confirmá que el paciente llegó a destino. El traslado queda 'Por Consolidar'.",
        scopeNote: "Si tu rol filtra por pisos, solo la azafata del sector de destino ve el botón.",
        uiLocation: "Operativa → Traslados → solapa Azafata → botón 'Recepción OK'",
      },
      {
        permission: "*",
        title: "Ver y cargar observaciones de un traslado",
        description: "Leé y escribí notas sobre un traslado activo. Cualquier rol que entre a Traslados puede hacerlo.",
        uiLocation: "Operativa → Traslados → botón 'Observaciones' de la fila",
      },
      {
        permission: "consolidar_limpieza",
        title: "Consolidar una limpieza",
        description: "Cerrá la limpieza de una cama que una azafata marcó como limpia desde el mapa. Te pide confirmación.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las camas de tus sectores. Sin el permiso, ves la lista en solo lectura.",
        uiLocation: "Operativa → Limpiezas → solapa Activas → botón 'Consolidado PROGAL' de la fila",
      },
      {
        permission: "*",
        title: "Ver el histórico de limpiezas",
        description: "Consultá las limpiezas ya cerradas por rango de fechas (quién la marcó, cuándo y el motivo). Solo lectura.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las de tus sectores.",
        uiLocation: "Operativa → Limpiezas → solapa Histórico (Desde / Hasta + buscador)",
      },
      {
        permission: "*",
        title: "Ver el reporte de limpiezas de rutina del día",
        description: "Mirá las limpiezas de rutina (camas ocupadas) iniciadas y finalizadas en un día. Solo lectura: iniciarlas o finalizarlas se hace en el Mapa de Camas.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las de tus sectores.",
        uiLocation: "Operativa → Limpiezas → solapa 'Rutina (hoy)' (selector de día)",
      },
      {
        permission: "cirugia_buscar",
        title: "Cirugía: despachar al camillero ('Voy a buscar')",
        description: "Marcá que quirófano manda al camillero a buscar al paciente. Pasa la cirugía de 'Listo para cirugía' a 'Van a buscar'.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las cirugías de tus sectores.",
        uiLocation: "Operativa → Cirugías → solapa Activas → botón 'Voy a buscar'",
      },
      {
        permission: "cirugia_entregar",
        title: "Cirugía: registrar 'se lo llevó el camillero'",
        description: "Registrá que el camillero se llevó al paciente. Pasa de 'Van a buscar' a 'En traslado' y la cama queda libre para limpiar.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las cirugías de tus sectores.",
        uiLocation: "Operativa → Cirugías → solapa Activas → botón 'Se lo llevó el camillero'",
      },
      {
        permission: "cirugia_operar",
        title: "Cirugía: marcar 'en cirugía'",
        description: "Marcá que el paciente entró a quirófano. Pasa de 'En traslado' a 'En cirugía'.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las cirugías de tus sectores.",
        uiLocation: "Operativa → Cirugías → solapa Activas → botón 'En cirugía'",
      },
      {
        permission: "cirugia_devolver",
        title: "Cirugía: marcar 'en devolución'",
        description: "Marcá que el paciente sale de quirófano y vuelve al piso. Pasa de 'En cirugía' a 'En devolución'.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las cirugías de tus sectores.",
        uiLocation: "Operativa → Cirugías → solapa Activas → botón 'En devolución'",
      },
      {
        permission: "cirugia_recibir",
        title: "Cirugía: confirmar recepción ('Recibida')",
        description: "Confirmá que el piso de destino recibió al paciente. Pasa de 'En devolución' a 'Recibida'.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las cirugías de tus sectores.",
        uiLocation: "Operativa → Cirugías → solapa Activas → botón 'Recibida'",
      },
      {
        permission: "cirugia_tolerancia",
        title: "Cirugía: confirmar evaluación de tolerancia (cierra)",
        description: "Registrá la evaluación de tolerancia. Es el último paso: cierra la cirugía y habilita la comanda del paciente.",
        uiLocation: "Operativa → Cirugías → solapa Activas → botón 'Evaluación de tolerancia'",
      },
      {
        permission: "cirugia_cancelar",
        title: "Cirugía: cancelar la operatoria",
        description: "Cancelá una cirugía en curso con un motivo obligatorio. Disponible en cualquier estado salvo 'Recibida'.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las cirugías de tus sectores.",
        uiLocation: "Operativa → Cirugías → solapa Activas → botón 'Cancelar' de la fila",
      },
      {
        permission: "*",
        title: "Ver el histórico de cirugías y su detalle",
        description: "Consultá las cirugías cerradas (evaluadas o canceladas) por rango de fechas y abrí el detalle con la línea de tiempo de cada paso y sus tiempos. Solo lectura.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las de tus sectores.",
        uiLocation: "Operativa → Cirugías → solapa Histórico (Desde / Hasta + buscador) → botón 'Ver detalle'",
      },
      {
        permission: "cirugia_marcar",
        title: "Marcar 'va a cirugía' a un paciente",
        description: "Habilitá el circuito de cirugía para un paciente que no es quirúrgico. Es una marca que sigue al paciente. Ojo: esta acción no está en Operativa, se hace desde el Mapa de Camas.",
        uiLocation: "Mapa de Camas → tocá la cama ocupada → solapa 'Internación' → toggle 'Va a cirugía'",
      },
      {
        permission: "cirugia_listo",
        title: "Marcar 'listo para cirugía' (alta del circuito)",
        description: "Da de alta la cirugía sobre una cama ocupada: es el arranque del circuito que después seguís en Operativa → Cirugías. También se hace desde el Mapa de Camas, no desde Operativa.",
        scopeNote: "Aparece si el paciente es quirúrgico o si ya lo marcaron 'va a cirugía'.",
        uiLocation: "Mapa de Camas → detalle de la cama ocupada → botón 'Listo para cirugía'",
      },
    ],
    notifications: [
      {
        permission: "notif_new_ticket",
        title: "Traslado pedido (nuevo)",
        description: "Te avisa cuando Admisión crea un traslado nuevo.",
      },
      {
        permission: "notif_status_update",
        title: "Actualizaciones de estado del traslado",
        description: "Te avisa cuando un traslado cambia de estado: Habitación Lista, En Traslado, Consolidado y Cancelado.",
      },
      {
        permission: "notif_reception_confirmed",
        title: "Recepción confirmada (traslado finalizado)",
        description: "Te avisa cuando la azafata confirma que recibió al paciente y el traslado queda 'Por Consolidar'.",
      },
      {
        permission: "notif_habitacion_limpia",
        title: "Habitación limpia",
        description: "Te avisa cuando una azafata marca una habitación como limpia desde el mapa.",
      },
      {
        permission: "notif_cirugia_cama_progal",
        title: "Cirugía · Cambio de cama detectado",
        description: "Te avisa cuando a un paciente en cirugía le cambian la cama por fuera de la app.",
      },
      {
        permission: "notif_cirugia_lista",
        title: "Cirugía · Listo para cirugía",
        description: "Te avisa cuando se da de alta una cirugía ('Listo para cirugía').",
      },
      {
        permission: "notif_cirugia_camillero",
        title: "Cirugía · Camillero va a buscar al paciente",
        description: "Te avisa cuando el camillero sale a buscar al paciente.",
      },
      {
        permission: "notif_cirugia_retirado",
        title: "Cirugía · Paciente retirado",
        description: "Te avisa cuando el camillero se llevó al paciente y la cama quedó libre para limpiar.",
      },
      {
        permission: "notif_cirugia_en_cirugia",
        title: "Cirugía · Paciente en cirugía",
        description: "Te avisa cuando el paciente entró a quirófano.",
      },
      {
        permission: "notif_cirugia_volviendo",
        title: "Cirugía · Paciente volviendo",
        description: "Te avisa cuando el paciente vuelve de quirófano al piso.",
      },
      {
        permission: "notif_cirugia_recibido",
        title: "Cirugía · Paciente recibido",
        description: "Te avisa cuando el piso recibió al paciente que volvió de cirugía.",
      },
      {
        permission: "notif_cirugia_finalizada",
        title: "Cirugía · Evaluación de tolerancia realizada",
        description: "Te avisa cuando se evaluó la tolerancia y se cerró la cirugía (ya se le puede llevar la comanda).",
      },
    ],
    tips: [
      "Cancelar o consolidar no borra nada: el traslado queda guardado en el Historial.",
      "Muchos pasos de cirugía también se hacen desde la tarjeta de la cama, en el Mapa.",
    ],
  },
  MapaCamas: {
    key: "MapaCamas",
    label: "Mapa de Camas",
    overview: "El Mapa de Camas es una grilla visual de todas las camas del hospital, con su estado, aislamiento, dieta/ayuno y cirugía. Al tocar una cama se abre el detalle del paciente en solapas (Generales, Internación, Dieta, Ayunos), desde donde descargás partes en PDF, marcás limpiezas, cargás comandas y hacés la parte de cirugía que le toca a Enfermería del piso.",
    capabilities: [
      {
        permission: "*",
        title: "Ver el mapa y el detalle del paciente",
        description: "Mirá la grilla de camas y, al tocar una, el detalle del paciente (DNI, edad, financiador, profesional, diagnóstico, tipo y fecha de internación, días autorizados, etc.). Es solo lectura.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las camas de tus sectores.",
        uiLocation: "Mapa de Camas → grilla; al tocar una cama, detalle con solapas Generales / Internación / Dieta / Ayunos",
      },
      {
        permission: "*",
        title: "Ver el historial (trayectoria) del paciente",
        description: "Abrí la línea de tiempo de traslados y cirugías del paciente desde el detalle de la cama. Solo lectura.",
        uiLocation: "Detalle de la cama → cabecera 'Paciente' → botón 'Historial del paciente'",
      },
      {
        permission: "*",
        title: "Descargar partes en PDF",
        description: "Exportá el listado de camas a PDF en tres formatos: por sector, alfabético por paciente (A-Z) y de dietas/ayunos.",
        uiLocation: "Barra superior del mapa → botones 'PDF' / 'PDF A-Z' / 'Dietas' (en mobile, dentro del menú ⋯)",
      },
      {
        permission: "*",
        title: "Buscar y filtrar camas",
        description: "Filtrá la grilla por texto, sector, estado, aislamiento, dieta, ayuno, cirugía, financiador, profesional, tipo de admisión y fecha de internación.",
        scopeNote: "Si tu rol filtra por pisos, solo ves los sectores asignados.",
        uiLocation: "Barra de filtros del mapa (chips y buscador)",
      },
      {
        permission: "*",
        title: "Refrescar el mapa",
        description: "Volvé a traer el estado actualizado de las camas.",
        uiLocation: "Barra superior del mapa → botón 'Refrescar' (o 'Refrescar mapa' en el menú ⋯)",
      },
      {
        permission: "confirmar_limpieza",
        title: "Marcar habitación limpia (y Deshacer)",
        description: "Marcá como limpia una habitación 'en preparación' desde el mapa; si ya está limpia, podés deshacer la marca.",
        scopeNote: "Si tu rol filtra por pisos, solo aparece para las camas de tus sectores.",
        uiLocation: "Detalle de la cama (en preparación) → botón verde 'Marcar habitación limpia'; si ya está limpia → chip 'Limpia ✓' + botón 'Deshacer'",
      },
      {
        permission: "limpieza_rutina",
        title: "Limpieza de rutina: iniciar / finalizar",
        description: "Sobre una cama ocupada, iniciá y después finalizá una limpieza de rutina (suele hacerse ~2 veces por día). No cambia el estado de la cama.",
        uiLocation: "Detalle de la cama ocupada → bloque celeste 'Iniciar limpieza de rutina' / 'Finalizar limpieza de rutina'",
      },
      {
        permission: "cirugia_marcar",
        title: "Marcar 'va a cirugía' (y desmarcar)",
        description: "Prendé o apagá la marca 'va a cirugía' de un paciente que no es quirúrgico, para habilitarle el circuito de cirugía. La marca sigue al paciente. Los pacientes quirúrgicos ya vienen habilitados.",
        uiLocation: "Detalle de la cama → solapa Internación → toggle 'Va a cirugía'",
      },
      {
        permission: "cirugia_listo",
        title: "Marcar 'Listo para cirugía' (alta del circuito)",
        description: "Da de alta la cirugía sobre una cama ocupada. Solo aparece para pacientes quirúrgicos o marcados 'va a cirugía'.",
        uiLocation: "Detalle de la cama ocupada → bloque ámbar → botón 'Listo para cirugía'",
      },
      {
        permission: "cirugia_entregar",
        title: "Registrar 'se lo llevó el camillero'",
        description: "Confirmá que el camillero se llevó al paciente. La cama queda libre para limpiar.",
        uiLocation: "Detalle de la cama con cirugía en 'Van a buscar' → botón amarillo 'Se lo llevó el camillero'",
      },
      {
        permission: "cirugia_recibir",
        title: "Confirmar recepción del paciente",
        description: "Confirmá que recibiste al paciente en el piso donde llega, cuando la cirugía está 'en devolución'.",
        uiLocation: "Detalle de la cama con cirugía en 'En devolución' → botón verde 'Recibí al paciente'",
      },
      {
        permission: "cirugia_tolerancia",
        title: "Confirmar evaluación de tolerancia (cierra la cirugía)",
        description: "Después de recibir al paciente, registrá la evaluación de tolerancia. Este paso cierra la cirugía.",
        uiLocation: "Detalle de la cama con cirugía en 'Recibida' → botón verde 'Evaluación de tolerancia'",
      },
      {
        permission: "ver_dieta",
        title: "Ver comandas cargadas (menú por turno)",
        description: "Mirá el menú cargado por turno (desayuno, almuerzo, merienda, cena) del paciente.",
        uiLocation: "Detalle de la cama → solapa Dieta → sección 'Menú'",
      },
      {
        permission: "cargar_dieta",
        title: "Cargar / editar comandas del paciente y del acompañante",
        description: "Cargá y editá el menú por turno del paciente y de sus acompañantes. Los turnos que no tengas habilitados los ves con candado, en solo lectura.",
        scopeNote: "Según tu rol podés tener habilitados todos los turnos o solo algunos.",
        uiLocation: "Detalle de la cama → solapa Dieta → editor por turno (Desayuno / Almuerzo / Merienda / Cena)",
      },
    ],
    notifications: [
      {
        permission: "notif_habitacion_limpia",
        title: "Habitación limpia",
        description: "Te avisa cuando una azafata marca una habitación como limpia desde el mapa.",
      },
      {
        permission: "notif_diet_change",
        title: "Cambio de dieta",
        description: "Te avisa cuando a un paciente le cambia la dieta (lo ves en la solapa Dieta del detalle).",
      },
      {
        permission: "notif_fasting_change",
        title: "Cambio de ayuno",
        description: "Te avisa cuando a un paciente le cambia o se le cancela el ayuno (lo ves en la solapa Ayunos).",
      },
      {
        permission: "notif_cirugia_cama_progal",
        title: "Cambio de cama detectado",
        description: "Te avisa cuando a un paciente en cirugía le cambian la cama por fuera de la app.",
      },
      {
        permission: "notif_cirugia_lista",
        title: "Cirugía · Listo para cirugía",
        description: "Te avisa cuando se da de alta una cirugía ('Listo para cirugía').",
      },
      {
        permission: "notif_cirugia_camillero",
        title: "Cirugía · Camillero va a buscar al paciente",
        description: "Te avisa cuando el camillero sale a buscar al paciente.",
      },
      {
        permission: "notif_cirugia_retirado",
        title: "Cirugía · Paciente retirado",
        description: "Te avisa cuando el camillero se llevó al paciente y la cama quedó libre para limpiar.",
      },
      {
        permission: "notif_cirugia_recibido",
        title: "Cirugía · Paciente recibido",
        description: "Te avisa cuando el piso recibió al paciente que volvió de cirugía.",
      },
      {
        permission: "notif_cirugia_finalizada",
        title: "Cirugía · Evaluación de tolerancia realizada",
        description: "Te avisa cuando se evaluó la tolerancia y se cerró la cirugía (ya se le puede llevar la comanda).",
      },
    ],
    tips: [
      "Los colores y el borde de cada cama te muestran de un vistazo su estado: libre, ocupada, en preparación, aislamiento y cirugía.",
      "La ficha de la cama trae los datos del paciente, su dieta, sus ayunos y su trayectoria.",
    ],
  },
  Comandas: {
    key: "Comandas",
    label: "Gestión de Comandas",
    overview: "Comandas gestiona los pedidos de comida (bandejas) de pacientes y acompañantes: Nutrición los carga por turno desde la tarjeta de cada cama en el Mapa, y la cocina/catering los ve, entrega o anula, planifica el menú por rango de fechas y sigue los cambios de dieta y ayuno.",
    capabilities: [
      {
        permission: "*",
        title: "Ver las comandas del día",
        description: "Mirá la grilla de comandas de hoy (pendientes de entregar y ya entregadas), ordenadas por orden de despacho de cocina (piso → habitación → turno → comensal), con buscador.",
        scopeNote: "Si tu rol filtra por pisos, solo ves las comandas de tus sectores.",
        uiLocation: "Comandas → solapa 'De hoy' (Pendientes / Entregadas)",
      },
      {
        permission: "*",
        title: "Marcar una comanda como entregada",
        description: "Tildá el check verde de una bandeja pendiente para registrarla como entregada, con su hora.",
        uiLocation: "Comandas → 'De hoy' → Pendientes → botón check verde de la fila",
      },
      {
        permission: "*",
        title: "Anular una comanda (con motivo)",
        description: "Anulá una bandeja pendiente escribiendo el motivo (queda en el histórico). No se borra: pasa a 'Anulada'. Una bandeja ya entregada no se puede anular directo: primero volvela a pendiente.",
        uiLocation: "Comandas → 'De hoy' → Pendientes → botón X de la fila → modal 'Anular comanda'",
      },
      {
        permission: "*",
        title: "Volver una comanda entregada a pendiente",
        description: "Deshacé una entrega marcada por error: la bandeja vuelve a pendiente para editarla o anularla.",
        uiLocation: "Comandas → 'De hoy' → Entregadas → botón 'Volver' de la fila",
      },
      {
        permission: "*",
        title: "Ver el histórico de comandas por rango de fechas",
        description: "Consultá comandas de días anteriores eligiendo Desde / Hasta. Misma grilla que 'De hoy', pero sin botones de acción.",
        uiLocation: "Comandas → solapa 'Histórico' → Desde / Hasta + botón Actualizar",
      },
      {
        permission: "*",
        title: "Ver los cambios de dieta/ayuno",
        description: "Mirá los cambios de dieta detectados en un rango de fechas (lo anterior vs lo nuevo), con buscador. Solo lectura.",
        uiLocation: "Comandas → solapa 'Cambios de dieta'",
      },
      {
        permission: "*",
        title: "Exportar la grilla a PDF o Excel",
        description: "Descargá la tabla actual (De hoy o Histórico, ya filtrada) como PDF o Excel para la cocina.",
        uiLocation: "Comandas → barra de acciones → botones 'PDF' y 'Excel'",
      },
      {
        permission: "ver_planificacion",
        title: "Ver la planificación de menú (solo lectura)",
        description: "Abrí la planificación y leé los menús ya planificados por rango de fechas y turno. Con este permiso no podés crear ni editar.",
        uiLocation: "Comandas → botón 'Planificación' → modal 'Planificación de comandas'",
      },
      {
        permission: "abm_planificacion",
        title: "Crear / editar / eliminar planificación de menú",
        description: "Cargá un menú planificado (turno, tipo Menú/Opción, rango de fechas y texto de la comanda), editalo o eliminalo. Ese texto después autocompleta la carga por paciente. Las planificaciones vencidas quedan en solo lectura.",
        uiLocation: "Comandas → 'Planificación' → botón 'Nueva planificación' / íconos Editar (lápiz) y Eliminar (tacho) de cada fila",
      },
      {
        permission: "ver_dieta",
        title: "Ver las comandas ya cargadas de un paciente",
        description: "Mirá el ícono de comanda (tenedor) en la tarjeta de la cama y el detalle de las bandejas cargadas por turno, en modo lectura (turno, tipo, detalle, observaciones y hora). Es lo que usa Catering.",
        uiLocation: "Mapa de Camas → tarjeta de la cama (ícono tenedor) y detalle → solapa 'Dieta' → sección 'Menú'",
      },
      {
        permission: "cargar_dieta",
        title: "Cargar / editar la comanda del paciente por turno",
        description: "Elegí Menú / Opción / Otros y escribí la comanda del paciente para cada turno del día (Desayuno / Almuerzo / Merienda / Cena) y guardala. Los turnos que no tengas habilitados los ves con candado.",
        uiLocation: "Mapa de Camas → detalle de la cama → solapa 'Dieta' → sección 'Menú — Nutrición' → box del turno → Guardar / Actualizar",
      },
      {
        permission: "cargar_dieta",
        title: "Quitar (anular) la comanda del paciente con motivo",
        description: "Eliminá la bandeja pendiente del paciente escribiendo un motivo obligatorio. Si ya se entregó, primero hay que volverla a pendiente desde Comandas.",
        uiLocation: "Mapa de Camas → detalle de la cama → solapa 'Dieta' → box del turno → botón 'Quitar'",
      },
      {
        permission: "cargar_dieta",
        title: "Agregar / editar / quitar comandas de acompañantes",
        description: "Agregá bandejas para los acompañantes del paciente en un turno (hasta el máximo permitido), editalas o quitalas.",
        uiLocation: "Mapa de Camas → detalle de la cama → solapa 'Dieta' → box del turno → 'Agregar acompañante' / Guardar / Quitar",
      },
      {
        permission: "cirugia_marcar",
        title: "Marcar 'va a cirugía' a un paciente",
        description: "Prendé o apagá la marca que habilita el circuito de cirugía para un paciente que no es quirúrgico (los quirúrgicos ya vienen habilitados). La marca sigue al paciente y después habilita el botón 'Listo para cirugía'.",
        scopeNote: "No es un permiso del módulo Comandas: es de Cirugía y vive en el detalle de la cama (Mapa).",
        uiLocation: "Mapa de Camas → detalle de la cama → solapa 'Internación' → toggle 'Va a cirugía'",
      },
    ],
    notifications: [
      {
        permission: "notif_diet_change",
        title: "Cambio de dieta",
        description: "Te avisa cuando a un paciente le cambia la dieta. La comanda puede tener que rehacerse.",
      },
      {
        permission: "notif_fasting_change",
        title: "Cambio de ayuno",
        description: "Te avisa cuando a un paciente le cambia o se le cancela un ayuno. Impacta qué comanda pedir o suspender.",
      },
      {
        permission: "notif_reception_confirmed",
        title: "Recepción confirmada (traslado finalizado)",
        description: "Te avisa cuando un traslado llega a destino, para saber dónde entregar la bandeja.",
      },
      {
        permission: "notif_cirugia_finalizada",
        title: "Cirugía · Evaluación de tolerancia realizada",
        description: "Te avisa cuando se cerró la cirugía y ya se le puede llevar la comanda al paciente.",
      },
    ],
    tips: [
      "La comanda sigue al paciente: si cambia de cama, no se pierde.",
      "Anular una comanda pide un motivo y queda en el histórico (no se borra).",
    ],
  },
  Monitor: {
    key: "Monitor",
    label: "Monitor",
    overview: "El Monitor es el tablero de inicio, en solo lectura: te muestra en una pantalla los indicadores del período (casos activos, espera media, productividad, con su tendencia vs el período anterior), gráficos de volumen y estado, y dos listas en vivo de traslados que necesitan atención (pendientes de consolidar y en ejecución). Desde acá no se ejecuta ninguna acción.",
    capabilities: [
      {
        permission: "*",
        title: "Ver indicadores del período (KPIs con tendencia)",
        description: "Tres tarjetas: Casos Activos (traslados sin finalizar), Espera Media (minutos promedio entre la solicitud y la cama) y Productividad (traslados finalizados). Cada una muestra una flecha de tendencia comparando con el período anterior.",
        scopeNote: "Si tu rol filtra por pisos, los indicadores son solo de tus sectores.",
        uiLocation: "Monitor → fila superior de 3 tarjetas",
      },
      {
        permission: "*",
        title: "Elegir el período (Hoy / 7 días / 30 días o un rango)",
        description: "Botones rápidos Hoy, 7 días y 30 días, más un rango personalizado con calendario (Desde / Hasta). Cambiar el período recalcula los indicadores y los gráficos.",
        scopeNote: "El período afecta los indicadores y gráficos; las dos listas de abajo son de 'ahora' y no dependen del período.",
        uiLocation: "Monitor → barra superior de período (presets + calendarios Desde / Hasta)",
      },
      {
        permission: "*",
        title: "Actualizar (recargar los datos)",
        description: "El Monitor no se actualiza solo: se carga al entrar y lo refrescás con este botón.",
        uiLocation: "Monitor → botón 'Actualizar' a la derecha de la barra de período",
      },
      {
        permission: "*",
        title: "Ver volumen por tipo de traslado",
        description: "Gráfico de barras con el volumen del período por tipo: Traslado Interno (con desglose por motivo), Sala de Espera Admisión e Ingreso a ITR.",
        scopeNote: "Si tu rol filtra por pisos, solo cuenta lo de tus sectores.",
        uiLocation: "Monitor → gráfico de la izquierda",
      },
      {
        permission: "*",
        title: "Ver distribución por estado (donut)",
        description: "Gráfico de anillo con los traslados del período por estado: Esperando Habitación, En Tránsito, En Traslado, Por Consolidar y Completados.",
        scopeNote: "Si tu rol filtra por pisos, solo cuenta lo de tus sectores.",
        uiLocation: "Monitor → gráfico de la derecha",
      },
      {
        permission: "*",
        title: "Ver la lista en vivo 'Admisión Pendiente'",
        description: "Columna con los traslados en 'Por Consolidar' (esperando que Admisión los cierre), en vivo. Cada tarjeta muestra número, paciente, origen y hora.",
        scopeNote: "Si tu rol filtra por pisos, solo ves los de tus sectores.",
        uiLocation: "Monitor → columna izquierda 'Admisión Pendiente'",
      },
      {
        permission: "*",
        title: "Ver la lista en vivo 'En Ejecución'",
        description: "Columna con los traslados en curso (Esperando Habitación, En Tránsito o En Traslado), en vivo. Cada tarjeta muestra número, paciente, origen → destino y si la cama está Limpia o Sucia.",
        scopeNote: "Si tu rol filtra por pisos, solo ves los de tus sectores.",
        uiLocation: "Monitor → columna derecha 'En Ejecución'",
      },
    ],
    notifications: [
      {
        permission: "notif_new_ticket",
        title: "Traslado pedido (nuevo)",
        description: "Te avisa cuando Admisión crea un traslado nuevo. Es lo que hace aparecer un traslado en las listas del Monitor.",
      },
      {
        permission: "notif_status_update",
        title: "Actualizaciones de estado",
        description: "Te avisa cuando un traslado cambia de estado (Habitación Lista, En Traslado, Consolidado, Cancelado). Es lo que mueve los traslados entre las columnas del Monitor.",
      },
      {
        permission: "notif_reception_confirmed",
        title: "Recepción confirmada (traslado finalizado)",
        description: "Te avisa cuando un traslado pasa a 'Por Consolidar'. Aparece en la lista 'Admisión Pendiente'.",
      },
    ],
    tips: [
      "Los indicadores y las listas se recalculan según el período que elijas.",
      "No se actualiza solo: tocá \"Actualizar\" para traer lo último.",
    ],
  },
  Historial: {
    key: "Historial",
    label: "Historial",
    overview: "Historial es la vista de auditoría de traslados ya cerrados: lista los traslados Consolidados y Cancelados de un rango de fechas, te deja buscar, filtrar y exportar a Excel, abrir la auditoría paso a paso de cada traslado (con sus tiempos y observaciones) y ver la trayectoria completa de un paciente (todos sus traslados y cirugías).",
    capabilities: [
      {
        permission: "*",
        title: "Ver el historial de traslados (Lista)",
        description: "Mostrá los traslados ya cerrados (Consolidados y Cancelados) del rango de fechas cargado, del más reciente al más antiguo.",
        uiLocation: "Historial → solapa 'Lista'",
      },
      {
        permission: "*",
        title: "Filtrar por rango de fechas (Desde / Hasta)",
        description: "Elegí un rango de fechas para traer los traslados de ese período.",
        uiLocation: "Historial → barra de filtros → botones 'Desde' y 'Hasta'",
      },
      {
        permission: "*",
        title: "Buscar por paciente o número de traslado",
        description: "Filtrá la lista por nombre de paciente o número de traslado, dentro del rango de fechas cargado.",
        scopeNote: "Busca solo en las fechas cargadas; para un paciente viejo, ampliá el rango o usá la Trayectoria (que trae su historia completa).",
        uiLocation: "Historial → barra de filtros → buscador (arriba de la lista)",
      },
      {
        permission: "*",
        title: "Filtrar por resultado (Todos / Consolidados / Cancelados)",
        description: "Segmentá la lista para ver todos los traslados, solo los consolidados o solo los cancelados.",
        uiLocation: "Historial → barra de filtros → segmentado 'Todos / Consolidados / Cancelados'",
      },
      {
        permission: "*",
        title: "Limpiar filtros",
        description: "Volvé las fechas a hoy, borrá la búsqueda y el filtro de resultado a 'Todos'. Aparece solo cuando hay algún filtro aplicado.",
        uiLocation: "Historial → barra de filtros → botón 'Limpiar'",
      },
      {
        permission: "*",
        title: "Actualizar el histórico",
        description: "Volvé a cargar el histórico del rango actual (no se actualiza solo).",
        uiLocation: "Historial → barra de filtros → botón 'Actualizar'",
      },
      {
        permission: "*",
        title: "Exportar reporte a Excel",
        description: "Generá un Excel con dos hojas: 'Tickets' (una fila por traslado con sus tiempos) y 'Movimientos' (una fila por evento de la auditoría).",
        uiLocation: "Historial → barra de filtros → botón 'Excel'",
      },
      {
        permission: "*",
        title: "Auditar un traslado",
        description: "Abrí la auditoría del traslado: los hitos (creación, preparación, inicio, recepción, consolidación), los tiempos por servicio, el motivo de cancelación y las observaciones.",
        uiLocation: "Historial → botón 'Auditar' de la fila (desktop) o tap sobre la tarjeta (mobile)",
      },
      {
        permission: "*",
        title: "Agregar observación post-cierre",
        description: "Escribí una nota (hasta 500 caracteres) sobre un traslado ya cerrado; queda marcada como 'Post cierre' en la línea de tiempo, con tu usuario como autor.",
        uiLocation: "Modal de auditoría → redactor abajo (desktop) o botón 'Agregar observación' (mobile)",
      },
      {
        permission: "*",
        title: "Ver la Trayectoria del paciente",
        description: "Cambiá a modo Trayectoria y elegí un paciente del buscador para ver su historia completa, sin importar el rango de fechas de la Lista.",
        uiLocation: "Historial → segmentado 'Lista / Trayectoria' + selector 'Seleccionar paciente'",
      },
      {
        permission: "*",
        title: "Trayectoria · solapa Traslados",
        description: "Dentro de la Trayectoria, mirá el 'Camino de Camas' y la línea de tiempo de todos los traslados del paciente (activos e históricos), con sus hitos.",
        uiLocation: "Modal de Trayectoria → solapa 'Traslados'",
      },
      {
        permission: "*",
        title: "Trayectoria · solapa Cirugías del paciente",
        description: "Dentro de la Trayectoria, mirá todas las cirugías del paciente (estado, camas, tipo, inicio → cierre y duración).",
        uiLocation: "Modal de Trayectoria → solapa 'Cirugías'",
      },
    ],
    notifications: [],
    tips: [
      "La Trayectoria de un paciente trae su historia completa, sin importar el rango de fechas.",
      "Las notas post-cierre quedan guardadas para siempre, con autor y fecha.",
    ],
  },
  Configuracion: {
    key: "Configuracion",
    label: "Configuración",
    overview: "Panel de administración donde das de alta usuarios y definís los roles del sistema: qué módulos ve cada rol, qué acciones puede hacer y qué notificaciones recibe. Está en 'Configuración' del menú lateral, con dos secciones (Usuarios y Roles) que aparecen según tus permisos.",
    capabilities: [
      {
        permission: "abm_usuarios",
        title: "Ver la lista de usuarios",
        description: "Abrí la sección Usuarios y mirá todos los usuarios activos (nombre, rol, sectores y usuario de login), con buscador.",
        uiLocation: "Configuración → Usuarios",
      },
      {
        permission: "abm_usuarios",
        title: "Crear un usuario",
        description: "Dá de alta un usuario nuevo: nombre, apellido, email, rol, usuario de login y contraseña. El mismo permiso te deja crear, editar y desactivar.",
        uiLocation: "Usuarios → botón 'Nuevo Usuario'",
      },
      {
        permission: "abm_usuarios",
        title: "Editar un usuario",
        description: "Modificá los datos de un usuario (nombre, email, rol, login, contraseña opcional). Si dejás la contraseña vacía, no se cambia.",
        uiLocation: "Usuarios → ícono lápiz de la fila",
      },
      {
        permission: "abm_usuarios",
        title: "Desactivar un usuario (baja lógica)",
        description: "Dá de baja al usuario: no puede volver a iniciar sesión, pero queda en el historial (no se borra). Además su dispositivo deja de recibir notificaciones.",
        uiLocation: "Usuarios → ícono tacho de la fila → confirmación 'Desactivar Usuario'",
      },
      {
        permission: "abm_usuarios",
        title: "Asignar sectores/pisos a un usuario",
        description: "Elegí a qué sectores queda asignado el usuario. El selector solo aparece si el rol elegido filtra por pisos (p. ej. Azafata, Catering).",
        uiLocation: "Modal de usuario → bloque 'Sectores Asignados'",
      },
      {
        permission: "abm_roles",
        title: "Ver la lista de roles",
        description: "Abrí la sección Roles y mirá todos los roles activos con sus módulos, cantidad de permisos y su comportamiento, con buscador.",
        uiLocation: "Configuración → Roles",
      },
      {
        permission: "abm_roles",
        title: "Crear un rol",
        description: "Dá de alta un rol nuevo: nombre, módulos de acceso, permisos por módulo, comportamiento y notificaciones. El mismo permiso te deja crear, editar y eliminar.",
        uiLocation: "Roles → botón 'Nuevo Rol'",
      },
      {
        permission: "abm_roles",
        title: "Editar un rol",
        description: "Modificá un rol existente. Si editás tu propio rol, los cambios se aplican al instante, sin volver a loguearte.",
        uiLocation: "Roles → ícono lápiz",
      },
      {
        permission: "abm_roles",
        title: "Eliminar un rol (baja lógica)",
        description: "Dá de baja un rol (queda inactivo, no se borra). Los usuarios con ese rol no se ven afectados en el momento.",
        uiLocation: "Roles → ícono tacho → confirmación 'Eliminar Rol'",
      },
      {
        permission: "abm_roles",
        title: "Asignar módulos de acceso a un rol",
        description: "Tildá qué módulos ve el rol (Monitor, Operativa, Historial, Mapa de Camas, Comandas, Configuración). Si desactivás un módulo, se quitan sus permisos.",
        uiLocation: "Modal de rol → solapa General → 'Módulos de Acceso'",
      },
      {
        permission: "abm_roles",
        title: "Asignar permisos de acción por módulo",
        description: "Tildá los permisos finos del rol, agrupados por módulo en solapas. Cada solapa aparece solo si el módulo está habilitado. Acá se dan permisos como crear/editar/cancelar traslado, confirmar limpieza/recepción, consolidar, cargar/ver comandas y las acciones de Cirugía.",
        uiLocation: "Modal de rol → solapas por módulo",
      },
      {
        permission: "abm_roles",
        title: "Configurar el comportamiento del rol",
        description: "Fijá tres opciones del rol: 'Filtrado por pisos asignados' (ve solo lo de sus pisos vs todo), 'Acceso sin restricción de ubicación' (entra desde cualquier red vs solo las autorizadas) y 'Requiere identificación del operador' (en cuentas compartidas, pide el nombre al entrar y queda como responsable).",
        uiLocation: "Modal de rol → solapa General → bloque 'Comportamiento'",
      },
      {
        permission: "abm_roles",
        title: "Configurar qué notificaciones recibe el rol",
        description: "Tildá en la solapa Notificaciones qué avisos (push + campanita) recibe el rol: nuevo traslado, cambios de estado, recepción confirmada, cambio de dieta, cambio de ayuno, habitación limpia y los pasos de Cirugía.",
        uiLocation: "Modal de rol → solapa 'Notificaciones'",
      },
    ],
    notifications: [],
    tips: [
      "Desactivar un usuario no lo borra: solo le impide iniciar sesión.",
      "Si editás tu propio rol, los cambios se aplican al toque, sin re-loguear.",
    ],
  },
};
