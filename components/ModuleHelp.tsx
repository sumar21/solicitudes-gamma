import React, { useState } from 'react';
import { HelpCircle, Bell, Lightbulb, Check, MapPin } from 'lucide-react';
import { User, Permission } from '../types';
import { can } from '../lib/permissions';
import { HELP_CONTENT } from '../lib/help-content';
import { Button } from './ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/**
 * Botón "?" (en el header del módulo) + panel de ayuda del módulo actual, FILTRADO por los permisos
 * del usuario con can() — la misma función que gatea los botones reales, así la ayuda nunca miente y
 * es dinámica (tildás un permiso en el ABM → aparece la acción). Responsive: sheet desde abajo en
 * mobile, modal centrado en desktop. El contenido vive en lib/help-content.ts.
 *
 * Va sobre el Dialog del kit (Escape, foco atrapado, fondo y capa los da Radix). En mobile se pisa la
 * posición para que salga como bottom-sheet (`rounded-t-2xl`, entra desde abajo); desde sm es el
 * modal centrado de siempre, en bandas: header y cuerpo con scroll (DESIGN §3.3).
 */
export const ModuleHelp: React.FC<{ moduleKey: string; user: User | null }> = ({ moduleKey, user }) => {
  const [open, setOpen] = useState(false);
  const mod = HELP_CONTENT[moduleKey];

  if (!mod) return null;

  const fbf = !!user?.filterByFloors;
  const has = (perm: string) => perm === '*' || perm.split('|').some(p => can(user, p as Permission));
  const caps = mod.capabilities.filter(c => has(c.permission));
  const notifs = mod.notifications.filter(n => has(n.permission));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Ayuda de ${mod.label}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <HelpCircle className="size-5" aria-hidden="true" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Ayuda de {mod.label}</TooltipContent>
      </Tooltip>

      <DialogContent
        className="max-h-[88dvh] sm:max-h-[85vh] sm:max-w-2xl max-sm:top-auto max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:duration-300 max-sm:data-open:zoom-in-100 max-sm:data-open:slide-in-from-bottom max-sm:data-closed:zoom-out-100 max-sm:data-closed:slide-out-to-bottom"
      >
        <DialogHeader>
          <p className="micro text-muted-foreground">Ayuda</p>
          <DialogTitle className="truncate">{mod.label}</DialogTitle>
        </DialogHeader>

        {/* Cuerpo con scroll del kit; en mobile (bottom sheet) respeta el área segura de abajo. */}
        <DialogBody className="flex flex-col gap-5 space-y-0 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DialogDescription className="leading-relaxed">{mod.overview}</DialogDescription>

          {caps.length > 0 && (
            <section>
              <h3 className="micro mb-2.5 flex items-center gap-2 text-muted-foreground">
                <Check className="size-3.5 text-success" strokeWidth={3} aria-hidden="true" /> Qué podés hacer
              </h3>
              <ul className="flex flex-col gap-2">
                {caps.map((c, i) => (
                  <li key={i} className="recuadro">
                    <p className="text-sm font-semibold leading-snug text-foreground">{c.title}</p>
                    <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{c.description}</p>
                    {c.uiLocation && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                        <span><span className="font-semibold text-foreground">Dónde:</span> {c.uiLocation}</span>
                      </p>
                    )}
                    {c.scopeNote && fbf && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-info/20 bg-info/10 px-1.5 py-0.5 text-xs font-medium text-info">
                        <MapPin className="size-3" aria-hidden="true" /> {c.scopeNote}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {notifs.length > 0 && (
            <section>
              <h3 className="micro mb-2.5 flex items-center gap-2 text-muted-foreground">
                <Bell className="size-3.5 text-warning" aria-hidden="true" /> Notificaciones que recibís
              </h3>
              <ul className="flex flex-col gap-2">
                {notifs.map((n, i) => (
                  <li key={i} className="rounded-lg border border-warning/20 bg-warning/5 p-3">
                    <p className="text-sm font-semibold leading-snug text-foreground">{n.title}</p>
                    <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{n.description}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {caps.length === 0 && notifs.length === 0 && (
            <p className="text-sm italic text-muted-foreground">Con tu rol, en este módulo entrás a ver; no tenés acciones ni notificaciones propias.</p>
          )}

          {mod.tips.length > 0 && (
            <section>
              <h3 className="micro mb-2.5 flex items-center gap-2 text-muted-foreground">
                <Lightbulb className="size-3.5 text-info" aria-hidden="true" /> Bueno saber
              </h3>
              <ul className="flex flex-col gap-1.5">
                {mod.tips.map((t, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden="true" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
