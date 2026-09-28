import { ArrowLeft, Loader2, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { labApi } from '@/lib/api'

interface LabCaseSummary {
  id: string
  caseNumber: string
  notes: string | null
  patient?: { name: string }
}

export default function LabCaseNotesPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [labCase, setLabCase] = useState<LabCaseSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!id) return
    labApi.getCase(id).then((res: any) => {
      if (res.success && res.data) {
        setLabCase(res.data)
        setNotes(res.data.notes ?? '')
      }
      setLoading(false)
    })
  }, [id])

  const handleSave = async () => {
    if (!id) return
    setSaving(true)
    const res = await labApi.updateCase(id, { notes })
    if (res.success) {
      setDirty(false)
      toast.success('Notes saved')
    } else {
      toast.error('Failed to save notes')
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!labCase) {
    return (
      <div className="p-5 space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <p className="text-muted-foreground">Case not found.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/lab/jobs/${labCase.id}`)}
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{labCase.caseNumber}</p>
          <h1 className="text-base font-semibold leading-tight truncate">
            Notes — {labCase.patient?.name ?? 'Unknown patient'}
          </h1>
        </div>
        <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </Button>
      </div>

      <div className="flex-1 p-4">
        <Textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            setDirty(true)
          }}
          placeholder="Add case notes, observations, or instructions..."
          className="h-full min-h-[300px] resize-none"
        />
      </div>
    </div>
  )
}
