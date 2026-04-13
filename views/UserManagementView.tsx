
import React, { useState, useEffect, useCallback } from 'react';
import { User, Role, Area } from '../types';
import { Users, Plus, Search, X, Eye, EyeOff, AlertCircle, CheckCircle2, Pencil, Trash2 } from '../components/Icons';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { SearchableSelect } from '../components/ui/searchable-select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';

interface UserManagementViewProps {
  currentUser: User | null;
}

interface SPUser {
  id: string;
  name: string;
  email: string;
  role: string;
  sede: string;
  username: string;
  status: string;
  assignedFloors: string;
}

// Fallback roles (used until SP roles load)
const DEFAULT_ROLE_OPTIONS = [
  { label: 'Admin', value: 'Admin' },
  { label: 'Admision', value: 'Admision' },
  { label: 'Azafata', value: 'Azafata' },
  { label: 'Enfermeria', value: 'Enfermeria' },
];

// All available areas/sectors for azafata assignment
const AREA_OPTIONS: { label: string; value: string }[] = Object.values(Area).map(a => ({
  label: a,
  value: a,
}));

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  role: string;
  assignedFloors: string[];
}

const emptyForm: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  username: '',
  password: '',
  role: '',
  assignedFloors: [],
};

export const UserManagementView: React.FC<UserManagementViewProps> = ({ currentUser }) => {
  const [users, setUsers] = useState<SPUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SPUser | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<SPUser | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [roleOptions, setRoleOptions] = useState(DEFAULT_ROLE_OPTIONS);

  const token = sessionStorage.getItem('mediflow_token');

  const authFetch = useCallback(async (url: string, opts: RequestInit = {}) => {
    return fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...opts.headers,
      },
    });
  }, [token]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/users');
      if (r.ok) {
        const data = await r.json();
        setUsers(data.users ?? []);
      }
    } catch { /* keep current */ }
    finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Load roles from SP
  useEffect(() => {
    authFetch('/api/roles').then(async r => {
      if (!r.ok) return;
      const data = await r.json();
      const roles = (data.roles ?? []) as { name: string }[];
      if (roles.length > 0) {
        setRoleOptions(roles.map(r => ({ label: r.name, value: r.name })));
      }
    }).catch(() => {});
  }, [authFetch]);

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3000);
  };

  // Auto-generate username: 3 letras nombre (1ra mayus) + apellido minúscula
  const generateUsername = (first: string, last: string) => {
    const f = first.trim().replace(/\s+/g, '');
    const l = last.trim().replace(/\s+/g, '');
    if (!f) return '';
    if (!l) return f; // sin apellido, solo el nombre tal cual
    const prefix = f.slice(0, 1).toUpperCase() + f.slice(1, 3).toLowerCase();
    return prefix + l.toLowerCase();
  };

  const handleOpenCreate = () => {
    setEditingUser(null);
    setForm(emptyForm);
    setShowPassword(false);
    setModalOpen(true);
  };

  const handleOpenEdit = (user: SPUser) => {
    setEditingUser(user);
    // Put full name in firstName — user can split into apellido if they want
    setForm({
      firstName: user.name,
      lastName: '',
      email: user.email,
      username: user.username,
      password: '',
      role: user.role,
      assignedFloors: user.assignedFloors ? user.assignedFloors.split(';').filter(Boolean) : [],
    });
    setShowPassword(false);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.firstName || !form.role) return;
    const username = form.username || generateUsername(form.firstName, form.lastName);
    if (!username) return;
    if (!editingUser && !form.password) return;

    setSaving(true);
    try {
      // Build full name: "Apellido, Nombre" or just "Nombre"
      const fullName = form.lastName
        ? `${form.lastName}, ${form.firstName}`
        : form.firstName;

      const assignedFloorsStr = form.role === 'Azafata'
        ? form.assignedFloors.join(';')
        : '';

      if (editingUser) {
        const body: Record<string, string> = {
          spItemId: editingUser.id,
          name: fullName,
          firstName: form.firstName,
          email: form.email,
          role: form.role,
          username,
          assignedFloors: assignedFloorsStr,
        };
        if (form.password) body.password = form.password;

        const r = await authFetch('/api/users', { method: 'PATCH', body: JSON.stringify(body) });
        if (!r.ok) {
          const errData = await r.json().catch(() => ({}));
          throw new Error(errData.error || `Error al actualizar (${r.status})`);
        }
        showFeedback('success', `Usuario ${fullName} actualizado`);
      } else {
        const r = await authFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            name: fullName,
            firstName: form.firstName,
            email: form.email,
            username,
            password: form.password,
            role: form.role,
            assignedFloors: assignedFloorsStr,
          }),
        });
        if (!r.ok) throw new Error('Error al crear');
        showFeedback('success', `Usuario ${fullName} creado`);
      }
      setModalOpen(false);
      await fetchUsers();
    } catch (err: any) {
      showFeedback('error', err.message || 'Error al guardar');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setSaving(true);
    try {
      const r = await authFetch('/api/users', {
        method: 'DELETE',
        body: JSON.stringify({ spItemId: deleteConfirm.id }),
      });
      if (!r.ok) throw new Error('Error al desactivar');
      showFeedback('success', `Usuario ${deleteConfirm.name} desactivado`);
      setDeleteConfirm(null);
      await fetchUsers();
    } catch (err: any) {
      showFeedback('error', err.message || 'Error al desactivar');
    } finally { setSaving(false); }
  };

  // Hide the internal "Admin" (Sumar) user unless the logged-in user IS that user
  const INTERNAL_USERNAME = 'Admin';
  const visibleUsers = users.filter(u =>
    u.username === INTERNAL_USERNAME ? currentUser?.name === u.name : true
  );

  const filtered = visibleUsers.filter(u => {
    const q = searchTerm.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
  });

  const toggleFloor = (area: string) => {
    setForm(f => ({
      ...f,
      assignedFloors: f.assignedFloors.includes(area)
        ? f.assignedFloors.filter(a => a !== area)
        : [...f.assignedFloors, area],
    }));
  };

  return (
    <div className="p-2 md:p-6 animate-in slide-in-from-right-4 duration-300 max-w-full space-y-4 pb-20 md:pb-8">
      {/* Feedback toast */}
      {feedback && (
        <div className={cn(
          "fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-bold animate-in slide-in-from-top-2 duration-200",
          feedback.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        )}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {feedback.message}
        </div>
      )}

      {/* Compact filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Buscar por nombre, email o usuario..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-xs rounded-xl border-slate-200"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button onClick={handleOpenCreate} className="bg-emerald-950 hover:bg-emerald-900 shadow-md h-10 text-sm font-bold rounded-xl gap-2 px-5 ml-auto">
          <Plus className="w-4 h-4" /> Nuevo Usuario
        </Button>
      </div>

      {/* Mobile cards */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {loading ? (
          <div className="py-20 text-center">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs text-slate-400 font-bold uppercase">Cargando usuarios...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center opacity-30">
            <Users className="w-12 h-12 mx-auto mb-3" />
            <p className="text-xs font-black uppercase tracking-widest">Sin resultados</p>
          </div>
        ) : filtered.map(u => (
          <Card key={u.id} className="p-4 border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-black text-slate-600">
                  {u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="font-black text-slate-900 text-sm">{u.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono">{u.username}</div>
                </div>
              </div>
              <Badge variant="outline" className="text-[9px] font-bold uppercase">{u.role}</Badge>
            </div>
            {u.email && (
              <div className="text-[10px] text-slate-500 mb-2">{u.email}</div>
            )}
            {u.role === 'Azafata' && u.assignedFloors && (() => {
              const floors = u.assignedFloors.split(';').filter(Boolean);
              const allSelected = floors.length === AREA_OPTIONS.length;
              return (
                <div className="mb-3">
                  {allSelected
                    ? <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">Todos los sectores</Badge>
                    : <span className="text-[10px] text-slate-500">{floors.length} sectores asignados</span>
                  }
                </div>
              );
            })()}
            <div className="flex gap-2 justify-end">
              <button onClick={() => handleOpenEdit(u)} className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors" title="Editar">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => setDeleteConfirm(u)} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Desactivar">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block shadow-sm border-slate-200 overflow-hidden bg-white rounded-2xl">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/50 border-b border-slate-200">
              <TableRow>
                <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 px-6 h-10">Usuario</TableHead>
                <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Rol</TableHead>
                <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Sectores</TableHead>
                <TableHead className="font-bold text-[9px] uppercase tracking-widest text-slate-400 h-10">Login</TableHead>
                <TableHead className="text-right font-bold text-[9px] uppercase tracking-widest text-slate-400 pr-6 h-10">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-40 text-center">
                    <div className="w-8 h-8 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-xs text-slate-400 font-bold uppercase">Cargando...</p>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center opacity-20">
                      <Users className="w-12 h-12 mb-3" />
                      <p className="text-sm font-black uppercase tracking-widest">Sin resultados</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.map(u => (
                <TableRow key={u.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-100 last:border-0">
                  <TableCell className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-black text-slate-600 shadow-sm">
                        {u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 text-sm">{u.name}</div>
                        {u.email && <div className="text-[10px] text-slate-400">{u.email}</div>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wide bg-slate-50 text-slate-600 border-slate-200 rounded-lg px-3 py-1">
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.role === 'Azafata' && u.assignedFloors ? (() => {
                      const floors = u.assignedFloors.split(';').filter(Boolean);
                      const allSelected = floors.length === AREA_OPTIONS.length;
                      if (allSelected) return <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">Todos los sectores</Badge>;
                      const short = floors.map(f => f.replace('Internacion ', '').replace('Internación ', '').replace(' HPR', '').replace(' Piso', ''));
                      return (
                        <span className="text-[10px] text-slate-500" title={floors.join('\n')}>
                          {short.slice(0, 3).join(', ')}{floors.length > 3 ? ` +${floors.length - 3}` : ''}
                        </span>
                      );
                    })() : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-slate-400">{u.username}</TableCell>
                  <TableCell className="text-right pr-6">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => handleOpenEdit(u)} className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors" title="Editar">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteConfirm(u)} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Desactivar">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-[700px] rounded-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl pr-6">
              {editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {/* Row 1: Nombre, Apellido */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Nombre *</Label>
                <Input
                  required
                  placeholder="Nombre"
                  value={form.firstName}
                  onChange={e => {
                    const firstName = e.target.value;
                    setForm(f => ({ ...f, firstName, username: generateUsername(firstName, f.lastName) }));
                  }}
                  className="h-10 rounded-xl"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Apellido</Label>
                <Input
                  placeholder="Opcional"
                  value={form.lastName}
                  onChange={e => {
                    const lastName = e.target.value;
                    setForm(f => ({ ...f, lastName, username: generateUsername(f.firstName, lastName) }));
                  }}
                  className="h-10 rounded-xl"
                />
              </div>
            </div>

            {/* Row 2: Rol, Usuario, Contraseña */}
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Rol / Perfil *</Label>
                <SearchableSelect
                  value={form.role}
                  onValueChange={val => setForm(f => ({ ...f, role: val, assignedFloors: val !== 'Azafata' ? [] : f.assignedFloors }))}
                  options={roleOptions}
                  placeholder="Seleccionar rol"
                  showSearch={false}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Usuario (Login)</Label>
                <Input
                  required
                  placeholder="auto"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  className="h-10 rounded-xl bg-slate-50"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">
                  {editingUser ? 'Contraseña' : 'Contraseña *'}
                </Label>
                <div className="relative">
                  <Input
                    required={!editingUser}
                    type={showPassword ? 'text' : 'password'}
                    placeholder={editingUser ? 'Vacío = sin cambio' : '••••••••'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    className="h-10 rounded-xl pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Row 3: Email */}
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Email</Label>
              <Input
                type="email"
                placeholder="usuario@grupogamma.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="h-10 rounded-xl"
              />
            </div>

            {/* Row 4: Sectores — solo si Azafata */}
            {form.role === 'Azafata' && (
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Sectores Asignados</Label>
                    <button
                      type="button"
                      onClick={() => {
                        const allSelected = AREA_OPTIONS.every(o => form.assignedFloors.includes(o.value));
                        setForm(f => ({ ...f, assignedFloors: allSelected ? [] : AREA_OPTIONS.map(o => o.value) }));
                      }}
                      className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 transition-colors"
                    >
                      {AREA_OPTIONS.every(o => form.assignedFloors.includes(o.value)) ? 'Deseleccionar todo' : 'Seleccionar todo'}
                    </button>
                  </div>
                  <div className="border border-slate-200 rounded-xl p-2 grid grid-cols-2 gap-1.5">
                    {AREA_OPTIONS.map(opt => (
                      <label
                        key={opt.value}
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-xs",
                          form.assignedFloors.includes(opt.value)
                            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold'
                            : 'hover:bg-slate-50 text-slate-600'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={form.assignedFloors.includes(opt.value)}
                          onChange={() => toggleFloor(opt.value)}
                          className="accent-emerald-600 w-3.5 h-3.5"
                        />
                        {opt.label.replace(' HPR', '')}
                      </label>
                    ))}
                  </div>
                  {form.assignedFloors.length > 0 && (
                    <p className="text-[10px] text-slate-400 font-bold">{form.assignedFloors.length} de {AREA_OPTIONS.length} sectores</p>
                  )}
                </div>
              )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} className="rounded-xl h-10 px-6">Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.firstName || !form.role || (!editingUser && !form.password)}
              className="bg-emerald-950 text-white rounded-xl h-10 px-8 disabled:opacity-50"
            >
              {saving ? 'Guardando...' : editingUser ? 'Guardar Cambios' : 'Crear Usuario'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-[400px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg">Desactivar Usuario</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-4">
            ¿Estás seguro de que querés desactivar a <strong>{deleteConfirm?.name}</strong>?
            El usuario no podrá iniciar sesión pero se mantendrá en el historial.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="rounded-xl h-10">Cancelar</Button>
            <Button onClick={handleDelete} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white rounded-xl h-10">
              {saving ? 'Desactivando...' : 'Desactivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
