
import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "../../lib/utils"

interface CalendarProps {
  selected?: string // ISO string YYYY-MM-DD
  onSelect?: (date: string) => void
  className?: string
}

export const Calendar = ({ selected, onSelect, className }: CalendarProps) => {
  // Inicializamos viewDate con la fecha seleccionada o la fecha actual
  const [viewDate, setViewDate] = React.useState(() => {
    if (selected) {
      const parts = selected.split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, 1);
    }
    return new Date();
  })
  
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay()

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  
  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ]

  const prevMonth = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setViewDate(new Date(year, month - 1, 1));
  }
  
  const nextMonth = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setViewDate(new Date(year, month + 1, 1));
  }

  const handleDateClick = (day: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onSelect?.(dateStr)
  }

  const days = []
  const offset = firstDayOfMonth(year, month)
  
  // Rellenar espacios vacíos antes del primer día del mes
  for (let i = 0; i < offset; i++) {
    days.push(<div key={`empty-${i}`} className="h-9 w-9" />)
  }

  const totalDays = daysInMonth(year, month)
  const todayStr = new Date().toISOString().split('T')[0]

  for (let d = 1; d <= totalDays; d++) {
    const currentStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isSelected = selected === currentStr
    const isToday = todayStr === currentStr

    days.push(
      <button
        key={d}
        type="button"
        onClick={(e) => handleDateClick(d, e)}
        className={cn(
          "h-9 w-9 rounded-md text-sm transition-all hover:bg-slate-100 flex items-center justify-center relative",
          isSelected && "bg-slate-900 text-slate-50 hover:bg-slate-900 font-bold",
          isToday && !isSelected && "text-blue-600 font-bold after:content-[''] after:absolute after:bottom-1.5 after:w-1 after:h-1 after:bg-blue-600 after:rounded-full"
        )}
      >
        {d}
      </button>
    )
  }

  return (
    <div className={cn("p-0 w-64 bg-white", className)}>
      <div className="flex items-center justify-between px-1 mb-4">
        <h4 className="text-sm font-bold text-slate-900">
          {monthNames[month]} {year}
        </h4>
        <div className="flex gap-1">
          <button 
            type="button"
            onClick={prevMonth} 
            className="p-1 rounded-md hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button 
            type="button"
            onClick={nextMonth} 
            className="p-1 rounded-md hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"].map(d => (
          <div key={d} className="text-[10px] font-black text-slate-400 uppercase h-8 flex items-center justify-center tracking-tighter">
            {d}
          </div>
        ))}
        {days}
      </div>
    </div>
  )
}
