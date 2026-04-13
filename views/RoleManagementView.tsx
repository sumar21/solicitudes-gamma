import React, { useState, useEffect, useCallback } from 'react';
import { User } from '../types';
import { Settings, Plus, Search, X, AlertCircle, CheckCircle2, Pencil, Trash2, Check } from '../components/Icons';
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
}

interface SPRole {
  id: string;
  name: string;
  access: string; // "Home/Operativa/Historial/Mapa de Camas/Configuracion"
  status: string;
}

const MODULES = [
  { label: 'Home (Monitor)', value: 'Home' },
  { label: 'Operativa', value: 'Operativa' },
  { label: 'Historial', value: 'Historial' },
  { label: 'Mapa de Camas', value: 'Mapa de Camas' },
  { label: 'Configuración', value: 'Configuracion' },
];

interface FormState {
  name: string;
  selectedModules: Set<string>;
}

const emptyForm: FormState = { name: '', selectedModules: new Set() };

export const RoleManagementView: React.FC<RoleManagementViewProps> = ({ currentUser }) => {
  const [roles, setRoles] = useState<SPRole[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<SPRole | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SPRole | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const authFetch = useCallback((url: string, options?: RequestInit) => {
    const token = sessionStorage.getItem('mediflow_token');
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
    setIsModalOpen(true);
  };

  const openEdit = (role: SPRole) => {
    setEditingRole(role);
    setForm({
      name: role.name,
      selectedModules: new Set(role.access.split('/').filter(Boolean)),
    });
    setIsModalOpen(true);
  };

  const toggleModule = (mod: string) => {
    setForm(prev => {
      const next = new Set(prev.selectedModules);
      next.has(mod) ? next.delete(mod) : next.add(mod);
      return { ...prev, selectedModules: next };
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
      const accessStr = Array.from(form.selectedModules).join('/');
      if (editingRole) {
        const r = await authFetch('/api/roles', {
          method: 'PATCH',
          body: JSON.stringify({ spItemId: editingRole.id, name: form.name.trim(), access: accessStr }),
        });
        if (r.ok) {
          showToast('success', `Rol "${form.name}" actualizado`);
          fetchRoles();
        } else {
          showToast('error', 'Error al actualizar rol');
        }
      } else {
        const r = await authFetch('/api/roles', {
          method: 'POST',
          body: JSON.stringify({ name: form.name.trim(), access: accessStr }),
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
              <TableHead className="text-right font-bold text-[9px] uppercase tracking-widest text-slate-400 pr-6 h-10">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-32 text-center text-slate-400">
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
        <DialogContent className="sm:max-w-[450px] rounded-3xl">
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
              <div className="space-y-1.5">
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
