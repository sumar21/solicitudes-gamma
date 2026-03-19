
import React from 'react';
import { User, Role } from '../types';
import { UserCog, Plus, Settings, ShieldCheck } from '../components/Icons';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select';

interface UserManagementViewProps {
  users: User[];
  onUpdateUserRole: (userId: string, newRole: Role) => void;
}

const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Administrador',
  [Role.COORDINATOR]: 'Coordinador',
  [Role.ADMISSION]: 'Admisión',
  [Role.HOUSEKEEPING]: 'Higiene',
  [Role.NURSING]: 'Enfermería',
  [Role.HOSTESS]: 'Azafata',
  [Role.READ_ONLY]: 'Solo Lectura',
};

export const UserManagementView: React.FC<UserManagementViewProps> = ({ users, onUpdateUserRole }) => {
  return (
    <div className="p-4 md:p-8 animate-in slide-in-from-right-4 duration-300 max-w-full">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg"><UserCog className="w-6 h-6" /></div>
          <div><h2 className="text-2xl font-bold text-slate-800">Gestión de Usuarios</h2><p className="text-sm text-slate-500 font-medium">Asigna roles y permisos granulares</p></div>
        </div>
        <Button className="bg-slate-900 hover:bg-slate-800 shadow-md"><Plus className="w-4 h-4 mr-2" /> Nuevo Usuario</Button>
      </div>

      <Card className="shadow-sm border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50 border-b border-slate-200">
              <TableRow>
                <TableHead className="w-[300px]">Usuario</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol Asignado</TableHead>
                <TableHead>Último Acceso</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id} className="hover:bg-slate-50/50 transition-colors">
                  <TableCell><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 shadow-sm">{user.avatar}</div><div><div className="font-semibold text-slate-900">{user.name}</div><div className="text-[10px] font-mono text-slate-400">{user.id}</div></div></div></TableCell>
                  <TableCell className="text-sm text-slate-600">{user.email}</TableCell>
                  <TableCell><Select value={user.role} onValueChange={(val) => onUpdateUserRole(user.id, val as Role)}><SelectTrigger className="w-[160px] h-8 text-xs bg-white border-slate-200 font-medium"><SelectValue placeholder={ROLE_LABELS[user.role]} /></SelectTrigger><SelectContent><SelectItem value={Role.ADMIN}>{ROLE_LABELS[Role.ADMIN]}</SelectItem><SelectItem value={Role.COORDINATOR}>{ROLE_LABELS[Role.COORDINATOR]}</SelectItem><SelectItem value={Role.ADMISSION}>{ROLE_LABELS[Role.ADMISSION]}</SelectItem><SelectItem value={Role.HOUSEKEEPING}>{ROLE_LABELS[Role.HOUSEKEEPING]}</SelectItem><SelectItem value={Role.NURSING}>{ROLE_LABELS[Role.NURSING]}</SelectItem></SelectContent></Select></TableCell>
                  <TableCell className="text-xs text-slate-500">{user.lastLogin}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-900"><Settings className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};
