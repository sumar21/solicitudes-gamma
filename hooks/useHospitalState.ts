
import React, { useState, useMemo, useEffect } from 'react';
import {
  WorkflowType, Role, SedeType, Ticket, TicketStatus, User, Area,
  Notification, NotificationType, ViewMode, SortConfig, Bed, BedStatus
} from '../types';
import { INITIAL_USERS, MOCK_TICKETS, MOCK_BEDS } from '../lib/constants';

export const useHospitalState = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = sessionStorage.getItem('mediflow_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [currentView, setCurrentView] = useState<ViewMode>(() => {
    const saved = sessionStorage.getItem('mediflow_user');
    if (saved) {
      const user = JSON.parse(saved);
      if (user.role === Role.HOSTESS) return 'REQUESTS';
    }
    return 'HOME';
  });
  const [activeRole, setActiveRole] = useState<Role>(() => {
    const saved = sessionStorage.getItem('mediflow_user');
    if (saved) {
      const user = JSON.parse(saved);
      return user.role;
    }
    return Role.ADMISSION;
  });
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'createdAt', direction: 'desc' });
  const [requestsSearchTerm, setRequestsSearchTerm] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [beds, setBeds] = useState<Bed[]>(MOCK_BEDS);
  const [tickets, setTickets] = useState<Ticket[]>(MOCK_TICKETS);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [bedsLoading, setBedsLoading] = useState(false);

  // Fetch real bed map from the Vercel API route on mount.
  // Falls back silently to mock data if the endpoint is unavailable (e.g. local dev).
  useEffect(() => {
    setBedsLoading(true);
    fetch('/api/beds')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { beds: Bed[] }) => {
        if (Array.isArray(data.beds) && data.beds.length > 0) {
          setBeds(data.beds);
        }
      })
      .catch(() => { /* keep mock data */ })
      .finally(() => setBedsLoading(false));
  }, []);

  const filteredNotifications = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role !== Role.HOSTESS) return notifications;

    return notifications.filter(n => {
      const isOrigin = n.originArea && currentUser.assignedAreas?.includes(n.originArea);
      const isDest = n.destinationArea && currentUser.assignedAreas?.includes(n.destinationArea);
      return isOrigin || isDest;
    });
  }, [notifications, currentUser]);

  const filteredTickets = useMemo(() => {
    let result = tickets;

    if (currentUser?.sede !== SedeType.SUMAR) {
      result = result.filter(t => t.sede === currentUser?.sede);
    }

    if (currentUser?.role === Role.HOSTESS && currentUser.assignedAreas && currentUser.assignedAreas.length > 0) {
      result = result.filter(t => {
        const originBed = beds.find(b => b.label === t.origin);
        const destBed = t.destination ? beds.find(b => b.label === t.destination) : null;
        const originInArea = originBed ? currentUser.assignedAreas?.includes(originBed.area) : false;
        const destInArea = destBed ? currentUser.assignedAreas?.includes(destBed.area) : false;
        return originInArea || destInArea;
      });
    }

    if (requestsSearchTerm) {
      const term = requestsSearchTerm.toLowerCase();
      result = result.filter(t =>
        t.patientName.toLowerCase().includes(term) ||
        t.origin.toLowerCase().includes(term) ||
        t.destination?.toLowerCase().includes(term)
      );
    }

    return [...result].sort((a, b) => {
      const valA = a[sortConfig.key] || '';
      const valB = b[sortConfig.key] || '';
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [tickets, currentUser, requestsSearchTerm, sortConfig, beds]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = INITIAL_USERS.find(u => u.email === loginEmail);
    if (user && loginPass === '1234') {
      setCurrentUser(user);
      setActiveRole(user.role);
      if (user.role === Role.HOSTESS) {
        setCurrentView('REQUESTS');
      } else {
        setCurrentView('HOME');
      }
      sessionStorage.setItem('mediflow_user', JSON.stringify(user));
      setLoginError('');
    } else {
      setLoginError('Credenciales incorrectas (Pass: 1234)');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem('mediflow_user');
  };

  const handleCreateTicket = (data: Partial<Ticket>) => {
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) {
      alert("Solo Admisión o Admin pueden crear solicitudes.");
      return;
    }

    const sourceBed = beds.find(b => b.label === data.origin);
    const targetBed = beds.find(b => b.label === data.destination);

    if (!sourceBed || sourceBed.status !== BedStatus.OCCUPIED) {
      alert("Error: La cama de origen debe estar OCUPADA.");
      return;
    }

    if (!targetBed || (targetBed.status !== BedStatus.AVAILABLE && targetBed.status !== BedStatus.PREPARATION)) {
      alert("Error: La cama de destino debe estar DISPONIBLE o EN PREPARACIÓN.");
      return;
    }

    const newTicket: Ticket = {
      id: `TKT-${Date.now()}`,
      sede: currentUser?.sede || SedeType.HPR,
      patientName: data.patientName || sourceBed.patientName || 'Paciente',
      origin: data.origin!,
      destination: data.destination!,
      workflow: WorkflowType.INTERNAL,
      status: targetBed.status === BedStatus.AVAILABLE ? TicketStatus.IN_TRANSIT : TicketStatus.WAITING_ROOM,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      bedAssignedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toISOString().split('T')[0],
      isBedClean: false,
      isReasonValidated: true,
      targetBedOriginalStatus: targetBed.status,
      itrSource: data.itrSource,
      changeReason: data.changeReason,
      observations: data.observations,
    };

    setTickets(prev => [newTicket, ...prev]);

    setBeds(prev => prev.map(b => {
      if (b.id === targetBed.id) {
        return { ...b, status: targetBed.status === BedStatus.AVAILABLE ? BedStatus.ASSIGNED : BedStatus.PREPARATION };
      }
      return b;
    }));

    const isPrep = targetBed.status === BedStatus.PREPARATION;
    const newNotification: Notification = {
      id: `NOTIF-${Date.now()}`,
      type: NotificationType.NEW_TICKET,
      title: isPrep ? 'Traslado en Preparación' : 'Solicitud de Traslado',
      message: isPrep
        ? `${newTicket.patientName}: Origen ${newTicket.origin} -> Destino ${newTicket.destination} (En Preparación)`
        : `Confirmar disponibilidad de ${newTicket.destination} para ${newTicket.patientName}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: false,
      ticketId: newTicket.id,
      sede: newTicket.sede,
      originArea: sourceBed.area,
      destinationArea: targetBed.area,
    };
    setNotifications(prev => [newNotification, ...prev]);
    setCurrentView('REQUESTS');
  };

  const handleRoomReady = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || !ticket.destination) return;

    const targetBed = beds.find(b => b.label === ticket.destination);
    if (!targetBed) return;

    setTickets(prev => prev.map(t => t.id === ticketId ? {
      ...t,
      status: TicketStatus.IN_TRANSIT,
      cleaningDoneAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    } : t));

    setBeds(prev => prev.map(b => b.id === targetBed.id ? { ...b, status: BedStatus.ASSIGNED } : b));

    const sourceBed = beds.find(b => b.label === ticket.origin);
    const newNotification: Notification = {
      id: `NOTIF-${Date.now()}`,
      type: NotificationType.STATUS_UPDATE,
      title: 'Habitación Lista',
      message: `La habitación ${ticket.destination} está lista. ${ticket.patientName} puede ser trasladado desde ${ticket.origin}.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: false,
      ticketId: ticket.id,
      sede: ticket.sede,
      originArea: sourceBed?.area,
      destinationArea: targetBed.area,
    };
    setNotifications(prev => [newNotification, ...prev]);
  };

  const handleConfirmReception = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || !ticket.destination) return;

    if (ticket.status !== TicketStatus.IN_TRANSPORT && ticket.status !== TicketStatus.IN_TRANSIT) return;

    const sourceBed = beds.find(b => b.label === ticket.origin);
    const targetBed = beds.find(b => b.label === ticket.destination);
    if (!sourceBed || !targetBed) return;

    setTickets(prev => prev.map(t => t.id === ticketId ? {
      ...t,
      status: TicketStatus.WAITING_CONSOLIDATION,
      receptionConfirmedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    } : t));

    setBeds(prev => prev.map(b => {
      if (b.id === targetBed.id) return { ...b, status: BedStatus.OCCUPIED, patientName: ticket.patientName };
      if (b.id === sourceBed.id) return { ...b, status: BedStatus.PREPARATION, patientName: undefined };
      return b;
    }));

    const newNotification: Notification = {
      id: `NOTIF-${Date.now()}`,
      type: NotificationType.STATUS_UPDATE,
      title: 'Recepción Confirmada',
      message: `El paciente ${ticket.patientName} ha sido recibido en ${ticket.destination}. Pendiente consolidar en PROGAL.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: false,
      ticketId: ticket.id,
      sede: ticket.sede,
      originArea: sourceBed.area,
      destinationArea: targetBed.area,
    };
    setNotifications(prev => [newNotification, ...prev]);
  };

  const handleConsolidate = (ticketId: string) => {
    if (currentUser?.role !== Role.ADMISSION && currentUser?.role !== Role.ADMIN) {
      alert("Solo Admisión o Admin pueden consolidar en PROGAL.");
      return;
    }

    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    setTickets(prev => prev.map(t => t.id === ticketId ? {
      ...t,
      status: TicketStatus.COMPLETED,
      completedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    } : t));

    const sourceBed = beds.find(b => b.label === ticket.origin);
    const targetBed = beds.find(b => b.label === ticket.destination);
    const newNotification: Notification = {
      id: `NOTIF-${Date.now()}`,
      type: NotificationType.STATUS_UPDATE,
      title: 'Traslado Finalizado',
      message: `El traslado de ${ticket.patientName} ha sido consolidado en PROGAL.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: false,
      ticketId: ticket.id,
      sede: ticket.sede,
      originArea: sourceBed?.area,
      destinationArea: targetBed?.area,
    };
    setNotifications(prev => [newNotification, ...prev]);
  };

  const handleStartTransport = (ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    setTickets(prev => prev.map(t => t.id === ticketId ? {
      ...t,
      status: TicketStatus.IN_TRANSPORT,
      transportStartedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    } : t));

    const sourceBed = beds.find(b => b.label === ticket.origin);
    const targetBed = beds.find(b => b.label === ticket.destination);
    const newNotification: Notification = {
      id: `NOTIF-${Date.now()}`,
      type: NotificationType.STATUS_UPDATE,
      title: 'Traslado en Curso',
      message: `${ticket.patientName} está en camino hacia ${ticket.destination}.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: false,
      ticketId: ticket.id,
      sede: ticket.sede,
      originArea: sourceBed?.area,
      destinationArea: targetBed?.area,
    };
    setNotifications(prev => [newNotification, ...prev]);
  };

  const handleUpdateUserAreas = (areas: Area[]) => {
    if (!currentUser) return;
    const updatedUser = { ...currentUser, assignedAreas: areas };
    setCurrentUser(updatedUser);
    sessionStorage.setItem('mediflow_user', JSON.stringify(updatedUser));
  };

  const handleMarkNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const handleMarkAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  return {
    state: {
      currentUser,
      currentView,
      activeRole,
      sortConfig,
      requestsSearchTerm,
      notifications,
      filteredNotifications,
      tickets,
      filteredTickets,
      loginEmail,
      loginPass,
      loginError,
      bedsLoading,
      beds,
    },
    actions: {
      setCurrentUser,
      setCurrentView,
      setActiveRole,
      setSortConfig,
      setRequestsSearchTerm,
      setLoginEmail,
      setLoginPass,
      handleLogin,
      handleLogout,
      handleCreateTicket,
      handleRoomReady,
      handleConfirmReception,
      handleConsolidate,
      handleUpdateUserAreas,
      handleMarkNotificationRead,
      handleMarkAllNotificationsRead,
      handleValidateTicket: (_id: string) => { },
      handleAssignBedAction: (_id: string, _bed: string) => { },
      handleHousekeepingAction: (_id: string) => { },
      handleStartTransport,
      handleCompleteTransport: (_id: string) => { },
    },
  };
};
