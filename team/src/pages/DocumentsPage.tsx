import { StatCard } from '@denel/ui/blocks'
import { Calendar, Clock, Download, Eye, FileText, FolderOpen, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { staffApi } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Doc {
  id: string
  title: string
  description?: string
  documentType: string
  fileUrl: string
  uploadedAt: string
}

// Seed labels — a fallback for the built-in types. Custom types (added in HR
// Settings) come from the configurable lookup fetched below.
const typeLabels: Record<string, string> = {
  appointment_letter: 'Appointment Letter',
  promotion_letter: 'Promotion Letter',
  memo: 'Memo',
  salary_certificate: 'Salary Certificate',
  experience_letter: 'Experience Letter',
  policy: 'Policy Document',
  cv: 'Curriculum Vitae (CV)',
  other: 'Other',
}

function prettifyType(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // name → displayName from the configurable HR document-type lookup.
  const [typeLabelMap, setTypeLabelMap] = useState<Record<string, string>>({})
  const [viewingDoc, setViewingDoc] = useState<Doc | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      staffApi.getDocuments().catch(() => ({ success: false, data: [] })),
      staffApi.getProfile().catch(() => ({ success: false, data: null })),
      staffApi.getStaffDocumentTypes().catch(() => ({ success: false, data: [] })),
    ])
      .then(([docsRes, profileRes, typesRes]) => {
        let fetchedDocs: Doc[] = []
        if (docsRes.success && docsRes.data) {
          fetchedDocs = docsRes.data as Doc[]
        }

        if (profileRes.success && profileRes.data) {
          const profile = profileRes.data as { cvUrl?: string; dateOfJoining?: string }
          if (profile.cvUrl) {
            fetchedDocs.push({
              id: 'profile-cv',
              title: 'Curriculum Vitae (CV)',
              description: 'CV uploaded during application or profile update',
              documentType: 'cv',
              fileUrl: profile.cvUrl,
              uploadedAt: profile.dateOfJoining || new Date().toISOString(),
            })
          }
        }

        setDocs(fetchedDocs)

        if (typesRes.success && Array.isArray(typesRes.data)) {
          const map: Record<string, string> = {}
          for (const t of typesRes.data as Array<{ name: string; displayName?: string | null }>) {
            if (t.name) map[t.name] = t.displayName || prettifyType(t.name)
          }
          setTypeLabelMap(map)
        }
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [])

  const handleView = (doc: Doc) => {
    if (doc.id !== 'profile-cv') {
      staffApi.logDocumentAccess(doc.id, 'viewed').catch(() => {})
    }
    setViewingDoc(doc)
  }

  const handleDownload = (doc: Doc) => {
    if (doc.id !== 'profile-cv') {
      staffApi.logDocumentAccess(doc.id, 'downloaded').catch(() => {})
    }
    const a = document.createElement('a')
    a.href = doc.fileUrl
    a.download = doc.title
    a.target = '_blank'
    a.click()
  }

  const grouped = docs.reduce<Record<string, Doc[]>>((acc, d) => {
    const type = d.documentType || 'other'
    if (!acc[type]) acc[type] = []
    acc[type].push(d)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="page-enter p-5 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-16 rounded-lg" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 flex flex-col items-center justify-center pt-16 text-muted-foreground">
        <FolderOpen size={48} className="opacity-40 mb-3" />
        <p className="text-sm">Failed to load documents. Please try again later.</p>
      </div>
    )
  }

  const totalDocs = docs.length
  const policyDocs = docs.filter((d) => d.documentType === 'policy').length
  const letterDocs = docs.filter(
    (d) => d.documentType.includes('letter') || d.documentType === 'cv'
  ).length

  return (
    <div className="page-enter p-5 space-y-5 pb-20">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Documents</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Access your policies, official letters, and other records.
        </p>
      </div>

      {!loading && !error && docs.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard tone="sky" icon={FolderOpen} value={totalDocs} label="Total documents" />
          <StatCard tone="emerald" icon={FileText} value={policyDocs} label="Policies" />
          <StatCard tone="violet" icon={FileText} value={letterDocs} label="Letters & CVs" />
        </div>
      )}

      {docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center pt-16 text-muted-foreground">
          <FolderOpen size={48} className="opacity-40 mb-3" />
          <p className="text-sm">No documents available</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, typeDocs]) => (
            <div key={type} className="space-y-2.5">
              <h2 className="text-xs font-semibold text-muted-foreground px-1 uppercase tracking-wider">
                {typeLabelMap[type] ?? typeLabels[type] ?? prettifyType(type)} ({typeDocs.length})
              </h2>
              <div className="grid gap-2.5">
                {typeDocs.map((doc) => {
                  const tone: 'emerald' | 'violet' | 'sky' =
                    doc.documentType === 'policy'
                      ? 'emerald'
                      : doc.documentType.includes('letter') || doc.documentType === 'cv'
                        ? 'violet'
                        : 'sky'

                  const t = {
                    emerald: {
                      card: 'border-emerald-100 bg-emerald-50 text-emerald-950 hover:border-emerald-200',
                      chip: 'bg-emerald-100 text-emerald-700',
                      text: 'text-emerald-950',
                      muted: 'text-emerald-800/80',
                    },
                    violet: {
                      card: 'border-violet-100 bg-violet-50 text-violet-950 hover:border-violet-200',
                      chip: 'bg-violet-100 text-violet-700',
                      text: 'text-violet-950',
                      muted: 'text-violet-800/80',
                    },
                    sky: {
                      card: 'border-sky-100 bg-sky-50 text-sky-950 hover:border-sky-200',
                      chip: 'bg-sky-100 text-sky-700',
                      text: 'text-sky-950',
                      muted: 'text-sky-800/80',
                    },
                  }[tone]

                  return (
                    <div
                      key={doc.id}
                      className={cn(
                        'relative flex items-center gap-3.5 rounded-2xl border p-3.5 transition-all duration-200 hover:shadow-xs active:scale-[0.99]',
                        t.card
                      )}
                    >
                      <div
                        className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-2xs font-bold',
                          t.chip
                        )}
                      >
                        <FileText size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={cn('font-bold text-sm truncate', t.text)}>{doc.title}</div>
                        <div
                          className={cn(
                            'flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mt-0.5',
                            t.muted
                          )}
                        >
                          <Calendar size={11} />
                          <span>{new Date(doc.uploadedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn('h-8 w-8 hover:bg-current/10 rounded-lg', t.text)}
                          onClick={() => handleView(doc)}
                        >
                          <Eye size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn('h-8 w-8 hover:bg-current/10 rounded-lg', t.text)}
                          onClick={() => handleDownload(doc)}
                        >
                          <Download size={15} />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* In-app Document Viewer Modal */}
      <Dialog open={!!viewingDoc} onOpenChange={(open) => !open && setViewingDoc(null)}>
        <DialogContent className="max-w-4xl w-[95vw] h-[90vh] p-0 overflow-hidden flex flex-col rounded-2xl bg-white border border-stone-200 shadow-xl">
          <DialogHeader className="p-4 border-b border-stone-100 flex flex-row items-center justify-between shrink-0">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-bold text-stone-900 truncate pr-4">
                {viewingDoc?.title}
              </DialogTitle>
              {viewingDoc?.description && (
                <DialogDescription className="text-xs text-stone-500 truncate pr-4">
                  {viewingDoc.description}
                </DialogDescription>
              )}
            </div>
          </DialogHeader>
          <div className="flex-1 bg-stone-50 relative overflow-hidden">
            {viewingDoc?.fileUrl ? (
              <iframe
                src={`${viewingDoc.fileUrl}#toolbar=0&navpanes=0`}
                title={viewingDoc.title}
                className="w-full h-full border-none"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-stone-400 text-sm font-semibold">
                No preview available
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
