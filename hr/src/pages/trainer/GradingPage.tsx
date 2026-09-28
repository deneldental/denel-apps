import { Button, Card, CardContent, Label, Textarea } from '@denel/ui'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { trainerApi } from '@/lib/actions/trainer'

interface QuizQuestion {
  id: string
  text: string
  questionType: 'scale' | 'multichoice'
  options: string[]
  correctAnswerIndex: number
  orderIndex?: number
}

interface AssessmentDetail {
  id: string
  staffId: string
  learnerName: string | null
  learnerStaffCode: string | null
  trainingId: string
  moduleName: string
  moduleDescription: string | null
  passingScore: number | null
  questions: QuizQuestion[]
  score: number | null
  completedAt: string | null
  reviewedAt: string | null
  reviewedById: string | null
  trainerFeedback: string | null
  status: 'pending' | 'reviewed'
}

export default function TrainerGradingPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<AssessmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    trainerApi
      .getAssessment(id)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) {
          const d = res.data as AssessmentDetail
          setData(d)
          setFeedback(d.trainerFeedback ?? '')
        } else {
          toast.error(res.error || 'Submission not found')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  async function handleFinalize() {
    if (!data) return
    setSaving(true)
    const res = await trainerApi.reviewAssessment(data.id, {
      trainerFeedback: feedback.trim() || undefined,
    })
    setSaving(false)
    if (res.success) {
      toast.success('Marked as reviewed')
      navigate('/trainer/assessments')
    } else {
      toast.error(res.error || 'Failed to save review')
    }
  }

  if (loading) {
    return (
      <div className="p-5 flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-5 pb-8 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/trainer/assessments')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">Submission not found.</p>
        </div>
      </div>
    )
  }

  const readOnly = data.status === 'reviewed'
  const passingScore = data.passingScore ?? 70
  const passed = typeof data.score === 'number' ? data.score >= passingScore : false

  return (
    <div className="pb-28">
      <div className="p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            onClick={() => navigate('/trainer/assessments')}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight leading-tight">
            {data.learnerName ?? 'Unknown learner'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.moduleName}
            {data.learnerStaffCode ? ` · ${data.learnerStaffCode}` : ''}
          </p>
          {data.completedAt && (
            <p className="text-[11px] text-muted-foreground">
              Completed {formatDistanceToNow(new Date(data.completedAt), { addSuffix: true })}
            </p>
          )}
        </div>

        {readOnly && data.reviewedAt && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-700 shrink-0" />
              <p className="text-sm text-green-900">
                Reviewed {formatDistanceToNow(new Date(data.reviewedAt), { addSuffix: true })}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Auto-graded score summary */}
        <Card className="rounded-2xl">
          <CardContent className="p-4 space-y-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Auto-graded score
            </p>
            <div className="flex items-end gap-3">
              <p className="text-3xl font-bold leading-none">
                {typeof data.score === 'number' ? `${data.score}%` : '—'}
              </p>
              <p className="text-sm text-muted-foreground pb-1">
                passing {passingScore}% · {passed ? 'passed' : 'did not pass'}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Multichoice quizzes are scored automatically. Use feedback below to add context.
            </p>
          </CardContent>
        </Card>

        {/* Question + correct answer reference */}
        <div className="space-y-3">
          {data.questions
            .slice()
            .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
            .map((q, i) => {
              const correct = q.options?.[q.correctAnswerIndex]
              return (
                <Card key={q.id} className="rounded-2xl">
                  <CardContent className="p-4 space-y-2">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Question {i + 1}
                    </p>
                    <p className="text-sm font-medium leading-snug">{q.text}</p>
                    {q.options?.length > 0 && (
                      <ul className="text-xs text-muted-foreground space-y-1 mt-1">
                        {q.options.map((opt, idx) => (
                          <li
                            // biome-ignore lint/suspicious/noArrayIndexKey: read-only rendering of an already-submitted assessment's options, never reordered/mutated
                            key={idx}
                            className={
                              idx === q.correctAnswerIndex ? 'text-green-700 font-medium' : ''
                            }
                          >
                            {idx === q.correctAnswerIndex ? '✓ ' : '• '}
                            {opt}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!q.options?.length && correct && (
                      <p className="text-xs text-muted-foreground">
                        Correct: <span className="text-green-700">{correct}</span>
                      </p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
        </div>

        {/* Feedback */}
        <Card className="rounded-2xl">
          <CardContent className="p-4 space-y-2">
            <Label htmlFor="trainer-feedback">Feedback (optional)</Label>
            <Textarea
              id="trainer-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              disabled={readOnly || saving}
              rows={4}
              placeholder="Notes for this learner — strengths, areas to revisit, next module to assign…"
            />
          </CardContent>
        </Card>
      </div>

      <div className="fixed bottom-16 left-0 right-0 border-t border-border bg-background/95 backdrop-blur-sm p-3 flex items-center justify-between gap-3 z-10">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Score</p>
          <p className="text-base font-bold leading-tight">
            {typeof data.score === 'number' ? `${data.score}%` : '—'}
          </p>
        </div>
        <Button onClick={handleFinalize} disabled={readOnly || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {readOnly ? 'Reviewed' : 'Mark reviewed'}
        </Button>
      </div>
    </div>
  )
}
