import React, { useState, useEffect, useCallback } from 'react';
import { User, Permission, RoleModule, MEAL_SLOTS, mealSlotPermission } from '../types';
import { Settings, Plus, Search, X, AlertCircle, CheckCircle2, Pencil, Trash2 } from '../components/Icons';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DataTable, type Columna } from '../components/ui/data-table';
import { Vacio } from '../components/ui/estados';
import { StatusBadge, type Tono } from '../components/ui/status-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';

interface RoleManagementViewProps {
  currentUser: User | null;
  // Refresca la sesión en caliente si el admin edita su propio rol (no-op si es otro rol).
  onSessionRoleUpdate?: (role: {
    name: string; modules: RoleModule[]; permissions: Permission[];
    filterByFloors: boolean; bypassLocationCheck: boolean; requiresIdentification: boolean;
  }) => void;
}

interface SPRole {
  id: string;
  name: string;
  access: string; // "Home/Operativa/Historial/Mapa de Camas/Configuracion"
  permissions: Permission[];
  filterByFloors: boolean;
  bypassLocationCheck: boolean;
  requiresIdentification: boolean;
  status: string;
}

const MODULES = [
  { label: 'Home (Monitor)', value: 'Home' },
  { label: 'Operativa', value: 'Operativa' },
  { label: 'Historial', value: 'Historial' },
  { label: 'Mapa de Camas', value: 'Mapa de Camas' },
  // ⚠️ El `value` es lo que se guarda en Acceso_RT (SharePoint) y NO se toca: los 6 roles que
  // hoy lo tienen siguen funcionando sin migrar una sola fila. Solo cambia el label, porque
  // Limpiezas dejó de ser una entrada del sidebar y pasó a ser una solapa dentro de Operativa.
  { label: 'Operativa · Limpiezas', value: 'Gestion Limpieza' },
  { label: 'Gestión de Comandas', value: 'Gestion Comandas' },
  { label: 'Configuración', value: 'Configuracion' },
];

