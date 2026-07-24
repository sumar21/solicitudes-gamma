import React, { useState, useEffect, useCallback } from 'react';
import { User, Permission, RoleModule, MEAL_SLOTS, mealSlotPermission } from '../types';
import { Settings, Plus, Search, X, AlertCircle, CheckCircle2, Pencil, Trash2, Check, ChevronUp, ChevronDown } from '../components/Icons';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';

interface RoleManagementViewProps {
  currentUser: User | null;
  // Refresca la sesión en caliente si el admin edita su propio rol (no-op si es otro rol).
  onSessionRoleUpdate?: (role: {
    name: string; modules: RoleModule[]; permissions: Permission[];
    filterByFloors: boolean; bypassLocationCheck: boolean;
  }) => void;
}

interface SPRole {
  id: string;
  name: string;
  access: string; // "Home/Operativa/Historial/Mapa de Camas/Configuracion"
  permissions: Permission[];
  filterByFloors: boolean;
  bypassLocationCheck: boolean;
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
      { code: 'asignar_cama',        label: 'Asignar cama destino' },
      { code: 'confirmar_limpieza',  label: 'Confirmar limpieza (Habitación Lista)' },
      { code: 'iniciar_traslado',    label: 'Iniciar traslado' },
      { code: 'confirmar_recepcion', label: 'Confirmar recepción' },
      { code: 'consolidar',          label: 'Consolidar PROGAL' },
      // Vive en Operativa desde que Limpiezas pasó a ser una solapa de este módulo. Antes
      // estaba bajo 'Gestion Limpieza', y como un grupo solo se renderiza si su módulo está
      // tildado, era IMPOSIBLE darle este permiso a un rol con Operativa pero sin Limpieza.
      { code: 'consolidar_limpieza', label: 'Consolidar limpieza (solapa Limpiezas)' },
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
      ...MEAL_SLOTS.map(({ slot, label }) => ({ code: mealSlotPermission(slot), label: `Cargar comandas — solo ${label}` })),
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
      { code: 'notif_status_update',       label: 'Actualizaciones de estado (en tránsito, en transporte, cancelado, etc.)' },
      { code: 'notif_reception_confirmed', label: 'Recepción confirmada (traslado finalizado)' },
      { code: 'notif_diet_change',         label: 'Cambio de dieta' },
      { code: 'notif_fasting_change',      label: 'Cambio de ayuno' },
      { code: 'notif_habitacion_limpia',   label: 'Habitación limpia (azafata la marcó desde el mapa)' },
    ],
  },
];

interface FormState {
  name: string;
  selectedModules: Set<string>;
  selectedPermissions: Set<Permission>;
  filterByFloors: boolean;
  bypassLocationCheck: boolean;
}

