// Trainer-side module/assessment detail page.
//
// Material type drives the layout:
//   - 'module' → Content tab (blocks) + Questions tab (optional quiz) + Assign
//   - 'quiz'   → Questions tab only + Assign (no content blocks for a standalone quiz)
//
// All CRUD lives on this page — title/description, publish toggle, delete,
// blocks, questions, assignment — so trainers no longer need to bounce to
// the portal.

import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@denel/ui'
import {
  ArrowLeft,
  Check,
  ClipboardCheck,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { QuizQuestionsEditor } from '@/features/trainer/QuizQuestionsEditor'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'
import { AssignLearnersDialog } from './components/AssignLearnersDialog'
import { EditModuleDialog } from './components/EditModuleDialog'
import { ModuleContentTab } from './components/ModuleContentTab'
import { useModuleDetail } from './hooks/useModuleDetail'

export default function TrainerModuleDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const {
    module,
    loading,
    blocks,
    questions,
    timer,
    passingScore,
    questionsDirty,
    questionsSaving,
    publishing,
    deleting,
    learners,
    learnersLoading,
    saveContentHtml,
    togglePublish,
    saveEdit,
    saveQuestions,
    handleDelete,
    loadLearners,
    assignAll,
    assignSpecific,
    setQuestions,
    setTimer,
    setPassingScore,
    setQuestionsDirty,
  } = useModuleDetail(id, () => navigate('/trainer/modules'))

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignSaving, setAssignSaving] = useState(false)

  const handleAssignAll = async () => {
    setAssignSaving(true)
    try {
      await assignAll()
    } catch {
      toast.error('Failed to assign')
    } finally {
      setAssignSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!module) {
    return (
      <div className="p-5 pb-8 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/trainer/modules')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">Not found.</p>
        </div>
      </div>
    )
  }

  const isQuiz = module.materialType === 'quiz'
  const assignedTo = module.assignedTo ?? []
  const assignmentLabel = assignedTo.includes('all')
    ? 'Assigned to all learners'
    : assignedTo.length > 0
      ? `Assigned to ${assignedTo.length} learner${assignedTo.length === 1 ? '' : 's'}`
      : 'Not assigned'

  return (
    <div className="p-5 pb-8 space-y-5">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => navigate('/trainer/modules')}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More options">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" /> Edit details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setDeleteOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight leading-tight break-words">
            {module.title}
          </h1>
          <TagBadge className="mt-2 text-[10px]">{isQuiz ? 'Assessment' : 'Module'}</TagBadge>
        </div>
        <StatusBadge status={module.published ? 'published' : 'draft'} className="mt-1 shrink-0" />
      </div>

      {module.description && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Description
            </p>
            <p className="text-sm leading-relaxed">{module.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Publish toggle */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Published</p>
            <p className="text-xs text-muted-foreground">
              {module.published ? 'Learners can see this now.' : 'Drafts are only visible to you.'}
            </p>
          </div>
          {publishing ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch checked={module.published} onCheckedChange={togglePublish} />
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue={isQuiz ? 'questions' : 'content'} className="w-full">
        <TabsList className={`grid w-full ${isQuiz ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {!isQuiz && <TabsTrigger value="content">Content</TabsTrigger>}
          <TabsTrigger value="questions">
            {isQuiz
              ? 'Questions'
              : `Questions${questions.length > 0 ? ` (${questions.length})` : ''}`}
          </TabsTrigger>
          <TabsTrigger value="assign">Assign</TabsTrigger>
        </TabsList>

        {/* ── Content tab ─────────────────────────────────────────────── */}
        {!isQuiz && (
          <TabsContent value="content" className="pt-1">
            <ModuleContentTab initialBlocks={blocks} onSave={saveContentHtml} />
          </TabsContent>
        )}

        {/* ── Questions tab ────────────────────────────────────────────── */}
        <TabsContent value="questions" className="space-y-3 pt-1">
          {!isQuiz && questions.length === 0 && (
            <div className="rounded-lg border border-dashed p-4 text-center">
              <ClipboardCheck className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                Optional. Add a quiz at the end of this module.
              </p>
            </div>
          )}

          <QuizQuestionsEditor
            questions={questions}
            onChange={(next) => {
              setQuestions(next)
              setQuestionsDirty(true)
            }}
            timer={timer}
            onTimerChange={(t) => {
              setTimer(t)
              setQuestionsDirty(true)
            }}
            passingScore={passingScore}
            onPassingScoreChange={(n) => {
              setPassingScore(n)
              setQuestionsDirty(true)
            }}
          />

          <Button
            className="w-full"
            disabled={!questionsDirty || questionsSaving}
            onClick={saveQuestions}
          >
            {questionsSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : questionsDirty ? (
              'Save questions'
            ) : (
              'Saved'
            )}
          </Button>
        </TabsContent>

        {/* ── Assign tab ───────────────────────────────────────────────── */}
        <TabsContent value="assign" className="space-y-4 pt-1">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground shrink-0" />
              <p className="text-sm flex-1">{assignmentLabel}</p>
              {assignedTo.includes('all') && <Check className="h-4 w-4 text-primary shrink-0" />}
            </CardContent>
          </Card>

          <Button
            className="w-full"
            disabled={assignSaving || assignedTo.includes('all')}
            onClick={handleAssignAll}
          >
            {assignSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Users className="h-4 w-4 mr-2" />
            )}
            Assign to all learners
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setAssignOpen(true)
              loadLearners()
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Assign to specific learners…
          </Button>
        </TabsContent>
      </Tabs>

      <EditModuleDialog
        open={editOpen}
        initialTitle={module.title}
        initialDescription={module.description ?? ''}
        initialAllowReassessment={module.allowReassessment ?? false}
        onOpenChange={setEditOpen}
        onSave={saveEdit}
      />

      {/* ── Delete confirm ───────────────────────────────────────────── */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          if (!deleting) setDeleteOpen(o)
        }}
      >
        <DialogContent className="rounded-lg max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {isQuiz ? 'assessment' : 'module'}?</DialogTitle>
            <DialogDescription>
              This removes the {isQuiz ? 'assessment' : 'module'} and all learner progress on it.
              This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssignLearnersDialog
        open={assignOpen}
        learners={learners}
        learnersLoading={learnersLoading}
        currentAssignedTo={assignedTo}
        onOpenChange={setAssignOpen}
        onAssign={assignSpecific}
      />
    </div>
  )
}
