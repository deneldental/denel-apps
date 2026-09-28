import { Lock } from 'lucide-react'

const SECTION_LABELS: Record<string, string> = {
  overview: 'Overview',
  patient_records: 'Patient Records',
  clinical: 'Clinical',
  finance: 'Finance',
  reports: 'Reports',
  analytics: 'Analytics',
  settings: 'Settings',
}

export function NotPublishedState({ section }: { section: string }) {
  const label = SECTION_LABELS[section] ?? section

  return (
    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed min-h-[400px]">
      <div className="flex flex-col items-center gap-3 text-center p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">Not published</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          The <span className="font-medium">{label}</span> section hasn't been published yet.
          Contact your portal administrator to enable it.
        </p>
      </div>
    </div>
  )
}
