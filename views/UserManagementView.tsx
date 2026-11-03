
import React, { useState, useEffect, useCallback } from 'react';
import { User, Area } from '../types';
import { Users, Plus, Search, X, Eye, EyeOff, AlertCircle, CheckCircle2, Pencil } from '../components/Icons';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Combobox } from '../components/ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { DataTable, type Columna } from '../components/ui/data-table';
import { Vacio } from '../components/ui/estados';
import { StatusBadge, type Tono } from '../components/ui/status-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { Loader2, UserX } from 'lucide-react';
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

// Cada rol viene con su flag filterByFloors: si está en true, el modal pide los pisos.
interface RoleOption {
  label: string;
  value: string;
  filterByFloors: boolean;
}

// Fallback roles (used until SP roles load). Default filterByFloors=false; el server
// lo va a corregir al cargar la lista real.
const DEFAULT_ROLE_OPTIONS: RoleOption[] = [
  { label: 'Admin', value: 'Admin', filterByFloors: false },
  { label: 'Admision', value: 'Admision', filterByFloors: false },
  { label: 'Azafata', value: 'Azafata', filterByFloors: true },
  { label: 'Enfermeria', value: 'Enfermeria', filterByFloors: false },
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
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>(DEFAULT_ROLE_OPTIONS);
  // Solo para MOSTRAR la falla de carga (DESIGN §9 / convenciones §4.6): la lógica de fetch no cambia
  // (si falla, se queda con lo que había).
  const [loadError, setLoadError] = useState(false);

  // Devuelve true si el rol elegido por nombre filtra por pisos (lookup en roleOptions).
  const roleFiltersByFloors = (roleName: string): boolean => {
    return roleOptions.find(r => r.value === roleName)?.filterByFloors ?? false;
  };

  const token = localStorage.getItem('mediflow_token');

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
        setLoadError(false);
      } else setLoadError(true);
    } catch { setLoadError(true); /* keep current */ }
    finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Load roles from SP — extender con filterByFloors para condicionar el selector de pisos
  // en el modal de usuarios.
  useEffect(() => {
    authFetch('/api/roles').then(async r => {
      if (!r.ok) return;
      const data = await r.json();
      const roles = (data.roles ?? []) as { name: string; filterByFloors?: boolean }[];
      if (roles.length > 0) {
        setRoleOptions(roles.map(r => ({
          label: r.name,
          value: r.name,
          filterByFloors: !!r.filterByFloors,
        })));
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

      // Solo se guardan pisos para roles configurados con FiltrarPisos_RT=Sí.
      const assignedFloorsStr = roleFiltersByFloors(form.role)
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

  // ── Presentación (DESIGN §4.4 / §7) ─────────────────────────────────────────

  const iniciales = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // Estado del usuario (§3.11): el endpoint hoy trae solo los activos, pero la pill queda por si eso cambia.
  const estadoUsuario = (status: string): { tono: Tono; label: string } =>
    status === 'Inactivo' ? { tono: 'neutro', label: 'Inactivo' } : { tono: 'exito', label: status || 'Activo' };

  // Sectores asignados en texto corto (sin "Internación", "HPR", "Piso"); null si el rol no filtra por pisos.
  const sectoresDe = (u: SPUser): { todos: boolean; total: number; corto: string; completo: string } | null => {
    if (!roleFiltersByFloors(u.role) || !u.assignedFloors) return null;
    const floors = u.assignedFloors.split(';').filter(Boolean);
    const short = floors.map(f => f.replace('Internacion ', '').replace('Internación ', '').replace(' HPR', '').replace(' Piso', ''));
    return {
      todos: floors.length === AREA_OPTIONS.length,
      total: floors.length,
      corto: `${short.slice(0, 3).join(', ')}${floors.length > 3 ? ` +${floors.length - 3}` : ''}`,
      completo: floors.join('\n'),
    };
  };

  const celdaSectores = (u: SPUser) => {
    const s = sectoresDe(u);
    if (!s) return <span className="text-muted-foreground">—</span>;
    if (s.todos) return <Badge variant="secondary" className="font-medium">Todos los sectores</Badge>;
    return <span className="text-xs text-muted-foreground" title={s.completo}>{s.corto}</span>;
  };

  // Acción de fila (DESIGN §7.6): botón-ícono ghost con tooltip; "Desactivar" con hover destructivo.
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

  // Columnas AGRUPADAS (§7.2 "2 líneas"): nombre arriba y login · email abajo, en una sola celda.
  const columnas: Columna<SPUser>[] = [
    {
      id: 'name',
      titulo: 'Usuario',
      ordenar: (u) => u.name,
      celda: (u) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground" aria-hidden="true">
            {iniciales(u.name)}
          </span>
          <div className="min-w-0">
            <div className="font-medium">{u.name}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              <span className="font-mono">{u.username}</span>
              {u.email && u.email !== '-' && <> · {u.email}</>}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      titulo: 'Rol',
      ordenar: (u) => u.role,
      celda: (u) => <Badge variant="outline" className="font-medium">{u.role}</Badge>,
    },
    {
      id: 'sectores',
      titulo: 'Sectores',
      ocultarEn: 'md',
      clase: 'max-w-[320px] whitespace-normal',
      celda: celdaSectores,
    },
    {
      id: 'estado',
      titulo: 'Estado',
      ocultarEn: 'md',
      celda: (u) => {
        const e = estadoUsuario(u.status);
        return <StatusBadge tono={e.tono}>{e.label}</StatusBadge>;
      },
    },
    {
      id: 'acciones',
      titulo: 'Acciones',
      alinear: 'der',
      celda: (u) => (
        <div className="flex items-center justify-end gap-1">
          {accionFila(<Pencil className="size-4" />, `Editar a ${u.name}`, () => handleOpenEdit(u))}
          {accionFila(<UserX className="size-4" />, `Desactivar a ${u.name}`, () => setDeleteConfirm(u), true)}
        </div>
      ),
    },
  ];

  // Card mobile (§5.4b): identidad + rol arriba, email y sectores, acciones a lo ancho al pie.
  const tarjeta = (u: SPUser) => {
    const s = sectoresDe(u);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground" aria-hidden="true">
              {iniciales(u.name)}
            </span>
            <div className="min-w-0">
              <div className="font-medium leading-tight">{u.name}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{u.username}</div>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 font-medium">{u.role}</Badge>
        </div>
        {(u.email && u.email !== '-') || s ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            {u.email && u.email !== '-' && <p className="truncate">{u.email}</p>}
            {s && <p>{s.todos ? 'Todos los sectores' : `${s.total} sectores: ${s.corto}`}</p>}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={() => handleOpenEdit(u)}>
            <Pencil className="size-4" /> Editar
          </Button>
          <Button type="button" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteConfirm(u)}>
            <UserX className="size-4" /> Desactivar
          </Button>
        </div>
      </div>
    );
  };

  const todosLosSectores = AREA_OPTIONS.every(o => form.assignedFloors.includes(o.value));

  return (
    <div className="flex w-full flex-col gap-4 p-3 md:p-8">
      {/* Feedback de guardado: banner flotante suave (§9.4) en la capa de toasts. */}
      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={cn(
            "fixed inset-x-4 top-4 z-toast flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-md animate-in fade-in slide-in-from-top-2 duration-200 sm:left-auto sm:max-w-sm",
            feedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'
          )}
        >
          {feedback.type === 'success' ? <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="size-4 shrink-0" aria-hidden="true" />}
          {feedback.message}
        </div>
      )}

      {/* HEADER + TOOLBAR (DESIGN §4.4 y §5.2) */}
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="hidden shrink-0 md:block">
          <h2 className="text-2xl font-bold tracking-tight">Usuarios</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{visibleUsers.length}</span> activos
            {searchTerm && <> · <span className="font-medium text-foreground tabular-nums">{filtered.length}</span> coinciden con la búsqueda</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <div className="relative min-w-[7rem] flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Nombre, email o usuario…"
              aria-label="Buscar por nombre, email o usuario"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="h-9 pr-8 pl-8 text-sm"
            />
            {searchTerm && (
              <button type="button" onClick={() => setSearchTerm('')} aria-label="Limpiar búsqueda" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-hidden">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Button type="button" onClick={handleOpenCreate} className="h-9 shrink-0 gap-1.5 px-3" aria-label="Nuevo usuario">
            <Plus className="size-3.5" /><span className="hidden sm:inline">Usuario</span>
          </Button>
        </div>
      </div>

      {/* Falló una recarga pero hay datos: aviso suave (§9.4) arriba de la tabla, que sigue mostrando lo último. */}
      {loadError && users.length > 0 && !loading && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>No pudimos actualizar la lista de usuarios; lo que ves puede estar desactualizado.</span>
        </div>
      )}

      {/* TABLA (desktop) + CARDS (mobile) sobre el mismo array (§4.4, §7.1), con cargando / error / vacío. */}
      <DataTable
        filas={filtered}
        columnas={columnas}
        clave={(u) => u.id}
        tarjeta={tarjeta}
        cargando={loading && users.length === 0}
        error={loadError && users.length === 0 ? { mensaje: 'No pudimos traer los usuarios. Revisá tu conexión y probá de nuevo.', onReintentar: () => { fetchUsers(); } } : undefined}
        vacio={searchTerm
          ? <Vacio icono={Search} titulo="Sin resultados" descripcion="Probá con otro nombre, email o usuario." />
          : <Vacio icono={Users} titulo="Todavía no hay usuarios" descripcion="Creá el primero con el botón Usuario." />}
      />

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        {/* Modal de formulario canónico (DESIGN §4.1), extenso (2xl). */}
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingUser ? 'Editar usuario' : 'Nuevo usuario'}
            </DialogTitle>
            <DialogDescription>Datos de acceso, rol y sectores del usuario.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {/* Datos de la persona y de acceso en una grilla de 2 (§6.1); email y rol a lo ancho. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="usr-nombre" className="mb-1 block text-xs font-medium text-muted-foreground">Nombre <span className="text-destructive">*</span></Label>
                <Input
                  id="usr-nombre"
                  required
                  placeholder="Nombre"
                  value={form.firstName}
                  onChange={e => {
                    const firstName = e.target.value;
                    setForm(f => ({ ...f, firstName, username: generateUsername(firstName, f.lastName) }));
                  }}
                />
              </div>
              <div>
                <Label htmlFor="usr-apellido" className="mb-1 block text-xs font-medium text-muted-foreground">Apellido</Label>
                <Input
                  id="usr-apellido"
                  placeholder="Opcional"
                  value={form.lastName}
                  onChange={e => {
                    const lastName = e.target.value;
                    setForm(f => ({ ...f, lastName, username: generateUsername(f.firstName, lastName) }));
                  }}
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="usr-email" className="mb-1 block text-xs font-medium text-muted-foreground">Email</Label>
                <Input
                  id="usr-email"
                  type="email"
                  placeholder="usuario@grupogamma.com"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>

              <div className="sm:col-span-2">
                <Label className="mb-1 block text-xs font-medium text-muted-foreground">Rol / perfil <span className="text-destructive">*</span></Label>
                <Combobox obligatorio
                  value={form.role}
                  onChange={val => setForm(f => ({
                    ...f,
                    role: val,
                    // Si el nuevo rol no filtra por pisos, limpiar la selección previa.
                    assignedFloors: roleFiltersByFloors(val) ? f.assignedFloors : [],
                  }))}
                  opciones={roleOptions}
                  placeholder="Seleccionar rol"
                />
              </div>

              <div>
                <Label htmlFor="usr-login" className="mb-1 block text-xs font-medium text-muted-foreground">Usuario (login)</Label>
                <Input
                  id="usr-login"
                  required
                  placeholder="auto"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  className="font-mono"
                  aria-describedby="usr-login-ayuda"
                />
                <p id="usr-login-ayuda" className="mt-1 text-xs text-muted-foreground">Se arma solo con el nombre y el apellido.</p>
              </div>
              <div>
                <Label htmlFor="usr-password" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Contraseña {!editingUser && <span className="text-destructive">*</span>}
                </Label>
                {/* Contraseña con mostrar / ocultar (§6.8). */}
                <div className="relative">
                  <Input
                    id="usr-password"
                    required={!editingUser}
                    type={showPassword ? 'text' : 'password'}
                    placeholder={editingUser ? 'Vacío = sin cambio' : '••••••••'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute top-1/2 right-3 -translate-y-1/2 rounded-sm text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {editingUser && <p className="mt-1 text-xs text-muted-foreground">Dejala vacía para no cambiarla.</p>}
              </div>
            </div>

            {/* Sectores — visible si el rol tiene FiltrarPisos_RT=Sí. Cubre Azafata, Catering y cualquier
                rol nuevo con el flag. Caja de agrupación (§6.1) con micro-label y "Seleccionar todo". */}
            {roleFiltersByFloors(form.role) && (
              <div role="group" aria-labelledby="usr-sectores" className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p id="usr-sectores" className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Sectores asignados</p>
                  <button
                    type="button"
                    onClick={() => {
                      const allSelected = AREA_OPTIONS.every(o => form.assignedFloors.includes(o.value));
                      setForm(f => ({ ...f, assignedFloors: allSelected ? [] : AREA_OPTIONS.map(o => o.value) }));
                    }}
                    className="rounded-sm text-xs font-medium text-primary underline-offset-2 outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {todosLosSectores ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {AREA_OPTIONS.map(opt => {
                    const checked = form.assignedFloors.includes(opt.value);
                    const id = `usr-sector-${opt.value}`;
                    return (
                      <label
                        key={opt.value}
                        htmlFor={id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-background",
                          checked ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <Checkbox id={id} checked={checked} onCheckedChange={() => toggleFloor(opt.value)} />
                        {opt.label.replace(' HPR', '')}
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {form.assignedFloors.length} de {AREA_OPTIONS.length} sectores
                </p>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || !form.firstName || !form.role || (!editingUser && !form.password)}
              className="min-w-[140px]"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? 'Guardando...' : editingUser ? 'Guardar cambios' : 'Crear usuario'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        {/* Confirmación destructiva (DESIGN §4.2) dentro del modal canónico §4.1. */}
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Desactivar usuario</DialogTitle>
            <DialogDescription>Usuario <span className="font-medium text-foreground">{deleteConfirm?.name}</span></DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive" aria-hidden="true">
              <UserX className="size-5" />
            </div>
            <p className="text-sm text-muted-foreground">
              ¿Estás seguro de que querés desactivar a <strong className="text-foreground">{deleteConfirm?.name}</strong>?
              El usuario no podrá iniciar sesión pero se mantendrá en el historial.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={saving} className="min-w-[140px]">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? 'Desactivando...' : 'Desactivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
