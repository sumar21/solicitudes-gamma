import * as React from "react"
import { cn } from "../../lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "purple"
  className?: string
  children?: React.ReactNode
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
        {
          "border-transparent bg-emerald-950 text-slate-50 hover:bg-emerald-950/80": variant === "default",
          "border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200": variant === "secondary",
          "border-transparent bg-red-50 text-red-700 border-red-200 hover:bg-red-100": variant === "destructive",
          "text-slate-600 border-slate-200": variant === "outline",
          "border-transparent bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100": variant === "success",
          "border-transparent bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100": variant === "warning",
          "border-transparent bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100": variant === "info",
          "border-transparent bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100": variant === "purple",
        },
        className
      )}
      {...props}
    />
  )
}

export { Badge }