import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
} from '@denel/ui'
import { BookOpen, ClipboardCheck, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { trainerApi } from '@/lib/actions/trainer'

type CreateKind = 'module' | 'quiz'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
  /** Lock the sheet to one kind (e.g. AssessmentsPage opens it as a quiz creator).
   *  When omitted the trainer picks the kind from the top toggle. */
  initialKind?: CreateKind
  lockKind?: boolean
}

export function CreateModuleSheet({
  open,
  onOpenChange,
  onCreated,
  initialKind = 'module',
  lockKind = false,
}: Props) {
  const [kind, setKind] = useState<CreateKind>(initialKind)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [allowReassessment, setAllowReassessment] = useState(false)
  const [published, setPublished] = useState(false)
  const [saving, setSaving] = useState(false)

  // Reset kind whenever the sheet re-opens — otherwise an Assessments-page
  // opener would leak across to the Modules-page opener.
  useEffect(() => {
    if (open) setKind(initialKind)
  }, [open, initialKind])

  function reset() {
    setTitle('')
    setDescription('')
    setAllowReassessment(false)
    setPublished(false)
    setKind(initialKind)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error(kind === 'quiz' ? 'Assessment title is required' : 'Module title is required')
      return
    }
    setSaving(true)
    try {
      const res = await trainerApi.createModule({
        title: title.trim(),
        description: description.trim() || undefined,
        allowReassessment,
        published,
        blocks: [],
        assignedTo: [],
        materialType: kind,
        // Quiz scaffolding — actual questions are added on the detail page.
        // Without an empty array the backend defaults are fine, but being
        // explicit keeps the create-then-redirect flow predictable.
        quizQuestions: kind === 'quiz' ? [] : undefined,
      })
      if (!res.success || !res.data) throw new Error(res.error ?? 'Failed to create')
      onOpenChange(false)
      reset()
      onCreated(res.data.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  const isQuiz = kind === 'quiz'
  const heading = isQuiz ? 'Create assessment' : 'Create module'
  const submitLabel = isQuiz ? 'Create assessment' : 'Create module'
  const titlePlaceholder = isQuiz
    ? 'e.g. Patient Communication Quiz'
    : 'e.g. Infection Control Basics'
  const descPlaceholder = isQuiz
    ? 'What does this assessment evaluate?'
    : 'What will learners gain from this module?'

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!saving) {
          onOpenChange(o)
          if (!o) reset()
        }
      }}
    >
      <SheetContent
        side="bottom"
        className="rounded-t-2xl max-h-[90vh] overflow-y-auto pb-safe"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          document.getElementById('module-title')?.focus()
        }}
      >
        <SheetHeader className="pb-2">
          <SheetTitle>{heading}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {!lockKind && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind('module')}
                className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-colors ${
                  kind === 'module'
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground'
                }`}
              >
                <BookOpen className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Module</p>
                  <p className="text-[11px] leading-tight">Sections + optional quiz</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setKind('quiz')}
                className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-colors ${
                  kind === 'quiz'
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground'
                }`}
              >
                <ClipboardCheck className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Assessment</p>
                  <p className="text-[11px] leading-tight">Standalone quiz</p>
                </div>
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="module-title">Title *</Label>
            <Input
              id="module-title"
              placeholder={titlePlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="module-desc">Description</Label>
            <Textarea
              id="module-desc"
              placeholder={descPlaceholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium">Allow Reassessment</p>
              <p className="text-xs text-muted-foreground">
                Allow staff to retake this after completion
              </p>
            </div>
            <Switch checked={allowReassessment} onCheckedChange={setAllowReassessment} />
          </div>

          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium">Publish immediately</p>
              <p className="text-xs text-muted-foreground">Drafts are only visible to you</p>
            </div>
            <Switch checked={published} onCheckedChange={setPublished} />
          </div>

          <SheetFooter className="pt-2 gap-2 flex-row">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
