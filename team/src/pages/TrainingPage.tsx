import { StatCard } from '@denel/ui/blocks'
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  GraduationCap,
  HelpCircle,
  Info,
  Loader2,
  Sparkles,
  TrendingUp,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { QuizViewer } from '@/components/training/QuizViewer'
import { TrainingModuleViewer } from '@/components/training/TrainingModuleViewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { staffApi } from '@/lib/api'
import { sanitizeHtml } from '@/lib/sanitize'
import { cn } from '@/lib/utils'
import { BLOCKNOTE_CONTENT_CLASS } from '@/shared/lib/blocknote-content'

interface TrainingBlock {
  id?: string
  type: 'section' | 'divider' | string
  title?: string
  content?: string
}

interface QuizQuestion {
  id?: string
  text: string
  questionType: 'multichoice' | 'rating' | string
  options?: string[]
}

interface TrainingProgress {
  id: string
  status: string
  progressPercent: number
  score?: number
  startedAt?: string
  completedAt?: string
  training: {
    id: string
    title: string
    description?: string
    materialType: string
    contentUrl?: string
    externalUrl?: string
    isMandatory: boolean
    published: boolean
    deadline?: string
    passingScore?: number
    allowReassessment?: boolean
    blocks?: TrainingBlock[]
    quizTimer?: number
    quizQuestions?: QuizQuestion[]
  }
}

interface QuizSubmissionResult {
  passed: boolean
  score: number | null
  awaitingReview: boolean
  passingScore: number
}

const typeIcons: Record<string, React.ElementType> = {
  document: FileText,
  video: Video,
  quiz: HelpCircle,
  course: BookOpen,
  module: TrayIcon, // Custom icon for modules
}

function TrayIcon(props: any) {
  return <BookOpen {...props} />
}

