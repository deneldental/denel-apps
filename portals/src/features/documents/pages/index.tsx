import { ArrowLeft, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getPatientsPage } from '@/lib/actions/patients'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Input } from '@/shared/components/ui/input'
import { SubjectDocuments } from '../components/subject-documents'
import { TemplatesManager } from '../components/templates-manager'

interface PatientLite {
  id: string
  name: string
  phone?: string | null
}

export default function DocumentsPage() {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [selected, setSelected] = useState<PatientLite | null>(null)
  const [tab, setTab] = useState<'patients' | 'templates'>('patients')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const { data: filtered = [] } = useApiQuery(
    queryKeys.patients.list({ q: debouncedQ }),
    () => getPatientsPage<PatientLite>({ q: debouncedQ, limit: 10 }),
    { enabled: debouncedQ.length >= 2 }
  )

  return (
    <div className="max-w-4xl p-6">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Signed Documents</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Fill + sign consent / compliance documents per patient, or manage reusable templates.
      </p>

      <div className="mb-6 flex gap-1 border-b">
        {(['patients', 'templates'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'templates' ? (
        <TemplatesManager />
      ) : selected ? (
        <div>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mb-4 flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> {selected.name}
          </button>
          <SubjectDocuments
            subjectType="patient"
            subjectId={selected.id}
            subjectName={selected.name}
          />
        </div>
      ) : (
        <div className="max-w-xl">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search patient by name or phone…"
              className="pl-9"
            />
          </div>
          {filtered.length > 0 && (
            <div className="mt-1 divide-y rounded-lg border">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {p.name}
                  {p.phone ? ` · ${p.phone}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
