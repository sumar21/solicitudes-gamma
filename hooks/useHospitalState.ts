
// Add React import to fix namespace error
import React, { useState, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  WorkflowType, Role, SedeType, Ticket, TicketStatus, ChatMessage, User, 
  Notification, ViewMode, SortConfig, Bed, BedStatus
} from '../types';
import { CHANNELS, INITIAL_USERS, MOCK_TICKETS, MOCK_BEDS } from '../lib/constants';

export const useHospitalState = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = sessionStorage.getItem('mediflow_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [currentView, setCurrentView] = useState<ViewMode>('HOME');
  const [activeRole, setActiveRole] = useState<Role>(Role.COORDINATOR);
  const [activeChannelId, setActiveChannelId] = useState<string>('CH-GEN');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'createdAt', direction: 'desc' });
  const [requestsSearchTerm, setRequestsSearchTerm] = useState('');
  const [isChatOpen, setChatOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [beds, setBeds] = useState<Bed[]>(MOCK_BEDS);
  const [tickets, setTickets] = useState<Ticket[]>(MOCK_TICKETS);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  // ... existing code ...

  const filteredTickets = useMemo(() => {
    let result = tickets;

    // Filter by Sede
    if (currentUser?.sede !== SedeType.SUMAR) {
      result = result.filter(t => t.sede === currentUser?.sede);
    }

    // Filter by Assigned Areas (for Hostesses)
    if (currentUser?.role === Role.HOSTESS && currentUser.assignedAreas && currentUser.assignedAreas.length > 0) {
      result = result.filter(t => {
        // Find beds for origin and destination
        const originBed = beds.find(b => b.label === t.origin);
        const destBed = t.destination ? beds.find(b => b.label === t.destination) : null;

        // Check if either origin or destination is in assigned areas
        const originInArea = originBed ? currentUser.assignedAreas?.includes(originBed.area) : false;
        const destInArea = destBed ? currentUser.assignedAreas?.includes(destBed.area) : false;

        return originInArea || destInArea;
      });
    }

    // Filter by Search
    if (requestsSearchTerm) {
      const term = requestsSearchTerm.toLowerCase();
      result = result.filter(t => 
        t.patientName.toLowerCase().includes(term) || 
        t.origin.toLowerCase().includes(term) ||
        t.destination?.toLowerCase().includes(term)
      );
    }

    // Sort
    return [...result].sort((a, b) => {
      const valA = a[sortConfig.key] || '';
      const valB = b[sortConfig.key] || '';
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [tickets, currentUser, requestsSearchTerm, sortConfig, beds]);

  const filteredChatMessages = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.sede === SedeType.SUMAR) return chatMessages;
    return chatMessages.filter(m => m.sede === currentUser.sede || m.channelId === 'CH-GEN');
  }, [chatMessages, currentUser]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = INITIAL_USERS.find(u => u.email === loginEmail);
    if (user && loginPass === '0000') {
      setCurrentUser(user);
      setActiveRole(user.role);
      sessionStorage.setItem('mediflow_user', JSON.stringify(user));
      setLoginError('');
    } else {
      setLoginError('Credenciales incorrectas (Pass: 0000)');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem('mediflow_user');
  };

  // Helper para enviar mensajes de sistema
  const sendSystemLog = (text: string, channelId: string = 'CH-COORD') => {
    if (!currentUser) return;
    const sysMsg: ChatMessage = {
      id: `SYS-${Date.now()}-${Math.random()}`,
      sender: 'Sistema MediFlow',
      role: Role.ADMIN,
      sede: currentUser.sede,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      channelId,
      isSystem: true
    };
    setChatMessages(prev => [...prev, sysMsg]);
  };

  const handleSendMessage = async (text: string) => {
    if (!currentUser) return;
    
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: currentUser.name,
      role: activeRole,
      sede: currentUser.sede,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      channelId: activeChannelId
    };

    setChatMessages(prev => [...prev, userMessage]);

    // AI Response Integration
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const activeChannel = CHANNELS.find(c => c.id === activeChannelId);
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: text,
        config: {
          systemInstruction: `Eres MediFlow AI, un asistente experto en coordinación hospitalaria. 
          Ayudas al personal (Coordinación, Admisión, Higiene, Enfermería) a gestionar traslados de pacientes.
          El usuario actual es ${currentUser.name} con el rol de ${activeRole}.
          Estás en el canal: ${activeChannel?.name} (${activeChannel?.description}).
          Responde de manera profesional, concisa y en español. Si el usuario reporta un problema, ofrece soluciones operativas.`
        }
      });

      const aiText = response.text || "Lo siento, no he podido procesar tu solicitud.";
      
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'MediFlow AI',
        role: Role.ADMIN,
        sede: SedeType.SUMAR,
        text: aiText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        channelId: activeChannelId,
        isSystem: true
      };

      setChatMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error("Gemini Chat Error:", error);
    }
  };

  const handleCreateTicket = (data: Partial<Ticket>) => {
    if (activeRole !== Role.ADMISSION && activeRole !== Role.ADMIN) {
      alert("Solo Admisión puede crear solicitudes.");
      return;
    }

    // Validation
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
      date: new Date().toISOString().split('T')[0],
      isBedClean: false,
      isReasonValidated: true,
      targetBedOriginalStatus: targetBed.status,
      itrSource: data.itrSource,
      changeReason: data.changeReason
    };

    setTickets(prev => [newTicket, ...prev]);

    // Update Bed Status immediately (Real-time)
    setBeds(prev => prev.map(b => {
      if (b.id === targetBed.id) {
        return { ...b, status: targetBed.status === BedStatus.AVAILABLE ? BedStatus.ASSIGNED : BedStatus.PREPARATION };
      }
      return b;
    }));

    sendSystemLog(`🆕 NUEVA SOLICITUD: ${newTicket.patientName} de ${newTicket.origin} a ${newTicket.destination}`);
    setCurrentView('REQUESTS');
  };

  const handleRoomReady = (ticketId: string) => {
    if (activeRole !== Role.HOSTESS && activeRole !== Role.ADMIN) {
      alert("Solo Azafatas pueden confirmar habitación lista.");
      return;
    }

    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || !ticket.destination) return;

    const targetBed = beds.find(b => b.label === ticket.destination);
    if (!targetBed) return;

    // Update Ticket
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: TicketStatus.IN_TRANSIT } : t));

    // Update Bed to ASSIGNED
    setBeds(prev => prev.map(b => b.id === targetBed.id ? { ...b, status: BedStatus.ASSIGNED } : b));

    sendSystemLog(`Habitación Lista: ${ticket.destination} para ${ticket.patientName}`);
  };

  const handleConfirmReception = (ticketId: string) => {
    if (activeRole !== Role.HOSTESS && activeRole !== Role.ADMIN) {
      alert("Solo Azafatas pueden confirmar recepción.");
      return;
    }

    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || !ticket.destination) return;

    const sourceBed = beds.find(b => b.label === ticket.origin);
    const targetBed = beds.find(b => b.label === ticket.destination);

    if (!sourceBed || !targetBed) return;

    // Update Ticket
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: TicketStatus.WAITING_CONSOLIDATION } : t));

    // Update Beds
    setBeds(prev => prev.map(b => {
      if (b.id === targetBed.id) return { ...b, status: BedStatus.OCCUPIED, patientName: ticket.patientName };
      if (b.id === sourceBed.id) return { ...b, status: BedStatus.PREPARATION, patientName: undefined };
      return b;
    }));

    sendSystemLog(`✅ RECEPCIÓN OK: ${ticket.patientName} en ${ticket.destination}. Esperando consolidación de Admisión.`);
  };

  const handleConsolidate = (ticketId: string) => {
    if (activeRole !== Role.ADMISSION && activeRole !== Role.ADMIN) {
      alert("Solo Admisión puede consolidar en PROGAL.");
      return;
    }

    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    // Update Ticket
    setTickets(prev => prev.map(t => t.id === ticketId ? { 
      ...t, 
      status: TicketStatus.COMPLETED,
      completedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } : t));

    sendSystemLog(`🏥 CONSOLIDADO EN PROGAL: Traslado de ${ticket.patientName} finalizado.`);
  };

  const handleRejectAction = (id: string, reason: string) => {
     if (activeRole !== Role.HOSTESS && activeRole !== Role.ADMIN) {
       alert("Solo Azafatas pueden rechazar solicitudes.");
       return;
     }

     if (!reason) return;
     const ticket = tickets.find(t => t.id === id);
     
     if (ticket && ticket.destination) {
        // Revert target bed status if it was assigned
        const targetBed = beds.find(b => b.label === ticket.destination);
        if (targetBed) {
           setBeds(prev => prev.map(b => {
             if (b.id === targetBed.id) {
               // Revert to original status if tracked, otherwise guess based on logic
               return { ...b, status: ticket.targetBedOriginalStatus || BedStatus.AVAILABLE };
             }
             return b;
           }));
        }
     }

     setTickets(prev => prev.map(t => 
       t.id === id 
         ? { 
             ...t, 
             status: TicketStatus.REJECTED, 
             completedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
             rejectionReason: reason
           } 
         : t
     ));
     if (ticket) {
       sendSystemLog(`❌ SOLICITUD RECHAZADA: Ticket ${ticket.id} anulado. Motivo: ${reason}`);
     }
  };

  const handleUpdateUserAreas = (areas: Area[]) => {
    if (!currentUser) return;
    const updatedUser = { ...currentUser, assignedAreas: areas };
    setCurrentUser(updatedUser);
    sessionStorage.setItem('mediflow_user', JSON.stringify(updatedUser));
  };

  return {
    state: {
      currentUser,
      currentView,
      activeRole,
      activeChannelId,
      sortConfig,
      requestsSearchTerm,
      isChatOpen,
      notifications,
      tickets,
      filteredTickets,
      chatMessages,
      filteredChatMessages,
      loginEmail,
      loginPass,
      loginError,
      beds // Export beds
    },
    actions: {
      setCurrentUser,
      setCurrentView,
      setActiveRole,
      setActiveChannelId,
      setSortConfig,
      setRequestsSearchTerm,
      setChatOpen,
      setLoginEmail,
      setLoginPass,
      handleLogin,
      handleLogout,
      handleSendMessage,
      handleCreateTicket,
      handleRoomReady,
      handleConfirmReception,
      handleConsolidate,
      handleRejectAction,
      handleUpdateUserAreas,
      // Placeholders for compatibility if needed
      handleValidateTicket: (id: string) => {},
      handleAssignBedAction: (id: string, bed: string) => {},
      handleHousekeepingAction: (id: string) => {},
      handleStartTransport: (id: string) => {},
      handleCompleteTransport: (id: string) => {},
    }
  };
};
