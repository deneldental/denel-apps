import { Loader2, MessageSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  getLabCaseStatuses,
  type LabStageConfig,
  updateLabCaseStatus,
} from '@/lib/actions/lab-workflow'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'

// The stages a technician moves a case through, in order. Keys are canonical
// (billing depends on them); `inserted` is handled by the dentist/portal.
const WORKFLOW_STAGES = [
  'draft',
  'sent',
  'in_progress',
  'received',
  'ready_for_insertion',
  'delayed',
  'cancelled',
]

const LAB_STAGES_KEY = ['lab-workflow', 'stages'] as const

export function LabWorkflowSection() {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const stagesQuery = useApiQuery<LabStageConfig[]>(LAB_STAGES_KEY, () => getLabCaseStatuses())
  const stages = stagesQuery.data ?? []
  const loading = stagesQuery.isLoading

  useEffect(() => {
    if (!stagesQuery.data) return
    setDraft(Object.fromEntries(stagesQuery.data.map((s) => [s.id, s.displayName])))
  }, [stagesQuery.data])

  const saveMutation = useApiMutation(
    (vars: { id: string; displayName: string }) =>
      updateLabCaseStatus(vars.id, { displayName: vars.displayName }),
    { invalidates: [LAB_STAGES_KEY] }
  )

  async function save(stage: LabStageConfig) {
    const label = draft[stage.id]?.trim()
    if (!label) {
      toast.error('Label is required')
      return
    }
    setSavingId(stage.id)
    try {
      const updated = await saveMutation.mutateAsync({ id: stage.id, displayName: label })
      toast.success(`${updated.displayName} saved`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingId(null)
    }
  }

  const workflow = stages
    .filter((s) => WORKFLOW_STAGES.includes(s.name))
    .sort((a, b) => WORKFLOW_STAGES.indexOf(a.name) - WORKFLOW_STAGES.indexOf(b.name))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Progress stages</CardTitle>
        <CardDescription>
          Rename each stage technicians see. The stage keys are fixed — billing and reminders depend
          on them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <div className="space-y-4">
            {workflow.map((s) => {
              const label = draft[s.id] ?? s.displayName
              const dirty = label !== s.displayName
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg border border-border p-3"
                >
                  <Input
                    aria-label={`${s.name} label`}
                    className="h-8 max-w-[220px]"
                    value={label}
                    onChange={(e) => setDraft((p) => ({ ...p, [s.id]: e.target.value }))}
                  />
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{s.name}</code>
                  <div className="ml-auto">
                    <Button
                      size="sm"
                      disabled={!dirty || savingId === s.id}
                      onClick={() => save(s)}
                    >
                      {savingId === s.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Save
                    </Button>
                  </div>
                </div>
              )
            })}
            <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                The patient SMS for each stage now lives in the central{' '}
                <Link className="font-medium text-primary underline" to="/crm/sms-templates">
                  CRM → SMS Templates
                </Link>{' '}
                store (keys <code className="rounded bg-muted px-1 py-0.5">lab_status:*</code>).
                Edit a message once there and it applies everywhere it's sent.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
