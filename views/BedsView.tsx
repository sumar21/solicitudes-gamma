import React, { useState, useMemo, useCallback } from 'react';
import { Bed, BedStatus, Ticket, TicketStatus, User, Role, Area } from '../types';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';
import { BedDouble, User as UserIcon, Info, Search, X, Download, ChevronDown, Check } from 'lucide-react';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import jsPDF from 'jspdf';

const AREA_LABELS: Record<string, string> = {
  [Area.PISO_4]: 'Piso 4',
  [Area.PISO_5]: 'Piso 5',
  [Area.PISO_6]: 'Piso 6',
  [Area.PISO_7]: 'Piso 7',
  [Area.PISO_8]: 'Piso 8',
  [Area.HIT]:    'ITR',
  [Area.HSS]:    'Sueño',
  [Area.HUC]:    'UCO',
  [Area.HUQ]:    'URP',
  [Area.HUT]:    'UTI',
};

const AREA_ORDER: Area[] = [
  Area.HIT,
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8,
  Area.HUC, Area.HUT, Area.HUQ, Area.HSS,
];

const HIDDEN_BY_DEFAULT_ADMISSION = new Set<string>([Area.HSS, Area.HUQ]);

interface BedsViewProps {
  beds: Bed[];
  tickets: Ticket[];
  currentUser: User | null;
}