const emptyForm: FormState = { name: '', selectedModules: new Set(), selectedPermissions: new Set(), filterByFloors: false, bypassLocationCheck: false };

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
  // Qué grupos de permisos están desplegados en el modal (key = group.label).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroupExpanded = (label: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

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
      }
    } catch { /* silent */ }
  }, [authFetch]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const showToast = (type: 'success' | 'error', message: string) => setToast({ type, message });

  const openCreate = () => {
    setEditingRole(null);
    setForm(emptyForm);
    setOriginalPermissions(new Set());
    setExpandedGroups(new Set());
    setIsModalOpen(true);
  };

  const openEdit = (role: SPRole) => {
    setEditingRole(role);
    const perms = new Set<Permission>(role.permissions ?? []);
    setForm({
      name: role.name,
      selectedModules: new Set(role.access.split('/').filter(Boolean)),
      selectedPermissions: new Set(perms),
      filterByFloors: !!role.filterByFloors,
      bypassLocationCheck: !!role.bypassLocationCheck,
    });
    setOriginalPermissions(perms);
    setExpandedGroups(new Set());
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

  return (
    <div className="p-4 md:p-8 animate-in slide-in-from-right-4 duration-300 max-w-full space-y-4 md:space-y-5 pb-24 md:pb-8">
      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-bold animate-in slide-in-from-top-2 duration-200",
          toast.type === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
        )}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {/* Filter bar — same style as UserManagementView */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Buscar rol..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className="pl-9 h-9 text-xs rounded-xl border-slate-200"
          />
          {searchFilter && (
            <button onClick={() => setSearchFilter('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button onClick={openCreate} className="bg-emerald-950 hover:bg-emerald-900 shadow-md h-9 text-sm font-bold rounded-xl gap-2 px-5 ml-auto">
          <Plus className="w-4 h-4" /> Nuevo Rol
        </Button>
      </div>

      {/* Mobile cards */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {filtered.length === 0 ? (
          <div className="py-20 text-center opacity-30">
            <Settings className="w-12 h-12 mx-auto mb-3" />
            <p className="text-xs font-black uppercase tracking-widest">Sin roles</p>
          </div>
        ) : filtered.map(role => (
          <Card key={role.id} className="p-4 border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-100 border border-indigo-200 flex items-center justify-center text-[10px] font-black text-indigo-600">
                  {role.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="font-black text-slate-900 text-sm">{role.name}</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEdit(role)} className="p-1.5 rounded-lg hover:bg-slate-100"><Pencil className="w-3.5 h-3.5 text-slate-400" /></button>
                <button onClick={() => setDeleteTarget(role)} className="p-1.5 rounded-lg hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 text-slate-400" /></button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {role.access.split('/').filter(Boolean).map(mod => (
                <Badge key={mod} variant="outline" className="text-[8px] font-bold uppercase bg-slate-50 text-slate-600 border-slate-200">{mod}</Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              <Badge variant="outline" className="text-[8px] font-bold uppercase bg-indigo-50 text-indigo-700 border-indigo-200">
                {(role.permissions ?? []).length} permisos
              </Badge>
              {role.filterByFloors && (
                <Badge variant="outline" className="text-[8px] font-bold uppercase bg-amber-50 text-amber-700 border-amber-200">
                  Filtra pisos
                </Badge>
              )}
              {role.bypassLocationCheck && (
                <Badge variant="outline" className="text-[8px] font-bold uppercase bg-sky-50 text-sky-700 border-sky-200">
                  Sin ubicación
                </Badge>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
        <Table>
          <TableHeader className="bg-slate-50/50 border-b border-slate-200">
            <TableRow>
              <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 px-6 h-10">Rol</TableHead>
              <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Módulos</TableHead>
              <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Permisos</TableHead>
              <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Filtra pisos</TableHead>
              <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Sin ubicación</TableHead>
              <TableHead className="text-right font-bold text-[9px] uppercase tracking-widest text-slate-400 pr-6 h-10">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-slate-400">
                  <p className="text-sm font-bold">Sin roles</p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(role => (
                <TableRow key={role.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-100 last:border-0">
                  <TableCell className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-black text-slate-600 shadow-sm">
                        {role.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="font-bold text-slate-900 text-sm">{role.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {role.access.split('/').filter(Boolean).map(mod => (
                        <Badge key={mod} variant="outline" className="text-[10px] font-bold uppercase tracking-wide bg-slate-50 text-slate-600 border-slate-200 rounded-lg px-3 py-1">
                          {mod}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700 border-indigo-200 rounded-lg px-3 py-1">
                      {(role.permissions ?? []).length}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {role.filterByFloors ? (
                      <Badge variant="outline" className="text-[10px] font-bold uppercase bg-amber-50 text-amber-700 border-amber-200 rounded-lg px-3 py-1">Sí</Badge>
                    ) : (
                      <span className="text-[10px] font-bold uppercase text-slate-400">No</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {role.bypassLocationCheck ? (
                      <Badge variant="outline" className="text-[10px] font-bold uppercase bg-sky-50 text-sky-700 border-sky-200 rounded-lg px-3 py-1">Sí</Badge>
                    ) : (
                      <span className="text-[10px] font-bold uppercase text-slate-400">No</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(role)} className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors" title="Editar">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteTarget(role)} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Eliminar">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Create/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[680px] rounded-3xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">{editingRole ? 'Editar Rol' : 'Nuevo Rol'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Nombre del Rol</Label>
              <Input
                placeholder="Ej: Enfermería, Catering..."
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="h-10 rounded-xl"
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Módulos de Acceso</Label>
                <button onClick={toggleAll} className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700">
                  {MODULES.every(m => form.selectedModules.has(m.value)) ? 'Deseleccionar todo' : 'Seleccionar todo'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {MODULES.map(mod => {
                  const selected = form.selectedModules.has(mod.value);
                  return (
                    <label
                      key={mod.value}
                      className={cn(
                        "flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all",
                        selected ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-100 hover:border-slate-200"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                        selected ? "bg-emerald-600 border-emerald-600" : "border-slate-300 bg-white"
                      )}>
                        {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                      </div>
                      <span className={cn(
                        "text-sm font-medium",
                        selected ? "text-emerald-700" : "text-slate-700"
                      )}>
                        {mod.label}
                      </span>
                      <input type="checkbox" className="sr-only" checked={selected} onChange={() => toggleModule(mod.value)} />
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Permisos de acciones agrupados por módulo, colapsables. Cada grupo solo
                aparece si su módulo de acceso está habilitado (excepto "Notificaciones",
                que es cross-module). El header muestra "N/total" para feedback rápido. */}
            <div className="grid gap-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Permisos de Acciones</Label>
              <div className="columns-2 gap-2 [&>div]:mb-2 [&>div]:break-inside-avoid">
                {PERMISSION_GROUPS.map(group => {
                  const moduleEnabled = group.module === '__cross__' || form.selectedModules.has(group.module);
                  if (!moduleEnabled) return null;
                  const isOpen = expandedGroups.has(group.label);
                  const activeCount = group.perms.filter(p => form.selectedPermissions.has(p.code)).length;
                  return (
                    <div key={group.label} className="border border-slate-100 rounded-xl bg-slate-50/40 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleGroupExpanded(group.label)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-100/60 transition-colors"
                      >
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">{group.label}</span>
                        <span className="flex items-center gap-2">
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full",
                            activeCount > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                          )}>
                            {activeCount}/{group.perms.length}
                          </span>
                          {isOpen
                            ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                            : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 space-y-1">
                          {group.perms.map(p => {
                            const selected = form.selectedPermissions.has(p.code);
                            return (
                              <label
                                key={p.code}
                                className={cn(
                                  "flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer transition-all",
                                  selected ? "bg-emerald-50" : "hover:bg-white"
                                )}
                              >
                                <div className={cn(
                                  "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                                  selected ? "bg-emerald-600 border-emerald-600" : "border-slate-300 bg-white"
                                )}>
                                  {selected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                                </div>
                                <span className={cn(
                                  "text-xs",
                                  selected ? "text-emerald-700 font-bold" : "text-slate-700"
                                )}>{p.label}</span>
                                <input type="checkbox" className="sr-only" checked={selected} onChange={() => togglePermission(p.code)} />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Los dos toggles en 2 columnas para acortar el modal. */}
            <div className="grid grid-cols-2 gap-4">
            {/* Toggle FiltraPisos. Si está activo, los usuarios con este rol arrancan
                filtrados por sus pisos asignados (Azafata, Catering, etc.). */}
            <div className="grid gap-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Filtrado por pisos asignados</Label>
              <div className="grid grid-cols-2 gap-2">
                {[{ val: true, label: 'Sí', sub: 'Solo ve traslados/camas de los pisos del usuario' },
                  { val: false, label: 'No', sub: 'Ve todo' }
                 ].map(opt => {
                   const selected = form.filterByFloors === opt.val;
                   return (
                     <button
                       key={String(opt.val)}
                       type="button"
                       onClick={() => setForm(prev => ({ ...prev, filterByFloors: opt.val }))}
                       className={cn(
                         "p-3 rounded-xl border text-left transition-all",
                         selected ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200 hover:border-slate-300"
                       )}
                     >
                       <div className={cn("text-sm font-black mb-0.5", selected ? "text-emerald-700" : "text-slate-700")}>{opt.label}</div>
                       <div className="text-[9px] text-slate-500 leading-tight">{opt.sub}</div>
                     </button>
                   );
                 })}
              </div>
            </div>

            {/* Toggle BypassUbicacion. Si está activo, los usuarios de este rol entran
                sin validación de IP/GPS (no hace falta estar en el HPR). */}
            <div className="grid gap-2">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Acceso sin restricción de ubicación (IP/GPS)</Label>
              <div className="grid grid-cols-2 gap-2">
                {[{ val: true, label: 'Sí', sub: 'Puede entrar desde cualquier red/ubicación' },
                  { val: false, label: 'No', sub: 'Debe estar en una red/ubicación autorizada' }
                 ].map(opt => {
                   const selected = form.bypassLocationCheck === opt.val;
                   return (
                     <button
                       key={String(opt.val)}
                       type="button"
                       onClick={() => setForm(prev => ({ ...prev, bypassLocationCheck: opt.val }))}
                       className={cn(
                         "p-3 rounded-xl border text-left transition-all",
                         selected ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200 hover:border-slate-300"
                       )}
                     >
                       <div className={cn("text-sm font-black mb-0.5", selected ? "text-emerald-700" : "text-slate-700")}>{opt.label}</div>
                       <div className="text-[9px] text-slate-500 leading-tight">{opt.sub}</div>
                     </button>
                   );
                 })}
              </div>
            </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsModalOpen(false)} className="rounded-xl h-10">Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="bg-emerald-950 text-white rounded-xl h-10 px-6"
            >
              {saving ? 'Guardando...' : editingRole ? 'Guardar Cambios' : 'Crear Rol'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[400px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl text-red-600 flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> Eliminar Rol
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-2">
            ¿Estás seguro de que querés eliminar el rol <strong>"{deleteTarget?.name}"</strong>? Los usuarios con este rol no se verán afectados.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="rounded-xl h-10">Cancelar</Button>
            <Button
              onClick={handleDelete}
              disabled={saving}
              className="bg-red-600 hover:bg-red-700 text-white rounded-xl h-10 px-6"
            >
              {saving ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
