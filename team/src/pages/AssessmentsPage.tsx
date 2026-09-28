import { StatCard } from '@denel/ui/blocks'
import { Calendar, ClipboardCheck, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { QuizViewer } from '@/components/training/QuizViewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { staffApi } from '@/lib/api'
import { cn } from '@/lib/utils'

// An "assessment" is a published training item that carries a quiz. There's no
// separate assessments entity server-side — the staff-portal training feed
// (answers stripped) is the source, filtered to quiz-bearing materials.
interface Assessment {
  id: string
  status: string
  score?: number
  training: {
    id: string
    title: string
    description?: string
    passingScore?: number
    deadline?: string
    published?: boolean
    allowReassessment?: boolean
    // biome-ignore lint/suspicious/noExplicitAny: quiz question shape is loose across authoring
    quizQuestions?: Array<any>
  }
}

interface QuizSubmissionResult {
  passed: boolean
  score: number | null
  awaitingReview: boolean
  passingScore: number
}

export default function AssessmentsPage() {
  const [items, setItems] = useState<Assessment[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<Assessment | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await staffApi.getTraining()
      if (res.success && Array.isArray(res.data)) {
        const all = res.data as Assessment[]
        setItems(
          all.filter((i) => i.training?.published && (i.training?.quizQuestions?.length ?? 0) > 0)
        )
      } else {
        setItems([])
      }
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleComplete(answers: Record<string, number>) {
    if (!active || submitting) return
    const questions = active.training.quizQuestions ?? []
    const payload = questions
      .map((q, idx) => {
        const key = q?.id ?? String(idx)
        const selected = answers[key]
        return typeof selected === 'number'
          ? { questionIndex: idx, selectedOption: selected }
          : null
      })
      .filter((a): a is { questionIndex: number; selectedOption: number } => a !== null)

    setSubmitting(true)
    try {
      const res = await staffApi.submitQuiz(active.training.id, payload)
      if (res.success && res.data) {
        const data = res.data as QuizSubmissionResult
        if (data.awaitingReview) toast.success('Submitted — awaiting trainer review.')
        else if (data.passed)
          toast.success(`Passed · ${data.score}% (needed ${data.passingScore}%)`)
        else toast.error(`Score ${data.score}% — needed ${data.passingScore}%. Try again.`)
        setActive(null)
        void load()
      } else {
        toast.error(res.error || 'Failed to submit — your answers are still saved.')
      }
    } catch {
      toast.error('You appear offline — please retry when reconnected.')
    } finally {
      setSubmitting(false)
    }
  }

  if (active) {
    return (
      <QuizViewer
        module={active.training}
        progress={active}
        submitting={submitting}
        onComplete={handleComplete}
        onCancel={() => setActive(null)}
      />
    )
  }

  const pending = items.filter((i) => i.status !== 'completed')

  const passedCount = items.filter(
    (a) => a.status === 'completed' && a.score != null && a.score >= (a.training.passingScore ?? 70)
  ).length

  return (
    <div className="page-enter space-y-5 p-5 pb-20">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Assessments</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Quizzes and assessments assigned to you.
        </p>
      </div>

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard tone="amber" icon={ClipboardCheck} value={pending.length} label="Pending" />
          <StatCard tone="emerald" icon={ClipboardCheck} value={passedCount} label="Passed" />
          <StatCard
            tone="violet"
            icon={TrendingUp}
            value={items.length > 0 ? `${Math.round((passedCount / items.length) * 100)}%` : '100%'}
            label="Completion"
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-24 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
          <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No assessments assigned right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => {
            const done = a.status === 'completed'
            const qCount = a.training.quizQuestions?.length ?? 0
            const passing = a.training.passingScore ?? 70
            const passed = done && a.score != null && a.score >= passing

            const tone: 'emerald' | 'amber' | 'brand' = done
              ? passed
                ? 'emerald'
                : 'brand'
              : 'amber'

            const t = {
              emerald: {
                card: 'border-emerald-100 bg-emerald-50 text-emerald-950 hover:border-emerald-200',
                chip: 'bg-emerald-100 text-emerald-700',
                text: 'text-emerald-950',
                muted: 'text-emerald-800/80',
              },
              amber: {
                card: 'border-amber-100 bg-amber-50 text-amber-950 hover:border-amber-200',
                chip: 'bg-amber-100 text-amber-700',
                text: 'text-amber-950',
                muted: 'text-amber-800/80',
              },
              brand: {
                card: 'border-brand/20 bg-brand/5 text-foreground hover:border-brand/30',
                chip: 'bg-brand/15 text-brand',
                text: 'text-foreground',
                muted: 'text-muted-foreground',
              },
            }[tone]

            return (
              <div
                key={a.id}
                className={cn(
                  'relative flex flex-col gap-3 rounded-2xl border p-4 transition-all duration-200 hover:shadow-xs',
                  t.card
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className={cn('font-bold text-sm leading-tight', t.text)}>
                      {a.training.title}
                    </h2>
                    {a.training.description && (
                      <p className={cn('line-clamp-2 text-xs mt-1 leading-relaxed', t.muted)}>
                        {a.training.description}
                      </p>
                    )}
                  </div>
                  {done ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        'capitalize font-bold border-none px-2.5 py-1 text-[10px] rounded-lg shadow-2xs shrink-0',
                        t.chip
                      )}
                    >
                      {passed ? 'Passed' : 'Failed'} {a.score}%
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className={cn(
                        'capitalize font-bold border-none px-2.5 py-1 text-[10px] rounded-lg shadow-2xs shrink-0',
                        t.chip
                      )}
                    >
                      Pending
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 pt-1 border-t border-dashed border-current/10">
                  <div
                    className={cn(
                      'flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider',
                      t.muted
                    )}
                  >
                    <Calendar size={11} />
                    <span>
                      {qCount} question{qCount === 1 ? '' : 's'} · pass {passing}%
                      {a.training.deadline
                        ? ` · due ${new Date(a.training.deadline).toLocaleDateString()}`
                        : ''}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={done && a.training.allowReassessment === false}
                    className={cn(
                      'h-7 text-[10px] font-bold rounded-lg px-2.5 shadow-2xs border-none transition-all active:scale-95 duration-100',
                      done &&
                        a.training.allowReassessment === false &&
                        'opacity-50 pointer-events-none',
                      t.chip
                    )}
                    onClick={() => setActive(a)}
                  >
                    {done
                      ? a.training.allowReassessment === false
                        ? 'Completed'
                        : 'Retake'
                      : 'Take quiz'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
