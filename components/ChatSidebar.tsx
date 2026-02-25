
import React, { useEffect, useRef, useState } from 'react';
import { ChatMessage, Role, Channel, ChannelType } from '../types';
import { MessageSquare, X, Hash, Lock, CheckCircle2, AlertCircle, Plus, BedDouble, Activity, Info, ShieldCheck, UserCog, Send } from './Icons';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface ChatSidebarProps {
  channels: Channel[];
  activeChannelId: string;
  onChannelSelect: (id: string) => void;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onClose?: () => void;
}

const RoleColors: Record<Role, string> = {
  [Role.COORDINATOR]: 'text-blue-600',
  [Role.ADMISSION]: 'text-purple-600',
  [Role.HOUSEKEEPING]: 'text-orange-600',
  [Role.NURSING]: 'text-emerald-600',
  [Role.ADMIN]: 'text-slate-900',
};

export const ChatSidebar: React.FC<ChatSidebarProps> = ({ 
  channels, 
  activeChannelId, 
  onChannelSelect, 
  messages, 
  onSendMessage,
  onClose 
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState('');
  const activeChannel = channels.find(c => c.id === activeChannelId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChannelId]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getSystemIcon = (text: string) => {
    const t = text.toLowerCase();
    if (t.includes('solicitud')) return <Plus className="w-3.5 h-3.5 text-blue-500" />;
    if (t.includes('cama')) return <BedDouble className="w-3.5 h-3.5 text-purple-500" />;
    if (t.includes('limpia') || t.includes('lista')) return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    if (t.includes('sucia') || t.includes('urgente')) return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    if (t.includes('traslado') || t.includes('iniciando')) return <Activity className="w-3.5 h-3.5 text-amber-500" />;
    if (t.includes('rol') || t.includes('usuario')) return <UserCog className="w-3.5 h-3.5 text-indigo-500" />;
    return <Info className="w-3.5 h-3.5 text-slate-400" />;
  };

  return (
    <div className="flex flex-col md:flex-row h-full bg-white md:border-l border-zinc-800 shadow-2xl w-full md:w-[420px] shrink-0 overflow-hidden animate-in slide-in-from-right duration-300">
      
      {/* Side Navigation for Channels - Horizontal on Mobile, Sidebar on Desktop */}
      <div className="w-full md:w-44 bg-zinc-950 flex flex-col shrink-0 overflow-hidden border-b md:border-r border-zinc-900">
        <div className="h-14 md:h-16 flex items-center px-4 md:px-4 border-b border-zinc-900 shrink-0 justify-between">
          <span className="text-white font-black text-[9px] font-sans tracking-[0.2em] uppercase opacity-40">Directorio</span>
          <button onClick={onClose} className="md:hidden text-zinc-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex md:flex-col overflow-x-auto md:overflow-y-auto p-2 gap-1 no-scrollbar">
          {channels.map(ch => (
            <button
              key={ch.id}
              onClick={() => onChannelSelect(ch.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold transition-all text-left whitespace-nowrap md:mb-1 relative group shrink-0",
                activeChannelId === ch.id 
                  ? "bg-zinc-800 text-white shadow-inner" 
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
              )}
            >
              {activeChannelId === ch.id && <div className="hidden md:block absolute left-0 top-1.5 bottom-1.5 w-1 bg-blue-500 rounded-r-full" />}
              {ch.type === ChannelType.ROLE ? (
                <Lock className={cn("w-3.5 h-3.5 shrink-0", activeChannelId === ch.id ? "text-purple-400" : "opacity-30")} />
              ) : (
                <Hash className={cn("w-3.5 h-3.5 shrink-0", activeChannelId === ch.id ? "text-blue-400" : "opacity-30")} />
              )}
              <span className="truncate">{ch.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        <div className="h-14 md:h-16 bg-white flex items-center px-4 md:px-6 justify-between shrink-0 border-b border-zinc-100">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 md:w-9 md:h-9 bg-zinc-100 rounded-lg flex items-center justify-center border border-zinc-200">
               {activeChannel?.type === ChannelType.ROLE ? <Lock className="w-4 h-4 text-zinc-900" /> : <MessageSquare className="w-4 h-4 text-zinc-900" />}
             </div>
             <div className="flex flex-col min-w-0">
               <span className="text-zinc-900 font-black text-xs md:text-sm leading-tight tracking-tight truncate">{activeChannel?.name || 'Canal'}</span>
               <span className="text-zinc-400 text-[9px] md:text-[10px] font-bold leading-tight truncate">{activeChannel?.description}</span>
             </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-zinc-400 hover:text-zinc-900 h-8 w-8">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6 bg-[#fcfcfd]">
          {messages.filter(m => m.channelId === activeChannelId).length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-30 px-6 text-center">
              <div className="w-14 h-14 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
                <MessageSquare className="w-5 h-5 text-zinc-300" />
              </div>
              <p className="text-zinc-500 text-[9px] font-black uppercase tracking-[0.2em]">Sin actividad reciente</p>
            </div>
          ) : (
            messages.filter(m => m.channelId === activeChannelId).map((msg) => (
              <div 
                key={msg.id} 
                className={cn(
                  "flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300",
                  msg.isSystem ? "bg-white p-3 md:p-4 rounded-xl md:rounded-2xl border border-zinc-100 shadow-sm" : ""
                )}
              >
                {!msg.isSystem && (
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={cn("font-black text-[9px] md:text-[10px] uppercase tracking-tighter", RoleColors[msg.role])}>
                      {msg.sender}
                    </span>
                    <span className="text-[8px] md:text-[9px] font-bold text-zinc-400 tabular-nums">{msg.timestamp}</span>
                  </div>
                )}
                
                {msg.isSystem ? (
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 p-1.5 md:p-2 bg-zinc-50 rounded-lg md:rounded-xl border border-zinc-100 shrink-0 shadow-sm">
                      {getSystemIcon(msg.text)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[8px] md:text-[9px] font-black uppercase tracking-[0.15em] text-zinc-400 leading-none">
                          {msg.sender}
                        </span>
                        <span className="text-[8px] md:text-[9px] font-bold text-zinc-300 tabular-nums">
                          {msg.timestamp}
                        </span>
                      </div>
                      <p className="text-[11px] md:text-xs text-zinc-800 font-bold leading-relaxed">
                        {msg.text}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs md:text-sm text-zinc-800 font-medium leading-relaxed">
                    {msg.text}
                  </p>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 md:p-4 border-t border-zinc-100 shrink-0 bg-white pb-safe">
          <div className="border border-zinc-200 rounded-xl md:rounded-2xl px-3 md:px-5 py-3 md:py-4 bg-zinc-50 flex items-center gap-3 md:gap-4 transition-all focus-within:ring-2 focus-within:ring-zinc-900 focus-within:bg-white group shadow-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse border border-white shadow-sm shrink-0"></div>
            <input 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Mensaje..." 
              className="flex-1 text-xs md:text-[11px] font-bold outline-none bg-transparent text-zinc-900 placeholder:text-zinc-300"
            />
            <Button variant="ghost" size="icon" onClick={handleSend} className="h-8 w-8 text-zinc-400 hover:text-zinc-950">
               <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
