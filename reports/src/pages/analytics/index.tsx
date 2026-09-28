import { BarChart2 } from 'lucide-react'

export default function AnalyticsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">KPI dashboards and trend charts</p>
      </div>
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed min-h-[400px]">
        <div className="flex flex-col items-center gap-2 text-center">
          <BarChart2 className="h-10 w-10 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">Analytics</h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            KPI summaries and trend charts will appear here once published by your portal
            administrator.
          </p>
        </div>
      </div>
    </div>
  )
}
