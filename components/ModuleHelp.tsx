import React, { useState, useEffect } from 'react';
import { HelpCircle, X, Bell, Lightbulb, Check, MapPin } from 'lucide-react';
import { User, Permission } from '../types';
import { can } from '../lib/permissions';
import { HELP_CONTENT } from '../lib/help-content';
import { cn } from '../lib/utils';

/**
 * Botón "?" (en el header del módulo) + panel de ayuda del módulo actual, FILTRADO por los permisos
 * del usuario con can() — la misma función que gatea los botones reales, así la ayuda nunca miente y
 * es dinámica (tildás un permiso en el ABM → aparece la acción). Responsive: sheet desde abajo en
 * mobile, modal centrado en desktop. El contenido vive en lib/help-content.ts.
 */
export const ModuleHelp: React.FC<{ moduleKey: string; user: User | null }> = ({ moduleKey, user }) => {
  const [open, setOpen] = useState(false);
  const mod = HELP_CONTENT[moduleKey];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!mod) return null;

  const fbf = !!user?.filterByFloors;
  const has = (perm: string) => perm === '*' || can(user, perm as Permission);
  const caps = mod.capabilities.filter(c => has(c.permission));
  const notifs = mod.notifications.filter(n => has(n.permission));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Ayuda de ${mod.label}`}
        aria-label={`Ayuda de ${mod.label}`}
        className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
      >
        <HelpCircle className="w-5 h-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Ayuda de ${mod.label}`}>
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] animate-in fade-in duration-150" onClick={() => setOpen(false)} />
          <div className={cn(
            'relative bg-white shadow-2xl flex flex-col help-panel-in',
            'w-full max-h-[88vh] rounded-t-3xl',
            'sm:w-[640px] sm:max-w-[92vw] sm:max-h-[85vh] sm:rounded-3xl',
          )}>
            {/* Header */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-100 flex items-start justify-between gap-3 bg-gradient-to-b from-emerald-50/70 to-white rounded-t-3xl">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Ayuda</p>
                <h2 className="text-lg font-black text-slate-900 leading-tight truncate">{mod.label}</h2>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Cerrar" className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <p className="text-sm text-slate-500 leading-relaxed">{mod.overview}</p>

              {caps.length > 0 && (
                <section>
                  <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2.5">
                    <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={3} /> Qué podés hacer
                  </h3>
                  <ul className="space-y-2">
                    {caps.map((c, i) => (
                      <li key={i} className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
                        <p className="text-sm font-bold text-slate-800 leading-snug">{c.title}</p>
                        <p className="text-[13px] text-slate-500 mt-0.5 leading-snug">{c.description}</p>
                        {c.uiLocation && (
                          <p className="text-[11px] text-slate-400 mt-1.5 flex items-start gap-1.5">
                            <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" />
                            <span><span className="font-semibold text-slate-500">Dónde:</span> {c.uiLocation}</span>
                          </p>
                        )}
                        {c.scopeNote && fbf && (
                          <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold text-sky-700 bg-sky-50 border border-sky-100 rounded-md px-1.5 py-0.5">
                            <MapPin className="w-3 h-3" /> {c.scopeNote}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {notifs.length > 0 && (
                <section>
                  <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2.5">
                    <Bell className="w-3.5 h-3.5 text-amber-600" /> Notificaciones que recibís
                  </h3>
                  <ul className="space-y-2">
                    {notifs.map((n, i) => (
                      <li key={i} className="rounded-xl border border-amber-100/70 bg-amber-50/30 px-3 py-2.5">
                        <p className="text-sm font-bold text-slate-800 leading-snug">{n.title}</p>
                        <p className="text-[13px] text-slate-500 mt-0.5 leading-snug">{n.description}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {caps.length === 0 && notifs.length === 0 && (
                <p className="text-sm text-slate-400 italic">Con tu rol, en este módulo entrás a ver; no tenés acciones ni notificaciones propias.</p>
              )}

              {mod.tips.length > 0 && (
                <section>
                  <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2.5">
                    <Lightbulb className="w-3.5 h-3.5 text-violet-500" /> Bueno saber
                  </h3>
                  <ul className="space-y-1.5">
                    {mod.tips.map((t, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-slate-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