// Permisos agrupados por módulo (los checkboxes se renderizan dentro de cada sección
// solo si el módulo correspondiente está habilitado en el rol).
const PERMISSION_GROUPS: { module: string; label: string; perms: { code: Permission; label: string }[] }[] = [
  {
    module: 'Operativa', label: 'Operativa',
    perms: [
      { code: 'crear_ticket',        label: 'Crear ticket' },
      { code: 'editar_ticket',       label: 'Editar ticket' },
      { code: 'cancelar_ticket',     label: 'Cancelar ticket' },
      { code: 'confirmar_limpieza',  label: 'Confirmar limpieza (Habitación Lista)' },
      { code: 'iniciar_traslado',    label: 'Iniciar traslado' },
      { code: 'confirmar_recepcion', label: 'Confirmar recepción' },
      { code: 'consolidar',          label: 'Consolidar PROGAL' },
      // Vive en Operativa desde que Limpiezas pasó a ser una solapa de este módulo. Antes
      // estaba bajo 'Gestion Limpieza', y como un grupo solo se renderiza si su módulo está
      // tildado, era IMPOSIBLE darle este permiso a un rol con Operativa pero sin Limpieza.
      { code: 'consolidar_limpieza', label: 'Consolidar limpieza (solapa Limpiezas)' },
      { code: 'limpieza_rutina',     label: 'Limpieza de rutina (iniciar / finalizar en camas ocupadas)' },
      { code: 'limpieza_rutina_cancelar', label: 'Cancelar limpiezas con observación (activas sin consolidar y de rutina; solapa Limpiezas)' },
    ],
  },

  {
    // Pre-ticket de traslado: la Coordinadora pide una cama; Admisión la configura. Ver docs/planes/pre-ticket.md.
    module: 'Operativa', label: 'Pre-ticket de traslado',
    perms: [
      { code: 'crear_pre_ticket',     label: 'Crear pre-ticket (Coordinadora: pide cama)' },
      { code: 'completar_pre_ticket', label: 'Configurar destino de un pre-ticket (Admisión)' },
      { code: 'cancelar_pre_ticket',  label: 'Cancelar un pre-ticket (Presolicitud)' },
    ],
  },

  {
    // Cirugía — acciones de QUIRÓFANO, se operan desde la solapa Operativa → Cirugías (la grilla).
    module: 'Operativa', label: 'Cirugía — Quirófano (solapa Operativa)',
    perms: [
      { code: 'cirugia_buscar',   label: 'Búsqueda para cirugía (despachar camillero)' },
      { code: 'cirugia_operar',   label: 'En cirugía' },
      { code: 'cirugia_devolver', label: 'Regreso de cirugía' },
      { code: 'cirugia_cancelar', label: 'Cancelar operatoria' },
    ],
  },

  {
    module: 'Mapa de Camas', label: 'Mapa de Camas',
    perms: [
      { code: 'ver_dieta',    label: 'Ver comandas cargadas (Catering / Nutrición)' },
      // `cargar_dieta` es el permiso HISTÓRICO y significa TODOS los turnos: los roles que ya
      // lo tienen siguen cargando todo sin migrar nada en SP. Los de abajo (derivados de
      // MEAL_SLOTS) habilitan turno por turno y son aditivos — tildarlos junto con "todos los
      // turnos" es redundante, gana el de todos.
      { code: 'cargar_dieta', label: 'Cargar comandas — todos los turnos (Nutrición)' },
      // Rollback de una limpieza (29/10/2026): la habitación se pasó a limpia y está sucia.
      { code: 'limpieza_revertir', label: 'Volver una habitación limpia a "En preparación" (rollback de limpieza)' },
      ...MEAL_SLOTS.map(({ slot, label }) => ({ code: mealSlotPermission(slot), label: `Cargar comandas — solo ${label}` })),
    ],
  },
  {
    // Cirugía — acciones que se hacen desde la tarjeta de la cama (mapa de camas): Enfermería, Admisión y
    // Coordinación.
    module: 'Mapa de Camas', label: 'Cirugía — desde el mapa de camas',
    perms: [
      { code: 'cirugia_marcar',   label: 'Marcar "va a cirugía" (Admisión, paciente no quirúrgico)' },
      { code: 'cirugia_previa',   label: 'Registrar "Ya se operó (fuera de MediFlow)" (Coordinación; saca la "Q")' },
      { code: 'cirugia_volver_listo', label: 'Volver atrás un "Listo para cirugía" (anula la marca; también en Operativa → Cirugías)' },
      { code: 'cirugia_listo',    label: 'Marcar "listo para cirugía"' },
      { code: 'cirugia_entregar', label: 'Registrar "en traslado a cirugía"' },
      { code: 'cirugia_tolerancia', label: 'Iniciar dieta (paso final, cierra la operatoria)' },
    ],
  },
  {
    // Planificación del menú por rango de fechas (16.CargaMenu). Va acá y no en "Mapa de Camas"
    // porque se hace desde el módulo Comandas: `cargar_dieta`/`ver_dieta` son la carga por
    // paciente (tarjeta de la cama), esto es la plantilla que la autocompleta.
    module: 'Gestion Comandas', label: 'Gestión de Comandas',
    perms: [
      { code: 'ver_planificacion', label: 'Ver planificación de menú (solo lectura)' },
      { code: 'abm_planificacion', label: 'Crear / editar / eliminar planificación de menú' },
    ],
  },
  {
    module: 'Configuracion', label: 'Configuración',
    perms: [
      { code: 'abm_usuarios', label: 'ABM Usuarios' },
      { code: 'abm_roles',    label: 'ABM Roles' },
    ],
  },
  {
    module: '__cross__', label: 'Notificaciones',
    perms: [
      { code: 'notif_new_ticket',          label: 'Traslado pedido (nuevo)' },
      { code: 'notif_pre_ticket',          label: 'Pre-ticket creado (Coordinadora pidió una cama)' },
      { code: 'notif_ingreso_quirurgico',  label: 'Ingreso quirúrgico desde Sala de Espera (para Enfermería)' },
      { code: 'notif_status_update',       label: 'Actualizaciones de estado (en tránsito, en transporte, cancelado, etc.)' },
      { code: 'notif_reception_confirmed', label: 'Recepción confirmada (traslado finalizado)' },
      { code: 'notif_diet_change',         label: 'Cambio de dieta' },
      { code: 'notif_fasting_change',      label: 'Cambio de ayuno' },
      { code: 'notif_habitacion_limpia',   label: 'Habitación limpia (azafata la marcó desde el mapa)' },
      { code: 'notif_por_consolidar',      label: 'Recordatorio: 15 min "Por Consolidar" sin consolidar (para Admisión)' },
      // Pasos de la operatoria, en orden del flujo (cada uno configurable a quién le llega):
      { code: 'notif_cirugia_lista',       label: 'Cirugía · Listo para cirugía' },
      { code: 'notif_cirugia_camillero',   label: 'Cirugía · Búsqueda para cirugía' },
      { code: 'notif_cirugia_retirado',    label: 'Cirugía · En traslado a cirugía (cama libre)' },
      { code: 'notif_cirugia_en_cirugia',  label: 'Cirugía · Paciente en cirugía' },
      { code: 'notif_cirugia_volviendo',   label: 'Cirugía · Regreso de cirugía' },
      { code: 'notif_cirugia_finalizada',  label: 'Cirugía · Iniciar dieta (ya puede ir la comanda)' },
      { code: 'notif_cirugia_cama_progal', label: 'Cirugía · Cambio de cama detectado en PROGAL (fuera de la app)' },
    ],
  },
];

