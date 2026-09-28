import { format } from 'date-fns'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Loader2,
  Pill,
  ScanLine,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'

interface CaseVisit {
  visitDate: string
  stages: { type: string; summary: string | null }[]
}

interface PatientCase {
  id: string
  caseNumber: string
  status: string
  chiefComplaint: string | null
  createdAt: string
  closedAt: string | null
  visits: CaseVisit[]
}

interface Xray {
  id: string
  type: string
  date: string
}

interface PatientDoc {
  id: string
  category: string
  fileName: string
  fileUrl: string
  mimeType: string | null
  uploadedAt: string
}

const DOC_CATEGORY_LABEL: Record<string, string> = {
  insurance_card: 'Insurance card',
  id: 'ID document',
  consent: 'Consent form',
  other: 'Document',
}

const STAGE_LABEL: Record<string, string> = {
  presenting_complaint: 'Presenting complaint',
  history_of_presenting_complaint: 'History',
  past_medical_surgical_history: 'Medical history',
  drug_history_allergies: 'Drug history & allergies',
  social_history: 'Social history',
  diagnosis: 'Diagnosis',
  examination: 'Examination',
  treatment_plan: 'Treatment plan',
  prescription: 'Prescription',
  dental_review: 'Dental review',
  ortho_review: 'Ortho review',
  patient_concern: 'Patient concern',
  oral_health: 'Oral health',
}

function stageLabel(s: string): string {
  return STAGE_LABEL[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}

export default function PatientRecordsPage() {
  const [cases, setCases] = useState<PatientCase[]>([])
  const [xrays, setXrays] = useState<Xray[]>([])
  const [documents, setDocuments] = useState<PatientDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'records' | 'documents' | 'prescriptions'>('records')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<PatientCase[]>('/api/patient-portal/cases'),
      api.get<Xray[]>('/api/patient-portal/xrays'),
      api.get<PatientDoc[]>('/api/patient-portal/documents'),
    ])
      .then(([caseRes, xrayRes, docRes]) => {
        if (caseRes.success && Array.isArray(caseRes.data)) setCases(caseRes.data)
        if (xrayRes.success && Array.isArray(xrayRes.data)) setXrays(xrayRes.data)
        if (docRes.success && Array.isArray(docRes.data)) setDocuments(docRes.data)
      })
      .finally(() => setLoading(false))
  }, [])

  const docCount = xrays.length + documents.length

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-5 p-5 pb-8">
      <div className="pt-4">
        <h1 className="text-2xl font-bold tracking-tight">Records</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Your visit history & documents</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 rounded-xl bg-muted/50 p-1">
        <button
          type="button"
          onClick={() => setTab('records')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === 'records' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
          }`}
        >
          Records {cases.length > 0 && `(${cases.length})`}
        </button>
        <button
          type="button"
          onClick={() => setTab('documents')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === 'documents'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground'
          }`}
        >
          Documents {docCount > 0 && `(${docCount})`}
        </button>
        <button
          type="button"
          onClick={() => setTab('prescriptions')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === 'prescriptions'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground'
          }`}
        >
          Prescriptions
        </button>
      </div>

      {/* Records — per-case / per-visit overview */}
      {tab === 'records' &&
        (cases.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">No records found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cases.map((cse) => {
              const isOpen = expanded === cse.id
              const closed = cse.status === 'closed'
              return (
                <div
                  key={cse.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card"
                >
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 p-4 text-left"
                    onClick={() => setExpanded(isOpen ? null : cse.id)}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-xs text-muted-foreground">{cse.caseNumber}</p>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize ${
                            closed
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {cse.status}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm font-semibold">
                        {cse.chiefComplaint || 'Clinical case'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {format(new Date(cse.createdAt), 'MMM d, yyyy')}
                        {cse.visits.length > 0 &&
                          ` · ${cse.visits.length} visit${cse.visits.length === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    {cse.visits.length > 0 &&
                      (isOpen ? (
                        <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      ))}
                  </button>

                  {isOpen && cse.visits.length > 0 && (
                    <div className="divide-y divide-border border-t border-border">
                      {cse.visits.map((v) => (
                        <div key={v.visitDate} className="px-4 py-3">
                          <p className="text-xs font-semibold text-foreground">
                            {format(new Date(v.visitDate), 'MMM d, yyyy')}
                          </p>
                          <div className="mt-2 space-y-2">
                            {v.stages.map((s, i) => (
                              <div
                                // biome-ignore lint/suspicious/noArrayIndexKey: stages can repeat type per visit
                                key={`${s.type}-${i}`}
                                className="flex gap-2"
                              >
                                <span className="mt-px shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                                  {stageLabel(s.type)}
                                </span>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  {s.summary || 'Recorded'}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}

      {/* Documents — X-rays + uploaded documents */}
      {tab === 'documents' &&
        (docCount === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <ScanLine className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">No documents yet</p>
            <p className="text-xs text-muted-foreground/70">
              X-rays and files shared by the clinic will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {xrays.map((x) => (
              <Link
                key={x.id}
                to={`/patient/xrays/${x.id}`}
                className="flex items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 transition-colors hover:border-indigo-300"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                  <ScanLine className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-indigo-900">{x.type}</p>
                  <p className="text-xs text-indigo-700/80">
                    X-ray · {format(new Date(x.date), 'MMM d, yyyy')}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-indigo-400" />
              </Link>
            ))}
            {documents.map((d) => (
              <a
                key={d.id}
                href={d.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-brand/40"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {DOC_CATEGORY_LABEL[d.category] ?? d.fileName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.fileName} · {format(new Date(d.uploadedAt), 'MMM d, yyyy')}
                  </p>
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        ))}

      {/* Prescriptions — coming soon */}
      {tab === 'prescriptions' && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/12 text-brand">
            <Pill className="h-6 w-6" />
          </div>
          <p className="font-medium text-foreground">Prescriptions</p>
          <span className="rounded-full bg-brand/12 px-2.5 py-0.5 text-xs font-semibold text-brand">
            Coming soon
          </span>
          <p className="max-w-xs text-xs text-muted-foreground/80">
            Your prescriptions will be listed here so you can view and refill them from the app.
          </p>
        </div>
      )}
    </div>
  )
}