export default function TrainingPage() {
  const [items, setItems] = useState<TrainingProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [activeItem, setActiveItem] = useState<TrainingProgress | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'viewer' | 'quiz'>('list')
  const [playerItem, setPlayerItem] = useState<TrainingProgress | null>(null)
  // PR-31 — submitting state lives on the page so a failed submit doesn't
  // leave the QuizViewer's button permanently disabled. The page resets
  // it after the toast fires; the viewer reads it as a prop.
  const [submittingQuiz, setSubmittingQuiz] = useState(false)

  // PR-32 follow-up — memoize so the load-on-mount useEffect doesn't see a
  // fresh function reference on every render. Without this, each call's
  // setItems triggered a re-render, the effect's dep array saw a new
  // function, and it fired the fetch again — an infinite loop that
  // surfaced as the list view "blinking" in the PWA.
  const loadTraining = useCallback(async (): Promise<TrainingProgress[]> => {
    try {
      const res = await staffApi.getTraining()
      if (res.success && res.data) {
        const all = res.data as TrainingProgress[]
        const filtered = all.filter((i) => i.training.published)
        setItems(filtered)
        return filtered
      } else {
        setItems([])
        return []
      }
    } catch (_error) {
      setItems([])
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  // PR-32 — on mount and on `online`, drain any quiz submits the user
  // started while offline. Payload shape mirrors what /submit-quiz wants.
  useEffect(() => {
    async function drainPending() {
      if (typeof window === 'undefined' || !window.navigator?.onLine) return
      const pending: Array<{
        trainingId: string
        answers: Array<{ questionIndex: number; selectedOption: number }>
      }> = []
      try {
        const raw = window.localStorage.getItem('denel:quiz-pending')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) pending.push(...parsed)
        }
      } catch {
        // corrupt entry — wipe it
        window.localStorage.removeItem('denel:quiz-pending')
        return
      }
      if (pending.length === 0) return
      const survivors: typeof pending = []
      for (const item of pending) {
        try {
          const res = await staffApi.submitQuiz(item.trainingId, item.answers)
          if (!res.success) {
            survivors.push(item)
          } else {
            // Clean up the draft for this material — it's been graded.
            window.localStorage.removeItem(`denel:quiz-draft:${item.trainingId}`)
            toast.success('A pending assessment was submitted while you were offline.')
          }
        } catch {
          survivors.push(item)
        }
      }
      if (survivors.length === 0) {
        window.localStorage.removeItem('denel:quiz-pending')
      } else {
        window.localStorage.setItem('denel:quiz-pending', JSON.stringify(survivors))
      }
      void loadTraining()
    }
    void drainPending()
    const onlineHandler = () => {
      void drainPending()
    }
    window.addEventListener('online', onlineHandler)
    return () => window.removeEventListener('online', onlineHandler)
  }, [])

  useEffect(() => {
    loadTraining()
  }, [loadTraining])

  const handleStartModule = async (item: TrainingProgress) => {
    if (item.status === 'not_started') {
      const res = await staffApi.updateProgress(item.id, {
        status: 'in_progress',
        progressPercent: 5,
      })
      if (res.success) {
        const freshItems = await loadTraining()
        const freshItem = freshItems.find((i) => i.id === item.id)
        if (freshItem) {
          setActiveItem(freshItem)
          setViewMode('viewer')
        }
      }
    } else {
      // Open from freshly loaded data: the module's images and videos are
      // private links that expire after about an hour, so the copy loaded with
      // the page may be stale. The list is only replaced on success — a failed
      // reload opens the copy already shown, as before.
      let fresh = item
      try {
        const res = await staffApi.getTraining()
        if (res.success && res.data) {
          const all = (res.data as TrainingProgress[]).filter((i) => i.training.published)
          setItems(all)
          fresh = all.find((i) => i.id === item.id) ?? item
        }
      } catch {
        // keep the copy already shown
      }
      setActiveItem(fresh)
      setViewMode('viewer')
    }
  }

  const handleStartQuiz = () => {
    setViewMode('quiz')
  }

  // PR-29 — was POSTing a client-computed score straight into the progress
  // row, which let any staff DevTools their way to 100%. Now we send the
  // raw answers to /submit-quiz; the backend grades against the
  // server-stored correctAnswerIndex and returns the authoritative score.
  //
  // PR-31 — on failure we DON'T unmount the QuizViewer. The staff's
  // localStorage-backed answers stay intact and they can re-tap Submit.
  // Only a successful submit clears the draft and returns to the list.
  const handleCompleteQuiz = async (answers: Record<string, number>) => {
    if (!activeItem) return
    if (submittingQuiz) return
    const trainingId = activeItem.training.id
    const questions: QuizQuestion[] = activeItem.training?.quizQuestions ?? []
    const payload = questions
      .map((q, idx) => {
        const key = q?.id ?? String(idx)
        const selected = answers[key]
        if (typeof selected !== 'number') return null
        return { questionIndex: idx, selectedOption: selected }
      })
      .filter((a): a is { questionIndex: number; selectedOption: number } => a !== null)

    setSubmittingQuiz(true)
    try {
      const res = await staffApi.submitQuiz(trainingId, payload)
      if (!res.success || !res.data) {
        // PR-32 — looks like a network failure (no response at all) → queue
        // the payload for retry. Backend errors with a body (validation,
        // 403, etc.) are NOT queued, because retrying won't help.
        if (!res.error || /network|failed to fetch|offline/i.test(res.error ?? '')) {
          queuePendingSubmit(trainingId, payload)
          toast.error(
            'You appear offline. Your answers are saved and will submit when you reconnect.'
          )
        } else {
          toast.error(res.error || 'Failed to submit — your answers are still saved.')
        }
        return
      }
      const data = res.data as QuizSubmissionResult
      if (data.awaitingReview) {
        toast.success('Submitted — awaiting trainer review.')
      } else if (data.passed) {
        toast.success(`Passed · ${data.score}% (needed ${data.passingScore}%)`)
      } else {
        toast.error(`Score ${data.score}% — needed ${data.passingScore}%. Try again.`)
      }
      // Success only: drop the autosaved draft + return to the list.
      try {
        window.localStorage.removeItem(`denel:quiz-draft:${trainingId}`)
      } catch {
        // localStorage disabled / quota — ignore
      }
      setViewMode('list')
      setActiveItem(null)
      loadTraining()
    } catch (_error) {
      // Hard network failure — queue for the next online event.
      queuePendingSubmit(trainingId, payload)
      toast.error('You appear offline. Your answers are saved and will submit when you reconnect.')
    } finally {
      setSubmittingQuiz(false)
    }
  }

  function queuePendingSubmit(
    trainingId: string,
    answers: Array<{ questionIndex: number; selectedOption: number }>
  ) {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem('denel:quiz-pending')
      const existing: Array<{ trainingId: string; answers: typeof answers }> = raw
        ? JSON.parse(raw)
        : []
      // De-dup by trainingId — latest payload wins.
      const next = existing.filter((x) => x.trainingId !== trainingId)
      next.push({ trainingId, answers })
      window.localStorage.setItem('denel:quiz-pending', JSON.stringify(next))
    } catch {
      // localStorage disabled — nothing we can do; the answers are at
      // least still saved in the quiz-draft key.
    }
  }

  if (loading) {
    return (
      <div className="page-enter p-5 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24 rounded-lg" />
        ))}
      </div>
    )
  }

  if (activeItem && viewMode === 'viewer') {
    return (
      <TrainingModuleViewer
        module={activeItem.training}
        progress={activeItem}
        onStartQuiz={handleStartQuiz}
        onBack={() => {
          setViewMode('list')
          setActiveItem(null)
        }}
      />
    )
  }

  if (activeItem && viewMode === 'quiz') {
    return (
      <QuizViewer
        module={activeItem.training}
        progress={activeItem}
        submitting={submittingQuiz}
        onComplete={handleCompleteQuiz}
        onCancel={() => setViewMode('viewer')}
      />
    )
  }

  const completed = items.filter((i) => i.status === 'completed')
  const pending = items.filter((i) => i.status !== 'completed')
  const avgScore =
    completed.length > 0
      ? completed.reduce((sum, i) => sum + (i.score ?? 0), 0) / completed.length
      : null
  const passedCount = completed.filter((i) => {
    if (i.score == null) return false
    const passing = i.training.passingScore
    return passing == null ? i.score >= 70 : i.score >= passing
  }).length

  return (
    <div className="page-enter p-5 space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Learning Hub</h1>
      </div>

      {/* Training scores summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          tone="violet"
          icon={TrendingUp}
          value={avgScore != null ? `${avgScore.toFixed(0)}%` : '—'}
          label="Avg score"
        />
        <StatCard tone="emerald" icon={CheckCircle2} value={passedCount} label="Passed" />
        <StatCard tone="amber" icon={GraduationCap} value={pending.length} label="Pending" />
      </div>

      {items.length > 0 && (
        <div className="space-y-1.5 bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex justify-between text-[11px] text-muted-foreground font-semibold px-0.5">
            <span>TRAINING PROGRESS</span>
            <span>
              {completed.length} of {items.length} completed
            </span>
          </div>
          <Progress value={completed.length} max={items.length} className="h-1.5" />
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center pt-20 text-muted-foreground opacity-60">
          <GraduationCap size={64} className="mb-4 stroke-[1.5]" />
          <p className="text-sm font-medium">No training assigned yet</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => {
            const isCompleted = item.status === 'completed'
            const isPlayable =
              item.training.materialType === 'module' ||
              item.training.materialType === 'course' ||
              item.training.materialType === 'quiz'
            const TypeIcon = typeIcons[item.training.materialType] || FileText
            const url = item.training.contentUrl || item.training.externalUrl

            const tone: 'emerald' | 'brand' | 'sky' = isCompleted
              ? 'emerald'
              : item.training.isMandatory
                ? 'brand'
                : 'sky'

            const t = {
              emerald: {
                card: 'border-emerald-100 bg-emerald-50 hover:border-emerald-200 text-emerald-950',
                chip: 'bg-emerald-100 text-emerald-700',
                text: 'text-emerald-950',
                muted: 'text-emerald-800/80',
                border: 'border-emerald-200/50',
                btn: 'hover:bg-emerald-100 hover:text-emerald-900 border-emerald-200 text-emerald-800',
              },
              brand: {
                card: 'border-brand/20 bg-brand/5 hover:border-brand/30 text-foreground',
                chip: 'bg-brand/15 text-brand',
                text: 'text-foreground',
                muted: 'text-muted-foreground',
                border: 'border-brand/10',
                btn: 'hover:bg-brand/10 hover:text-brand border-brand/20 text-brand-foreground',
              },
              sky: {
                card: 'border-sky-100 bg-sky-50 hover:border-sky-200 text-sky-950',
                chip: 'bg-sky-100 text-sky-700',
                text: 'text-sky-950',
                muted: 'text-sky-800/80',
                border: 'border-sky-200/50',
                btn: 'hover:bg-sky-100 hover:text-sky-900 border-sky-200 text-sky-800',
              },
            }[tone]

            return (
              <div
                key={item.id}
                className={cn(
                  'relative flex flex-col gap-3 rounded-2xl border p-4 transition-all duration-200 cursor-pointer hover:shadow-md active:scale-[0.99]',
                  t.card
                )}
                onClick={() => (isPlayable ? handleStartModule(item) : null)}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-xl shadow-xs',
                      t.chip
                    )}
                  >
                    {isCompleted ? <CheckCircle2 size={18} /> : <TypeIcon size={18} />}
                  </div>
                  <div className="flex items-center gap-2">
                    {item.training.isMandatory && !isCompleted && (
                      <Badge
                        variant="destructive"
                        className="h-4 px-1.5 text-[9px] uppercase tracking-wider font-bold"
                      >
                        Required
                      </Badge>
                    )}
                    {isCompleted && (
                      <Badge
                        variant="outline"
                        className={cn('text-[9px] h-4 px-1.5 font-bold border-none', t.chip)}
                      >
                        Completed
                      </Badge>
                    )}
                    {isPlayable && <ChevronRight size={16} className={cn('opacity-60', t.text)} />}
                  </div>
                </div>

                <div>
                  <h3 className={cn('font-bold text-sm leading-tight line-clamp-1', t.text)}>
                    {item.training.title}
                  </h3>
                  <p className={cn('text-xs mt-1 line-clamp-2 leading-relaxed', t.muted)}>
                    {item.training.description ||
                      'Access training materials and complete the assessment.'}
                  </p>
                </div>

                {isPlayable && !isCompleted && item.progressPercent > 0 && (
                  <div className="space-y-1">
                    <div
                      className={cn(
                        'flex justify-between text-[9px] font-bold tracking-wider',
                        t.muted
                      )}
                    >
                      <span>PROGRESS</span>
                      <span>{item.progressPercent}%</span>
                    </div>
                    <Progress value={item.progressPercent} className="h-1" />
                  </div>
                )}

                <div
                  className={cn(
                    'flex items-center justify-between pt-2 border-t text-[10px] font-bold uppercase tracking-wider',
                    t.border,
                    t.muted
                  )}
                >
                  <div className="flex items-center gap-3">
                    {isCompleted ? (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={10} /> {item.score}% Scored
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Clock size={10} />{' '}
                        {item.training.deadline
                          ? new Date(item.training.deadline).toLocaleDateString()
                          : 'No Deadline'}
                      </span>
                    )}
                    <span className="opacity-60">{item.training.materialType}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isPlayable && url && (
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          'h-7 text-[10px] font-bold px-2.5 rounded-lg transition-colors bg-transparent',
                          t.btn
                        )}
                        asChild
                        onClick={(e) => e.stopPropagation()}
                      >
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          OPEN LINK
                        </a>
                      </Button>
                    )}

                    {isPlayable && !isCompleted && (
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          'h-7 text-[10px] font-bold px-2.5 rounded-lg transition-colors bg-transparent gap-1',
                          t.btn
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          setPlayerItem(item)
                        }}
                      >
                        <Sparkles size={10} />
                        QUICK
                      </Button>
                    )}

                    {isPlayable && isCompleted && (
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          'h-7 text-[10px] font-bold px-2.5 rounded-lg transition-colors bg-transparent gap-1',
                          t.btn
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          setPlayerItem(item)
                        }}
                      >
                        <Sparkles size={10} />
                        REVIEW
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ModulePlayerSheet item={playerItem} onClose={() => setPlayerItem(null)} />
    </div>
  )
}

function ModulePlayerSheet({
  item,
  onClose,
}: {
  item: TrainingProgress | null
  onClose: () => void
}) {
  const [readBlocks, setReadBlocks] = useState<Set<number>>(new Set())
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const [quizResult, setQuizResult] = useState<{ passed: boolean; score: number } | null>(null)

  const blocks: TrainingBlock[] = item?.training?.blocks ?? []
  const questions: QuizQuestion[] = item?.training?.quizQuestions ?? []
  const hasQuiz = questions.length > 0

  useEffect(() => {
    if (item) {
      setReadBlocks(new Set())
      setAnswers({})
      setQuizResult(null)
    }
  }, [item])

  function toggleRead(idx: number) {
    setReadBlocks((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  async function submitQuiz() {
    if (!item) return
    setSubmitting(true)
    try {
      const payload = Object.entries(answers).map(([qi, oi]) => ({
        questionIndex: Number(qi),
        selectedOption: oi,
      }))
      const res = await staffApi.submitQuiz(item.training.id, payload)
      if (res.success) {
        const data = (res.data ?? {}) as Partial<QuizSubmissionResult>
        const score = data.score ?? 0
        const passed = data.passed ?? false
        setQuizResult({ passed, score })
        toast.success(passed ? `Passed! Score: ${score}%` : `Score: ${score}% — try again`)
      } else {
        toast.error(res.error || 'Failed to submit quiz')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="h-[90vh] flex flex-col p-0 gap-0">
        <SheetHeader className="px-5 py-4 border-b text-left space-y-0">
          <SheetTitle className="text-base pr-8">{item?.training.title ?? 'Module'}</SheetTitle>
          <SheetDescription className="text-xs">
            Quick review — {blocks.length} section{blocks.length !== 1 ? 's' : ''}
            {hasQuiz ? `, ${questions.length}-question quiz` : ''}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="content" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-5 mt-3 grid grid-cols-2 w-auto">
            <TabsTrigger value="content">Content</TabsTrigger>
            {hasQuiz && <TabsTrigger value="quiz">Quiz</TabsTrigger>}
          </TabsList>

          <TabsContent value="content" className="flex-1 overflow-y-auto px-5 pb-3 space-y-3 mt-3">
            {blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No content blocks in this module.
              </p>
            ) : (
              blocks.map((b: any, i: number) => {
                if (b.type === 'divider') {
                  return <hr key={i} className="border-dashed my-2" />
                }
                const done = readBlocks.has(i)
                return (
                  <div key={i} className="rounded-md border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">{b.title}</h4>
                      {done && <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />}
                    </div>
                    {b.content ? (
                      <div
                        className={cn('text-sm text-muted-foreground', BLOCKNOTE_CONTENT_CLASS)}
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.content) }}
                      />
                    ) : b.body ? (
                      <p className="text-xs text-muted-foreground leading-relaxed">{b.body}</p>
                    ) : null}
                    <Button
                      size="sm"
                      variant={done ? 'outline' : 'default'}
                      className="h-7 text-[11px]"
                      onClick={() => toggleRead(i)}
                    >
                      {done ? 'Marked as read' : 'Mark as read'}
                    </Button>
                  </div>
                )
              })
            )}
          </TabsContent>

          {hasQuiz && (
            <TabsContent value="quiz" className="flex-1 overflow-y-auto px-5 pb-3 space-y-4 mt-3">
              {item?.status === 'completed' && !item.training.allowReassessment && !quizResult ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                    <CheckCircle2 size={24} className="text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-bold">Assessment Completed</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      You scored {item.score}%. Retakes are not allowed for this module.
                    </p>
                  </div>
                </div>
              ) : quizResult ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  {quizResult.passed ? (
                    <CheckCircle2 size={40} className="text-emerald-500" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                      <span className="text-destructive font-bold text-lg">✗</span>
                    </div>
                  )}
                  <p className="text-lg font-bold">{quizResult.score}%</p>
                  <p className="text-sm text-muted-foreground">
                    {quizResult.passed
                      ? 'You passed this assessment.'
                      : 'Not passed. Review the content and try again.'}
                  </p>
                  {item?.training.allowReassessment !== false && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuizResult(null)
                        setAnswers({})
                      }}
                    >
                      Retake Quiz
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {questions.map((q: any, qi: number) => {
                    // Scale-type questions store an empty options array
                    // (the Likert scale is just 1..5). Fall back to a 1-5
                    // labeled scale so the question is answerable — without
                    // this the Submit button stays disabled forever, since
                    // no option can be selected for a scale question whose
                    // options array is empty.
                    const isScale = q.questionType === 'scale'
                    const opts: string[] =
                      Array.isArray(q.options) && q.options.length > 0
                        ? q.options
                        : isScale
                          ? ['1', '2', '3', '4', '5']
                          : []
                    return (
                      <div
                        key={q.id ?? qi}
                        className="rounded-md border border-border p-3 space-y-2"
                      >
                        <p className="text-sm font-medium">
                          {qi + 1}. {q.text ?? q.q}
                        </p>
                        {isScale ? (
                          <div className="flex gap-1.5">
                            {opts.map((opt, oi) => {
                              const selected = answers[qi] === oi
                              return (
                                <button
                                  key={oi}
                                  type="button"
                                  onClick={() => setAnswers((p) => ({ ...p, [qi]: oi }))}
                                  className={cn(
                                    'flex-1 rounded-md border py-2 text-xs font-medium transition-colors',
                                    selected
                                      ? 'border-primary bg-primary text-primary-foreground'
                                      : 'border-border bg-background hover:bg-secondary/40'
                                  )}
                                >
                                  {opt}
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {opts.map((opt, oi) => {
                              const selected = answers[qi] === oi
                              return (
                                <button
                                  key={oi}
                                  type="button"
                                  onClick={() => setAnswers((p) => ({ ...p, [qi]: oi }))}
                                  className={cn(
                                    'w-full flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                                    selected
                                      ? 'border-primary bg-primary/5 text-foreground'
                                      : 'border-border bg-background hover:bg-secondary/40'
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'h-3.5 w-3.5 rounded-full border shrink-0',
                                      selected
                                        ? 'border-primary bg-primary'
                                        : 'border-muted-foreground/40'
                                    )}
                                  />
                                  {opt}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  <Button
                    className="w-full"
                    onClick={submitQuiz}
                    disabled={submitting || Object.keys(answers).length < questions.length}
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> Submitting...
                      </>
                    ) : (
                      'Submit Quiz'
                    )}
                  </Button>
                </>
              )}
            </TabsContent>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