// Módulos que tienen solapa propia de permisos en el modal (en orden). Cada solapa muestra
// TODOS los PERMISSION_GROUPS de ese módulo, y solo aparece si el módulo está habilitado en el
// rol. Así se evita ver todos los grupos (de alturas dispares) apilados a la vez. General y
// Notificaciones son solapas fijas.
const PERM_TAB_MODULES: { key: string; label: string }[] = [
  { key: 'Operativa',       label: 'Operativa' },
  { key: 'Mapa de Camas',   label: 'Mapa de Camas' },
  { key: 'Gestion Comandas', label: 'Comandas' },
  { key: 'Configuracion',   label: 'Configuración' },
];

interface FormState {
  name: string;
  selectedModules: Set<string>;
  selectedPermissions: Set<Permission>;
  filterByFloors: boolean;
  bypassLocationCheck: boolean;
  requiresIdentification: boolean;
}

const emptyForm: FormState = { name: '', selectedModules: new Set(), selectedPermissions: new Set(), filterByFloors: false, bypassLocationCheck: false, requiresIdentification: false };

export const RoleManagementView: React.FC<RoleManagementViewProps> = ({ currentUser, onSessionRoleUpdate }) => {
  const [roles, setRoles] = useState<SPRole[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<SPRole | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SPRole | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  // Snapshot de los permisos al abrir el modal. Si el usuario desactiva un módulo
  // (lo que borra sus permisos del Set) y luego lo reactiva, restauramos los permisos
  // que tenía al abrir — evita pérdida accidental por toggle rápido.
  const [originalPermissions, setOriginalPermissions] = useState<Set<Permission>>(new Set());
  // Solapa activa del modal: '__general__' | '<módulo>' | '__cross__' (Notificaciones).
  const [activeTab, setActiveTab] = useState<string>('__general__');
  // Solo para MOSTRAR la carga inicial y su falla (DESIGN §9): el fetch sigue igual (si falla, se queda
  // con lo que había). `loading` arranca en true y se apaga una vez: las recargas después de guardar no
  // vuelven a mostrar el loader.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const authFetch = useCallback((url: string, options?: RequestInit) => {
    const token = localStorage.getItem('mediflow_token');
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options?.headers ?? {}),
      },
    });
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const r = await authFetch('/api/roles');
      if (r.ok) {
        const data = await r.json();
        setRoles(data.roles ?? []);
        setLoadError(false);
      } else setLoadError(true);
    } catch { setLoadError(true); /* silent */ }
    finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Si se desactiva el módulo cuya solapa está abierta, volver a General para no quedar en una
  // solapa fantasma.
  useEffect(() => {
    if (activeTab === '__general__' || activeTab === '__cross__') return;
    if (!form.selectedModules.has(activeTab)) setActiveTab('__general__');
  }, [activeTab, form.selectedModules]);

  const showToast = (type: 'success' | 'error', message: string) => setToast({ type, message });

  const openCreate = () => {
    setEditingRole(null);
    setForm(emptyForm);
    setOriginalPermissions(new Set());
    setActiveTab('__general__');
    setIsModalOpen(true);
  };

  const openEdit = (role: SPRole) => {
    setEditingRole(role);
    setActiveTab('__general__');
    const perms = new Set<Permission>(role.permissions ?? []);
    setForm({
      name: role.name,
      selectedModules: new Set(role.access.split('/').filter(Boolean)),
      selectedPermissions: new Set(perms),
      filterByFloors: !!role.filterByFloors,
      bypassLocationCheck: !!role.bypassLocationCheck,
      requiresIdentification: !!role.requiresIdentification,
    });
    setOriginalPermissions(perms);
    setIsModalOpen(true);
  };

  const toggleModule = (mod: string) => {
    setForm(prev => {
      const next = new Set(prev.selectedModules);
      next.has(mod) ? next.delete(mod) : next.add(mod);
      const nextPerms = new Set(prev.selectedPermissions);
      if (!next.has(mod)) {
        // Desactivar módulo → quitar sus permisos del Set.
        for (const group of PERMISSION_GROUPS) {
          if (group.module === mod) group.perms.forEach(p => nextPerms.delete(p.code));
        }
      } else {
        // Reactivar módulo → restaurar los permisos que estaban al abrir el modal,
        // para que un toggle accidental no destruya permisos irrecuperablemente.
        for (const group of PERMISSION_GROUPS) {
          if (group.module === mod) {
            group.perms.forEach(p => {
              if (originalPermissions.has(p.code)) nextPerms.add(p.code);
            });
          }
        }
      }
      return { ...prev, selectedModules: next, selectedPermissions: nextPerms };
    });
  };

  const togglePermission = (perm: Permission) => {
    setForm(prev => {
      const next = new Set(prev.selectedPermissions);
      next.has(perm) ? next.delete(perm) : next.add(perm);
      return { ...prev, selectedPermissions: next };
    });
  };

  const toggleAll = () => {
    setForm(prev => {
      const allSelected = MODULES.every(m => prev.selectedModules.has(m.value));
      return { ...prev, selectedModules: allSelected ? new Set() : new Set(MODULES.map(m => m.value)) };
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const accessStr   = Array.from(form.selectedModules).join('/');
      const permsArr    = Array.from(form.selectedPermissions);
      const body = {
        name: form.name.trim(),
        access: accessStr,
        permissions: permsArr,
        filterByFloors: form.filterByFloors,
        bypassLocationCheck: form.bypassLocationCheck,
        requiresIdentification: form.requiresIdentification,
      };
      if (editingRole) {
        const r = await authFetch('/api/roles', {
          method: 'PATCH',
          body: JSON.stringify({ spItemId: editingRole.id, ...body }),
        });
        if (r.ok) {
          showToast('success', `Rol "${form.name}" actualizado`);
          fetchRoles();
          // Si el admin editó su propio rol, refrescamos la sesión para que los módulos/
          // permisos nuevos aparezcan sin re-loguear.
          onSessionRoleUpdate?.({
            name: form.name.trim(),
            modules: Array.from(form.selectedModules) as RoleModule[],
            permissions: permsArr,
            filterByFloors: form.filterByFloors,
            bypassLocationCheck: form.bypassLocationCheck,
            requiresIdentification: form.requiresIdentification,
          });
        } else {
          showToast('error', 'Error al actualizar rol');
        }
      } else {
        const r = await authFetch('/api/roles', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (r.ok) {
          showToast('success', `Rol "${form.name}" creado`);
          fetchRoles();
        } else {
          showToast('error', 'Error al crear rol');
        }
      }
      setIsModalOpen(false);
    } catch {
      showToast('error', 'Error de conexión');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const r = await authFetch('/api/roles', {
        method: 'DELETE',
        body: JSON.stringify({ spItemId: deleteTarget.id }),
      });
      if (r.ok) {
        showToast('success', `Rol "${deleteTarget.name}" eliminado`);
        fetchRoles();
      } else {
        showToast('error', 'Error al eliminar rol');
      }
    } catch {
      showToast('error', 'Error de conexión');
    } finally {
      setSaving(false);
      setDeleteTarget(null);
    }
  };

  const filtered = roles.filter(r =>
    r.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  // Solapas del modal: General (fija) + una por módulo habilitado con permisos + Notificaciones (fija).
  const permModuleCounts = (mod: string) => {
    const all = PERMISSION_GROUPS.filter(g => g.module === mod).flatMap(g => g.perms);
    return { active: all.filter(p => form.selectedPermissions.has(p.code)).length, total: all.length };
  };
  const crossGroup = PERMISSION_GROUPS.find(g => g.module === '__cross__')!;
  const crossActive = crossGroup.perms.filter(p => form.selectedPermissions.has(p.code)).length;
  const modalTabs: { key: string; label: string; badge: string | null }[] = [
    { key: '__general__', label: 'General', badge: null },
    ...PERM_TAB_MODULES.filter(t => form.selectedModules.has(t.key)).map(t => {
      const { active, total } = permModuleCounts(t.key);
      return { key: t.key, label: t.label, badge: `${active}/${total}` };
    }),
    { key: '__cross__', label: 'Notificaciones', badge: `${crossActive}/${crossGroup.perms.length}` },
  ];
  // Grupos de permisos a mostrar en la solapa activa (vacío en General).
  const groupsForActiveTab = activeTab === '__general__'
    ? []
    : activeTab === '__cross__'
      ? [crossGroup]
      : PERMISSION_GROUPS.filter(g => g.module === activeTab);

  // ── Presentación (DESIGN §4.4 / §6 / §7) ────────────────────────────────────

  // Nombre visible del módulo (el `value` es lo que se guarda en Acceso_RT; acá solo se traduce).
  const moduloLabel = (mod: string) => MODULES.find(m => m.value === mod)?.label ?? mod;

  // Estado del rol (§3.11): el endpoint hoy trae solo los activos, pero la pill queda por si eso cambia.
  const estadoRol = (status: string): { tono: Tono; label: string } =>
    status === 'Inactivo' ? { tono: 'neutro', label: 'Inactivo' } : { tono: 'exito', label: status || 'Activo' };

  // Los 3 comportamientos del rol, con el texto de qué pasa en cada caso (el que aplica va como descripción).
  const COMPORTAMIENTOS = [
    { key: 'filterByFloors' as const, title: 'Filtrado por pisos asignados', corto: 'Filtra por pisos',
      yes: 'Solo ve traslados/camas de los pisos del usuario', no: 'Ve todo' },
    { key: 'bypassLocationCheck' as const, title: 'Acceso sin restricción de ubicación (IP/GPS)', corto: 'Sin control de ubicación',
      yes: 'Puede entrar desde cualquier red/ubicación', no: 'Debe estar en una red/ubicación autorizada' },
    { key: 'requiresIdentification' as const, title: 'Requiere identificación del operador (cuenta compartida)', corto: 'Identifica al operador',
      yes: 'Pide el nombre al entrar; queda como responsable', no: 'Las operaciones van a nombre de la cuenta' },
  ];

  // Etiqueta de permiso → título + descripción corta: el último paréntesis pasa a ser la descripción
  // ("Confirmar limpieza (Habitación Lista)" → "Confirmar limpieza" / "Habitación Lista").
  const partirEtiqueta = (label: string): { titulo: string; detalle: string | null } => {
    const m = label.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    return m && m[1] ? { titulo: m[1], detalle: m[2] } : { titulo: label, detalle: null };
  };

  const chipsModulos = (role: SPRole) => {
    const mods = role.access.split('/').filter(Boolean);
    if (mods.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {mods.map(mod => (
          <Badge key={mod} variant="outline" className="font-medium">{moduloLabel(mod)}</Badge>
        ))}
      </div>
    );
  };

  const chipsComportamiento = (role: SPRole) => {
    const activos = COMPORTAMIENTOS.filter(c => role[c.key]);
    if (activos.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {activos.map(c => <Badge key={c.key} variant="secondary" className="font-medium">{c.corto}</Badge>)}
      </div>
    );
  };

  const resumenRol = (role: SPRole) => {
    const nMods = role.access.split('/').filter(Boolean).length;
    const nPerms = (role.permissions ?? []).length;
    return `${nPerms} ${nPerms === 1 ? 'permiso' : 'permisos'} · ${nMods} ${nMods === 1 ? 'módulo' : 'módulos'}`;
  };

  // Acción de fila (DESIGN §7.6): botón-ícono ghost con tooltip; "Eliminar" con hover destructivo.
  const accionFila = (icono: React.ReactNode, label: string, onClick: () => void, peligro = false) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className={cn('text-muted-foreground', peligro ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:text-foreground')}
        >
          {icono}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  // Columnas AGRUPADAS (§7.2 "2 líneas"): nombre arriba y "N permisos · M módulos" abajo.
  const columnas: Columna<SPRole>[] = [
    {
      id: 'name',
      titulo: 'Rol',
      ordenar: (r) => r.name,
      clase: 'min-w-[160px]',
      celda: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">{resumenRol(r)}</div>
        </div>
      ),
    },
    {
      id: 'modulos',
      titulo: 'Módulos',
      clase: 'max-w-[460px] whitespace-normal',
      celda: chipsModulos,
    },
    {
      id: 'comportamiento',
      titulo: 'Comportamiento',
      ocultarEn: 'md',
      clase: 'max-w-[260px] whitespace-normal',
      celda: chipsComportamiento,
    },
    {
      id: 'estado',
      titulo: 'Estado',
      ocultarEn: 'md',
      celda: (r) => {
        const e = estadoRol(r.status);
        return <StatusBadge tono={e.tono}>{e.label}</StatusBadge>;
      },
    },
    {
      id: 'acciones',
      titulo: 'Acciones',
      alinear: 'der',
      celda: (r) => (
        <div className="flex items-center justify-end gap-1">
          {accionFila(<Pencil className="size-4" />, `Editar el rol ${r.name}`, () => openEdit(r))}
          {accionFila(<Trash2 className="size-4" />, `Eliminar el rol ${r.name}`, () => setDeleteTarget(r), true)}
        </div>
      ),
    },
  ];

  // Card mobile (§5.4b): nombre + resumen y estado arriba, módulos y comportamiento, acciones al pie.
  const tarjeta = (r: SPRole) => {
    const e = estadoRol(r.status);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium leading-tight">{r.name}</div>
            <div className="text-[10px] text-muted-foreground tabular-nums">{resumenRol(r)}</div>
          </div>
          <StatusBadge tono={e.tono} className="shrink-0">{e.label}</StatusBadge>
        </div>
        {chipsModulos(r)}
        {COMPORTAMIENTOS.some(c => r[c.key]) && chipsComportamiento(r)}
        <div className="grid grid-cols-2 gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={() => openEdit(r)}>
            <Pencil className="size-4" /> Editar
          </Button>
          <Button type="button" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteTarget(r)}>
            <Trash2 className="size-4" /> Eliminar
          </Button>
        </div>
      </div>
    );
  };

  const todosLosModulos = MODULES.every(m => form.selectedModules.has(m.value));

  return (
    <div className="flex w-full flex-col gap-4 p-3 md:p-8">
      {/* Feedback de guardado: banner flotante suave (§9.4) en la capa de toasts. */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={cn(
            "fixed inset-x-4 top-4 z-toast flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-md animate-in fade-in slide-in-from-top-2 duration-200 sm:left-auto sm:max-w-sm",
            toast.type === 'success' ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
          )}
        >
          {toast.type === 'success' ? <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="size-4 shrink-0" aria-hidden="true" />}
          {toast.message}
        </div>
      )}

      {/* HEADER + TOOLBAR (DESIGN §4.4 y §5.2), igual que Usuarios */}
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="hidden shrink-0 md:block">
          <h2 className="text-2xl font-bold tracking-tight">Roles</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{roles.length}</span> activos
            {searchFilter && <> · <span className="font-medium text-foreground tabular-nums">{filtered.length}</span> coinciden con la búsqueda</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <div className="relative min-w-[7rem] flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Buscar rol…"
              aria-label="Buscar rol por nombre"
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="h-9 pr-8 pl-8 text-sm"
            />
            {searchFilter && (
              <button type="button" onClick={() => setSearchFilter('')} aria-label="Limpiar búsqueda" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Button type="button" onClick={openCreate} className="h-9 shrink-0 gap-1.5 px-3" aria-label="Nuevo rol">
            <Plus className="size-3.5" /><span className="hidden sm:inline">Rol</span>
          </Button>
        </div>
      </div>

      {/* Falló una recarga pero hay datos: aviso suave (§9.4) arriba de la tabla, que sigue mostrando lo último. */}
      {loadError && roles.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>No pudimos actualizar la lista de roles; lo que ves puede estar desactualizado.</span>
        </div>
      )}

      {/* TABLA (desktop) + CARDS (mobile) sobre el mismo array (§4.4, §7.1), con cargando / error / vacío. */}
      <DataTable
        filas={filtered}
        columnas={columnas}
        clave={(r) => r.id}
        tarjeta={tarjeta}
        cargando={loading}
        error={loadError && roles.length === 0 ? { mensaje: 'No pudimos traer los roles. Revisá tu conexión y probá de nuevo.', onReintentar: () => { fetchRoles(); } } : undefined}
        vacio={searchFilter
          ? <Vacio icono={Search} titulo="Sin resultados" descripcion="Ningún rol coincide con la búsqueda." />
          : <Vacio icono={Settings} titulo="Todavía no hay roles" descripcion="Creá el primero con el botón Rol." />}
      />

      {/* Create/Edit Modal — solapas HORIZONTALES arriba (Tabs segmentado del kit): General + una solapa por
          módulo habilitado + Notificaciones. El panel usa el ancho completo y crece según la solapa; header y
          barra quedan fijos arriba. */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        {/* Modal canónico (DESIGN §4.1), 4xl por las solapas de permisos: header → barra de solapas fija →
            cuerpo con scroll → footer. */}
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingRole ? 'Editar rol' : 'Nuevo rol'}</DialogTitle>
            <DialogDescription>
              {form.name.trim()
                ? <span className="font-medium text-foreground">{form.name.trim()}</span>
                : 'Nombre, módulos de acceso y permisos del rol.'}
            </DialogDescription>
          </DialogHeader>

          {/* El Tabs envuelve la barra y el cuerpo: min-h-0 + flex-1 para que el DialogBody siga scrolleando. */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 flex-col gap-0">
            {/* Barra de solapas, scrolleable en X cuando hay muchos módulos. El overflow va en un contenedor
                EXTERNO para que el scrollbar quede DEBAJO del segmentado, sin tapar el texto.
                min-w-0: sin esto la fila (whitespace-nowrap) estira el modal en vez de scrollear. */}
            <div className="min-w-0 shrink-0 px-6 pt-4">
              <div className="tabs-x-scroll overflow-x-auto">
                <TabsList aria-label="Secciones del rol" className="w-max max-w-none min-w-full justify-start">
                  {modalTabs.map(tab => (
                    <TabsTrigger key={tab.key} value={tab.key} className="shrink-0 text-xs sm:text-sm">
                      {tab.label}
                      {tab.badge && (
                        <span className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] leading-none font-semibold tabular-nums",
                          tab.badge.startsWith('0/') ? "bg-muted-foreground/10 text-muted-foreground" : "bg-primary/10 text-primary"
                        )}>
                          {tab.badge}
                        </span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </div>

            {/* Panel de la solapa activa — ancho completo, scrollea solo si excede el alto */}
            <DialogBody className="pt-4">
              {/* ── General: nombre + módulos de acceso + comportamiento ── */}
              <TabsContent value="__general__" className="mt-0 space-y-5">
                <div>
                  <Label htmlFor="rol-nombre" className="mb-1 block text-xs font-medium text-muted-foreground">Nombre del rol <span className="text-destructive">*</span></Label>
                  <Input
                    id="rol-nombre"
                    required
                    placeholder="Ej: Enfermería, Catering..."
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                {/* Módulos de acceso: caja de agrupación (§6.1) con un Checkbox del kit por módulo. */}
                <div role="group" aria-labelledby="rol-modulos" className="space-y-3 rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p id="rol-modulos" className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      Módulos de acceso <span className="ml-1 font-medium tracking-normal normal-case tabular-nums">{form.selectedModules.size} de {MODULES.length}</span>
                    </p>
                    <button type="button" onClick={toggleAll} className="rounded-sm text-xs font-medium text-primary underline-offset-2 outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                      {todosLosModulos ? 'Deseleccionar todo' : 'Seleccionar todo'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {MODULES.map(mod => {
                      const selected = form.selectedModules.has(mod.value);
                      const id = `rol-mod-${mod.value.replace(/\s+/g, '-')}`;
                      return (
                        <label
                          key={mod.value}
                          htmlFor={id}
                          className={cn(
                            "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-background",
                            selected ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Checkbox id={id} checked={selected} onCheckedChange={() => toggleModule(mod.value)} />
                          {mod.label}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">Cada módulo habilitado suma su solapa de permisos arriba.</p>
                </div>

                {/* Comportamiento: los 3 interruptores del rol (Switch del kit), cada uno con lo que pasa hoy. */}
                <div role="group" aria-labelledby="rol-comportamiento" className="rounded-lg border bg-muted/20 p-4">
                  <p id="rol-comportamiento" className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Comportamiento</p>
                  <div className="divide-y">
                    {COMPORTAMIENTOS.map(t => {
                      const id = `rol-${t.key}`;
                      return (
                        <div key={t.key} className="flex items-start justify-between gap-4 py-3 last:pb-0">
                          <div className="min-w-0">
                            <label htmlFor={id} className="block cursor-pointer text-sm font-medium">{t.title}</label>
                            <p id={`${id}-ayuda`} className="mt-0.5 text-xs text-muted-foreground">{form[t.key] ? t.yes : t.no}</p>
                          </div>
                          <Switch
                            id={id}
                            aria-describedby={`${id}-ayuda`}
                            checked={form[t.key]}
                            onCheckedChange={(val) => setForm(prev => ({ ...prev, [t.key]: val }))}
                            className="mt-0.5"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </TabsContent>

              {/* ── Solapa de permisos (módulo o Notificaciones): una caja por grupo, un Checkbox por permiso ── */}
              {activeTab !== '__general__' && (
                <TabsContent value={activeTab} className="mt-0 space-y-4">
                  {groupsForActiveTab.map(group => {
                    const activeCount = group.perms.filter(p => form.selectedPermissions.has(p.code)).length;
                    return (
                      <div key={group.label} role="group" aria-label={group.label} className="space-y-2 rounded-lg border bg-muted/20 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.label}</p>
                          <span className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                            activeCount > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                          )}>
                            {activeCount}/{group.perms.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                          {group.perms.map(p => {
                            const selected = form.selectedPermissions.has(p.code);
                            const { titulo, detalle } = partirEtiqueta(p.label);
                            const id = `rol-perm-${p.code}`;
                            return (
                              <label
                                key={p.code}
                                htmlFor={id}
                                className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-background"
                              >
                                <Checkbox id={id} checked={selected} onCheckedChange={() => togglePermission(p.code)} className="mt-0.5" />
                                <span className="min-w-0">
                                  <span className="block text-sm leading-snug font-medium">{titulo}</span>
                                  {detalle && <span className="block text-xs leading-snug text-muted-foreground">{detalle}</span>}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </TabsContent>
              )}
            </DialogBody>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="min-w-[140px]"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? 'Guardando...' : editingRole ? 'Guardar cambios' : 'Crear rol'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        {/* Confirmación destructiva (DESIGN §4.2) dentro del modal canónico §4.1. */}
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar rol</DialogTitle>
            <DialogDescription>Rol <span className="font-medium text-foreground">{deleteTarget?.name}</span></DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive" aria-hidden="true">
              <Trash2 className="size-5" />
            </div>
            <p className="text-sm text-muted-foreground">
              ¿Estás seguro de que querés eliminar el rol <strong className="text-foreground">"{deleteTarget?.name}"</strong>? Los usuarios con este rol no se verán afectados.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={saving}
              className="min-w-[140px]"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