export const BedsView: React.FC<BedsViewProps> = ({ beds, tickets, currentUser }) => {
  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);

  // Map beds to their assigned ticket (for "Asignada" beds)
  const bedTicketMap = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of tickets) {
      if (t.destination && [TicketStatus.WAITING_ROOM, TicketStatus.IN_TRANSIT, TicketStatus.IN_TRANSPORT].includes(t.status)) {
        map.set(t.destination, t);
      }
    }
    return map;
  }, [tickets]);

  const exportPDF = useCallback(async () => {
    // Convert SVG logo to PNG via canvas
    const svgToLogoPng = (): Promise<string | null> => {
      return new Promise((resolve) => {
        try {
          const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 299 300" fill="none">
            <path d="M177.763 209.923C175.477 205.948 171.246 203.498 166.673 203.498H132.327C127.75 203.498 123.523 205.948 121.236 209.923L104.063 239.768C101.776 243.743 101.776 248.643 104.063 252.618L121.236 282.462C123.523 286.437 127.753 288.887 132.327 288.887H166.676C171.252 288.887 175.479 286.437 177.766 282.462L194.939 252.618C197.226 248.643 197.226 243.743 194.939 239.768L177.763 209.923Z" fill="#022C22"/>
            <path d="M121.236 90.078C123.523 94.053 127.753 96.503 132.327 96.503H166.676C171.252 96.503 175.479 94.053 177.766 90.078L194.939 60.2336C197.226 56.2586 197.226 51.3586 194.939 47.3836L177.763 17.5363C175.477 13.5613 171.249 11.1113 166.673 11.1113H132.327C127.75 11.1113 123.523 13.5613 121.236 17.5363L104.063 47.3808C101.776 51.3558 101.776 56.2558 104.063 60.2308L121.236 90.078Z" fill="#022C22"/>
            <path d="M277.967 191.673L260.794 161.825C258.507 157.85 254.276 155.4 249.703 155.4H215.354C210.778 155.4 206.55 157.85 204.263 161.825L187.09 191.67C184.803 195.645 184.803 200.545 187.09 204.52L204.263 234.364C206.55 238.339 210.78 240.789 215.354 240.789H249.703C254.279 240.789 258.507 238.339 260.794 234.364L277.967 204.52C280.254 200.548 280.254 195.648 277.967 191.673Z" fill="#022C22"/>
            <path d="M38.2046 138.175C40.4914 142.15 44.7217 144.6 49.2953 144.6H83.6443C88.2207 144.6 92.4482 142.15 94.735 138.175L111.908 108.33C114.195 104.355 114.195 99.4554 111.908 95.4804L94.735 65.6359C92.4482 61.6609 88.2179 59.2109 83.6443 59.2109H49.2981C44.7217 59.2109 40.4942 61.6609 38.2074 65.6359L21.0315 95.4776C18.7447 99.4526 18.7447 104.353 21.0315 108.328L38.2046 138.175Z" fill="#022C22"/>
            <path d="M111.911 191.672L94.7378 161.827C92.451 157.852 88.2207 155.402 83.6471 155.402H49.2981C44.7217 155.402 40.4942 157.852 38.2074 161.827L21.0315 191.672C18.7447 195.647 18.7447 200.547 21.0315 204.522L38.2046 234.366C40.4914 238.341 44.7217 240.791 49.2953 240.791H83.6443C88.2207 240.791 92.4482 238.341 94.735 234.366L111.908 204.522C114.198 200.547 114.198 195.647 111.911 191.672Z" fill="#022C22"/>
            <path d="M187.087 108.328L202.187 134.567H183.43C179.142 127.098 173.821 117.831 173.821 117.831C171.863 114.428 168.242 112.331 164.327 112.331H134.926C131.008 112.331 127.39 114.428 125.433 117.831L110.732 143.379C108.774 146.781 108.774 150.976 110.732 154.379L125.433 179.926C127.39 183.329 131.008 185.426 134.926 185.426H164.327C168.245 185.426 171.863 183.329 173.821 179.926L184.305 161.704H148.89V143.829H177.536H188.737H211.054C212.417 144.317 213.859 144.601 215.348 144.601H249.697C254.274 144.601 258.501 142.151 260.788 138.176L277.961 108.331C280.248 104.356 280.248 99.4563 277.961 95.4813L260.794 65.634C258.507 61.659 254.277 59.209 249.703 59.209H215.354C210.778 59.209 206.55 61.659 204.263 65.634L187.09 95.4785C184.801 99.4535 184.801 104.353 187.087 108.328Z" fill="#022C22"/>
          </svg>`;
          const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 200;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, 200, 200);
              resolve(canvas.toDataURL('image/png'));
            } else {
              resolve(null);
            }
            URL.revokeObjectURL(url);
          };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
          img.src = url;
        } catch { resolve(null); }
      });
    };

    const logoPng = await svgToLogoPng();

    const doc = new jsPDF({ orientation: 'landscape' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const now = new Date().toLocaleString('es-AR');
    const margin = 10;

    type RGB = [number, number, number];
    const statusColors: Record<string, { bg: RGB; text: RGB; dot: RGB }> = {
      [BedStatus.AVAILABLE]:   { bg: [209, 250, 229], text: [4, 120, 87],    dot: [16, 185, 129] },
      [BedStatus.OCCUPIED]:    { bg: [254, 226, 226], text: [153, 27, 27],   dot: [220, 38, 38] },
      [BedStatus.PREPARATION]: { bg: [254, 243, 199], text: [146, 64, 14],   dot: [245, 158, 11] },
      [BedStatus.ASSIGNED]:    { bg: [224, 231, 255], text: [55, 48, 163],   dot: [99, 102, 241] },
      [BedStatus.DISABLED]:    { bg: [241, 245, 249], text: [100, 116, 139], dot: [148, 163, 184] },
    };

    const drawHeader = (logoPng: string | null) => {
      const logoSize = 12;
      const textX = logoPng ? margin + logoSize + 4 : margin;

      // Logo
      if (logoPng) {
        try { doc.addImage(logoPng, 'PNG', margin, 4, logoSize, logoSize); } catch { /* no logo */ }
      }

      // Grupo Gamma
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(2, 44, 34); // #022C22
      doc.text('Grupo Gamma', textX, 10);

      // MediFlow subtitle
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('MediFlow', textX, 15);

      // Right side: sede + date
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Sede ${currentUser?.sede || 'HPR'}  ·  ${now}`, pageW - margin, 10, { align: 'right' });

      // Thin green line separator
      doc.setDrawColor(7, 146, 113);
      doc.setLineWidth(0.5);
      doc.line(margin, 19, pageW - margin, 19);
    };

    // Group beds by area
    const grouped: Record<string, typeof beds> = {};
    beds.forEach(b => {
      if (!grouped[b.area]) grouped[b.area] = [];
      grouped[b.area].push(b);
    });

    // Card dimensions
    const cardW = 32;
    const cardHSmall = 18;   // non-occupied
    const cardHBig = 30;     // occupied (more info)
    const cardGap = 2.5;
    const cols = Math.floor((pageW - margin * 2 + cardGap) / (cardW + cardGap));

    let curY = 26;
    let pageStarted = false;

    const ensurePage = (needed: number) => {
      if (curY + needed > pageH - margin) {
        doc.addPage();
        drawHeader(logoPng);
        curY = 26;
      }
    };

    drawHeader(logoPng);

    for (const [areaName, areaBeds] of Object.entries(grouped)) {
      // Area label
      ensurePage(cardHBig + 10);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(51, 65, 85);
      doc.text(areaName, margin, curY + 4);
      doc.setDrawColor(226, 232, 240);
      doc.line(margin + doc.getTextWidth(areaName) + 3, curY + 2, pageW - margin, curY + 2);
      curY += 8;

      let col = 0;
      for (const bed of areaBeds) {
        const ticket = bedTicketMap.get(bed.label);
        const isOccupied = bed.status === BedStatus.OCCUPIED;
        const isAssigned = bed.status === BedStatus.ASSIGNED && !!ticket;
        const cardH = (isOccupied || isAssigned) ? cardHBig : cardHSmall;

        if (col >= cols) { col = 0; curY += cardH + cardGap; }
        ensurePage(cardH + cardGap);

        const x = margin + col * (cardW + cardGap);
        const y = curY;
        const colors = statusColors[bed.status] || statusColors[BedStatus.DISABLED];

        // Card background
        doc.setFillColor(...colors.bg);
        doc.roundedRect(x, y, cardW, cardH, 2, 2, 'F');

        // Status dot
        doc.setFillColor(...colors.dot);
        doc.circle(x + cardW - 3, y + 3, 1.2, 'F');

        // Room-Bed code
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.text);
        doc.text(`${bed.roomCode}-${bed.bedCode}`, x + cardW / 2, y + 7, { align: 'center' });

        // Status label
        doc.setFontSize(5);
        doc.setFont('helvetica', 'normal');
        doc.text(bed.status, x + cardW / 2, y + 11, { align: 'center' });

        // Extra info for occupied beds
        if (isOccupied) {
          doc.setFontSize(5.5);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 41, 59);
          const name = (bed.patientName || '').substring(0, 20);
          doc.text(name, x + 2, y + 16);

          doc.setFontSize(4.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(100, 116, 139);
          if (bed.institution) doc.text(bed.institution.substring(0, 22), x + 2, y + 20);
          if (bed.dni) doc.text(`DNI: ${bed.dni}`, x + 2, y + 23.5);
          if (bed.attendingPhysician) doc.text(`Dr: ${bed.attendingPhysician.substring(0, 18)}`, x + 2, y + 27);
        }

        // Extra info for assigned beds (from ticket)
        if (isAssigned && ticket) {
          doc.setFontSize(5.5);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 41, 59);
          doc.text((ticket.patientName || '').substring(0, 20), x + 2, y + 16);

          doc.setFontSize(4.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(100, 116, 139);
          doc.text(`Desde: ${ticket.origin?.replace(/Habitación /g, '').substring(0, 18) || ''}`, x + 2, y + 20);
          if (ticket.financier) doc.text(ticket.financier.substring(0, 22), x + 2, y + 23.5);
          doc.text(ticket.status, x + 2, y + 27);
        }

        col++;
      }
      curY += ((areaBeds.some(b => b.status === BedStatus.OCCUPIED || (b.status === BedStatus.ASSIGNED && bedTicketMap.has(b.label)))) ? cardHBig : cardHSmall) + cardGap + 3;
    }

    doc.save(`mapa-camas-${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [beds, bedTicketMap, currentUser]);

  // Filters state
  const [searchFilter, setSearchFilter] = useState('');

  const isAdmission = currentUser?.role === Role.ADMISSION || currentUser?.role === Role.ADMIN;

  const [areaFilters, setAreaFilters] = useState<Set<string>>(() => {
    const all = new Set<string>(Object.values(Area));
    if (currentUser?.role === Role.ADMISSION || currentUser?.role === Role.ADMIN) {
      HIDDEN_BY_DEFAULT_ADMISSION.forEach(a => all.delete(a));
    }
    return all;
  });
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());

  const toggleArea = (area: string) => {
    setAreaFilters(prev => {
      const next = new Set(prev);
      next.has(area) ? next.delete(area) : next.add(area);
      return next;
    });
  };

  const toggleStatus = (status: string) => {
    setStatusFilters(prev => {
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      return next;
    });
  };

  const allAreas = Object.values(Area) as string[];
  const areaFilterLabel = areaFilters.size === allAreas.length
    ? 'Todos los sectores'
    : areaFilters.size === 0
      ? 'Ningún sector'
      : `${areaFilters.size} sector${areaFilters.size > 1 ? 'es' : ''}`;

  // Filter beds based on user role, assigned areas and search filters
  const filteredBeds = useMemo(() => {
    let result = [...beds];

    // Role-based filtering
    if (currentUser?.role === Role.HOSTESS && currentUser.assignedAreas?.length > 0) {
      result = result.filter(bed => currentUser.assignedAreas?.includes(bed.area));
    }

    // Universal text search (patient, event, institution, physician)
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      result = result.filter(bed =>
        bed.patientName?.toLowerCase().includes(q) ||
        bed.eventNumber?.toString().includes(q) ||
        bed.institution?.toLowerCase().includes(q) ||
        bed.attendingPhysician?.toLowerCase().includes(q) ||
        bed.roomCode?.includes(q) ||
        bed.bedCode?.includes(q)
      );
    }
    if (areaFilters.size < allAreas.length) {
      result = result.filter(bed => areaFilters.has(bed.area));
    }
    if (statusFilters.size > 0) {
      result = result.filter(bed => statusFilters.has(bed.status));
    }

    return result;
  }, [beds, currentUser, searchFilter, areaFilters, statusFilters]);

  // Group beds by Area, ordered with HIT first
  const bedsByArea: Record<string, Bed[]> = {};
  filteredBeds.forEach(bed => {
    if (!bedsByArea[bed.area]) bedsByArea[bed.area] = [];
    bedsByArea[bed.area].push(bed);
  });
  const sortedAreaEntries = Object.entries(bedsByArea).sort(([a], [b]) => {
    const ia = AREA_ORDER.indexOf(a as Area);
    const ib = AREA_ORDER.indexOf(b as Area);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const getStatusColor = (status: BedStatus) => {
    switch (status) {
      case BedStatus.AVAILABLE: return "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200";
      case BedStatus.OCCUPIED: return "bg-red-100 text-red-700 border-red-300 hover:bg-red-200";
      case BedStatus.PREPARATION: return "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200";
      case BedStatus.ASSIGNED: return "bg-indigo-100 text-indigo-700 border-indigo-300 hover:bg-indigo-200";
      case BedStatus.DISABLED: return "bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200";
      default: return "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200";
    }
  };

  const getStatusDot = (status: BedStatus) => {
    switch (status) {
      case BedStatus.AVAILABLE: return "bg-emerald-500";
      case BedStatus.OCCUPIED: return "bg-red-500";
      case BedStatus.PREPARATION: return "bg-amber-500";
      case BedStatus.ASSIGNED: return "bg-indigo-500";
      case BedStatus.DISABLED: return "bg-slate-400";
      default: return "bg-slate-400";
    }
  };

  return (
    <div className="p-2 md:p-3 space-y-2 md:space-y-4 max-w-[1600px] mx-auto w-full relative">
      {/* Filters bar */}
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search input */}
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="Paciente, evento, financiador, médico, habitación..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-9 h-9 text-xs rounded-xl border-slate-200"
            />
            {searchFilter && (
              <button onClick={() => setSearchFilter('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Area multi-select */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 h-9 px-3 text-xs rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors min-w-[160px] justify-between">
                <span>{areaFilterLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-1" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-52 p-2">
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => setAreaFilters(areaFilters.size === allAreas.length ? new Set() : new Set(allAreas))}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                >
                  <Check className={cn("h-3.5 w-3.5", areaFilters.size === allAreas.length ? "text-slate-800" : "text-transparent")} />
                  Todos los sectores
                </button>
                <div className="my-1 border-t border-slate-100" />
                {AREA_ORDER.map(area => (
                  <button
                    key={area}
                    onClick={() => toggleArea(area)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <Check className={cn("h-3.5 w-3.5 flex-shrink-0", areaFilters.has(area) ? "text-slate-800" : "text-transparent")} />
                    <span className="truncate">{AREA_LABELS[area] ?? area}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Bed count + PDF */}
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-wider">
              <BedDouble className="h-3 w-3 text-slate-400" />
              <span>{filteredBeds.length} camas</span>
            </div>
            <Button variant="outline" size="sm" onClick={exportPDF} className="h-8 rounded-lg border-slate-200 font-bold text-[10px] md:text-xs gap-1.5 px-3 hover:bg-slate-50">
              <Download className="h-3 w-3" />
              <span className="hidden sm:inline">PDF</span>
            </Button>
          </div>
        </div>

        {/* Status multi-select buttons */}
        <div className="flex flex-wrap gap-1.5">
          {Object.values(BedStatus).map(s => {
            const dot = s === BedStatus.AVAILABLE ? 'bg-emerald-500' : s === BedStatus.OCCUPIED ? 'bg-red-500' : s === BedStatus.PREPARATION ? 'bg-amber-500' : s === BedStatus.ASSIGNED ? 'bg-indigo-500' : 'bg-slate-400';
            const active = statusFilters.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                  active
                    ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                )}
              >
                <span className={cn("w-2 h-2 rounded-full", dot)} />
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 md:gap-4">
        {sortedAreaEntries.map(([areaName, areaBeds]) => (
          <div key={areaName} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-lg bg-slate-100/50 border border-slate-200 text-slate-600 font-bold px-2 py-0.5 text-xs">
                {AREA_LABELS[areaName] ?? areaName}
              </span>
              <div className="h-px flex-1 bg-slate-100" />
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-12 lg:grid-cols-16 xl:grid-cols-20 gap-1 md:gap-1.5">
              {areaBeds.map(bed => {
                const shortCode = `${bed.roomCode}-${bed.bedCode}`;

                return (
                  <button
                    key={bed.id}
                    onClick={() => setSelectedBed(bed)}
                    className={cn(
                      "relative flex flex-col items-center justify-center aspect-square rounded-lg border transition-all duration-200 overflow-hidden group",
                      getStatusColor(bed.status)
                    )}
                  >
                    <div className={cn("absolute top-1 right-1 w-1 h-1 md:w-1.5 md:h-1.5 rounded-full shadow-sm", getStatusDot(bed.status))} />
                    
                    <span className="text-[9px] sm:text-[10px] md:text-xs font-black tracking-tighter mt-0.5">
                      {shortCode}
                    </span>
                    
                    {/* Desktop extra info preview */}
                    <div className="hidden md:flex flex-col items-center mt-0 w-full px-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
                      {bed.status === BedStatus.OCCUPIED && (
                        <span className="text-[7px] md:text-[8px] font-bold truncate w-full text-center leading-none">
                          {bed.patientName}
                        </span>
                      )}
                      {bed.status === BedStatus.ASSIGNED && bedTicketMap.get(bed.label) && (
                        <span className="text-[7px] md:text-[8px] font-bold truncate w-full text-center leading-none">
                          {bedTicketMap.get(bed.label)!.patientName}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bed Details Modal */}
      <Dialog open={!!selectedBed} onOpenChange={(open) => !open && setSelectedBed(null)}>
        <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden rounded-3xl border-0 shadow-2xl">
          {selectedBed && (() => {
            type A = { headerBg: string; iconBg: string; icon: string; pill: string; dot: string; patientBg: string; patientBorder: string; label: string };
            const theme: Record<BedStatus, A> = {
              [BedStatus.AVAILABLE]:   { headerBg: 'bg-emerald-50',  iconBg: 'bg-emerald-100', icon: 'text-emerald-600', pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', patientBg: 'bg-emerald-50',  patientBorder: 'border-emerald-100', label: 'text-emerald-500' },
              [BedStatus.OCCUPIED]:    { headerBg: 'bg-red-50',      iconBg: 'bg-red-100',     icon: 'text-red-500',     pill: 'bg-red-100 text-red-600',         dot: 'bg-red-500',     patientBg: 'bg-red-50',      patientBorder: 'border-red-100',     label: 'text-red-400'     },
              [BedStatus.PREPARATION]: { headerBg: 'bg-amber-50',    iconBg: 'bg-amber-100',   icon: 'text-amber-600',   pill: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500',   patientBg: 'bg-amber-50',    patientBorder: 'border-amber-100',   label: 'text-amber-500'   },
              [BedStatus.ASSIGNED]:    { headerBg: 'bg-indigo-50',   iconBg: 'bg-indigo-100',  icon: 'text-indigo-600',  pill: 'bg-indigo-100 text-indigo-700',   dot: 'bg-indigo-500',  patientBg: 'bg-indigo-50',   patientBorder: 'border-indigo-100',  label: 'text-indigo-400'  },
              [BedStatus.DISABLED]:    { headerBg: 'bg-slate-100',   iconBg: 'bg-slate-200',   icon: 'text-slate-500',   pill: 'bg-slate-200 text-slate-500',     dot: 'bg-slate-400',   patientBg: 'bg-slate-50',    patientBorder: 'border-slate-200',   label: 'text-slate-400'   },
            };
            const t = theme[selectedBed.status];

            const isOccupied  = selectedBed.status === BedStatus.OCCUPIED;
            const isAssigned  = selectedBed.status === BedStatus.ASSIGNED;
            const isPrep      = selectedBed.status === BedStatus.PREPARATION;
            const isAvailable = selectedBed.status === BedStatus.AVAILABLE;
            const isDisabled  = selectedBed.status === BedStatus.DISABLED;

            return (
              <div>
                {/* Soft pastel header */}
                <div className={cn("p-7 flex flex-col items-center text-center gap-3", t.headerBg)}>
                  <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm", t.iconBg)}>
                    <BedDouble className={cn("w-7 h-7", t.icon)} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black tracking-tight text-slate-900">{selectedBed.label}</h2>
                    <span className={cn("inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest", t.pill)}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", t.dot)} />
                      {selectedBed.status}
                    </span>
                  </div>
                </div>

                {/* White slide-up panel */}
                <div className="-mt-4 bg-white rounded-t-3xl relative z-10 p-5 space-y-3">

                  {/* Room + Bed stat cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Habitación</p>
                      <p className="text-2xl font-black text-slate-800 leading-none">{selectedBed.roomCode}</p>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Cama</p>
                      <p className="text-2xl font-black text-slate-800 leading-none">{selectedBed.bedCode}</p>
                    </div>
                  </div>

                  {/* OCCUPIED — patient info */}
                  {isOccupied && (
                    <>
                      <div className={cn("rounded-2xl p-4 border", t.patientBg, t.patientBorder)}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <UserIcon className={cn("w-3.5 h-3.5", t.label)} />
                          <span className={cn("text-[9px] font-bold uppercase tracking-widest", t.label)}>Paciente</span>
                        </div>
                        <p className="text-base font-black text-slate-900 leading-snug">{selectedBed.patientName}</p>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">DNI</p>
                          <p className="text-sm font-mono font-bold text-slate-700">{selectedBed.dni || '—'}</p>
                        </div>
                        <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Edad</p>
                          <p className="text-sm font-bold text-slate-700">{selectedBed.age != null ? `${selectedBed.age} años` : '—'}</p>
                        </div>
                        <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Sexo</p>
                          <p className="text-sm font-bold text-slate-700">{selectedBed.sex === 'M' ? 'Masculino' : selectedBed.sex === 'F' ? 'Femenino' : '—'}</p>
                        </div>
                      </div>

                      <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Financiador</p>
                        <p className="text-sm font-semibold text-slate-700 leading-snug">{selectedBed.institution || '—'}</p>
                      </div>

                      <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Profesional interviniente</p>
                        <p className="text-sm font-semibold text-slate-700">{selectedBed.attendingPhysician || '—'}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Evento</p>
                          <p className="text-sm font-mono font-bold text-slate-700">
                            {selectedBed.eventOrigin && selectedBed.eventNumber
                              ? `${selectedBed.eventOrigin}-${selectedBed.eventNumber}`
                              : '—'}
                          </p>
                        </div>
                        <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">ID Paciente</p>
                          <p className="text-sm font-mono font-bold text-slate-700">{selectedBed.patientCode || '—'}</p>
                        </div>
                      </div>
                    </>
                  )}

                  {isAssigned && (() => {
                    const assignedTicket = bedTicketMap.get(selectedBed.label);
                    return (
                      <>
                        <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100 flex items-start gap-3">
                          <Info className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-bold text-indigo-800">Cama Reservada</p>
                            <p className="text-xs text-indigo-500 mt-0.5 leading-relaxed">Es el destino de un traslado en curso. No disponible para nuevas asignaciones.</p>
                          </div>
                        </div>
                        {assignedTicket && (
                          <>
                            <div className={cn("rounded-2xl p-4 border", t.patientBg, t.patientBorder)}>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <UserIcon className={cn("w-3.5 h-3.5", t.label)} />
                                <span className={cn("text-[9px] font-bold uppercase tracking-widest", t.label)}>Paciente en traslado</span>
                              </div>
                              <p className="text-base font-black text-slate-900 leading-snug">{assignedTicket.patientName}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Origen</p>
                                <p className="text-xs font-bold text-slate-700">{assignedTicket.origin}</p>
                              </div>
                              <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Estado</p>
                                <p className="text-xs font-bold text-slate-700">{assignedTicket.status}</p>
                              </div>
                            </div>
                            {assignedTicket.financier && (
                              <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Financiador</p>
                                <p className="text-sm font-semibold text-slate-700">{assignedTicket.financier}</p>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    );
                  })()}

                  {isAvailable && (
                    <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 flex items-center justify-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <p className="text-sm font-semibold text-emerald-700">Lista para recibir paciente</p>
                    </div>
                  )}

                  {isPrep && (
                    <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex items-center gap-3">
                      <Info className="w-5 h-5 text-amber-400 flex-shrink-0" />
                      <p className="text-xs font-semibold text-amber-700 leading-relaxed">Esta cama se está preparando para un nuevo ingreso.</p>
                    </div>
                  )}

                  {isDisabled && (
                    <div className="bg-slate-100 rounded-2xl p-4 border border-slate-200 flex items-center justify-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-slate-400" />
                      <p className="text-sm font-semibold text-slate-500">Cama fuera de servicio</p>
                    </div>
                  )}

                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};
