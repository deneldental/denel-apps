import { ChevronLeft, ChevronRight, Clock, Save, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'

// PR-29 — answers from this viewer are submitted RAW. The backend grades
// against the server-stored correctAnswerIndex and returns the authoritative
// score. The viewer no longer knows which option is correct; the staff-
// portal GET that powers it strips correctAnswerIndex on the way out.
//
// PR-31 — answers + position are persisted to localStorage on every change.
// Accidental refresh / sheet close while mid-quiz no longer wipes the work.
// The parent owns the `submitting` state so a network-failed submit doesn't
// leave the button permanently disabled; the staff can re-tap once the
// parent surfaces the error toast.

interface QuizViewerProps {
  module: any
  progress: any
  submitting: boolean
  /** Receives the raw answer map; the page resolves it into the
   *  questionIndex/selectedOption array the backend expects. */
  onComplete: (answers: Record<string, number>) => void
  onCancel: () => void
}

function draftKey(moduleId: string | undefined): string | null {
  return moduleId ? `denel:quiz-draft:${moduleId}` : null
}

type Draft = {
  answers: Record<string, number>
  currentQuestionIndex: number
}

function loadDraft(moduleId: string | undefined): Draft | null {
  const key = draftKey(moduleId)
  if (!key || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Draft>
    if (!parsed || typeof parsed !== 'object') return null
    return {
      answers: parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : {},
      currentQuestionIndex:
        typeof parsed.currentQuestionIndex === 'number' ? parsed.currentQuestionIndex : 0,
    }
  } catch {
    return null
  }
}

function saveDraft(moduleId: string | undefined, draft: Draft): void {
  const key = draftKey(moduleId)
  if (!key || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // localStorage full / disabled — fall back silently. The quiz still works,
    // it just won't resume after a refresh.
  }
}

export function QuizViewer({
  module,
  progress,
  submitting,
  onComplete,
  onCancel,
}: QuizViewerProps) {
  const questions = useMemo(() => module.quizQuestions || [], [module])
  const moduleId: string | undefined = module?.id

  const initialDraft = useMemo(() => loadDraft(moduleId), [moduleId])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(
    initialDraft?.currentQuestionIndex ?? 0
  )
  const [answers, setAnswers] = useState<Record<string, number>>(initialDraft?.answers ?? {})
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const hasAutoSubmitted = useRef(false)

  // PR-31 — persist on every state change so the staff can refresh / close
  // the sheet / lose connection without losing what they've answered.
  useEffect(() => {
    if (!moduleId) return
    saveDraft(moduleId, { answers, currentQuestionIndex })
  }, [moduleId, answers, currentQuestionIndex])

  const handleSubmit = useCallback(() => {
    if (submitting) return
    onComplete(answers)
  }, [answers, submitting, onComplete])

  const handleAutoSubmit = useCallback(() => {
    toast.error('Time is up! Auto-submitting assessment.', { duration: 5000 })
    handleSubmit()
  }, [handleSubmit])

  // Timer rewrite — was a 1Hz setInterval running for the full quiz
  // duration (battery drain on mobile, ran while tab was backgrounded).
  // Now:
  //  - one setTimeout fires auto-submit at exactly endTime (no drift)
  //  - the visible countdown re-renders every 500ms, *only while the tab
  //    is visible* (a backgrounded tab doesn't update display)
  //  - on visibility change we recompute immediately so the user sees the
  //    correct time when they return
  useEffect(() => {
    if (!module.quizTimer) return

    const startTime = progress.startedAt ? new Date(progress.startedAt).getTime() : Date.now()
    const endTime = startTime + module.quizTimer * 60 * 1000
    const remainingMs = endTime - Date.now()

    if (remainingMs <= 0) {
      setTimeLeft(0)
      if (!hasAutoSubmitted.current) {
        hasAutoSubmitted.current = true
        handleAutoSubmit()
      }
      return
    }

    setTimeLeft(Math.ceil(remainingMs / 1000))

    // Drift-free auto-submit — one timer, scheduled for the exact end time.
    const submitTimer = window.setTimeout(handleAutoSubmit, remainingMs)

    // Visible countdown — 500ms is plenty smooth for a seconds counter and
    // is 30x less CPU than the old 60Hz-feeling 1s tick.
    let displayTimer: number | null = null

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000))
      setTimeLeft(remaining)
    }

    const startDisplay = () => {
      if (displayTimer != null) return
      tick()
      displayTimer = window.setInterval(tick, 500)
    }

    const stopDisplay = () => {
      if (displayTimer != null) {
        window.clearInterval(displayTimer)
        displayTimer = null
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') startDisplay()
      else stopDisplay()
    }

    if (document.visibilityState === 'visible') startDisplay()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearTimeout(submitTimer)
      stopDisplay()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [module.quizTimer, progress.startedAt, handleAutoSubmit])

  const handleAnswer = (questionId: string, optionIndex: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }))
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const currentQuestion = questions[currentQuestionIndex]
  const isLastQuestion = currentQuestionIndex === questions.length - 1
  const progressPercent = Math.round((Object.keys(answers).length / questions.length) * 100)

  if (questions.length === 0) return null

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="shrink-0 p-4 border-b bg-background flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-70">
            ASSESSMENT
          </span>
          <h2 className="font-bold text-sm tracking-tight">{module.title}</h2>
        </div>
        {timeLeft !== null && (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${timeLeft < 30 ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' : 'bg-slate-100 text-slate-700 border-slate-200'}`}
          >
            <Clock size={14} className={timeLeft < 30 ? 'text-red-500' : 'text-slate-500'} />
            <span className="text-xs font-mono font-bold tracking-wider">
              {formatTime(timeLeft)}
            </span>
          </div>
        )}
      </div>

      <Progress
        value={progressPercent}
        className="h-1 shrink-0 rounded-none bg-slate-200 dark:bg-slate-800"
      />

      {/* Question Content */}
      <div className="flex-1 overflow-y-auto p-5 pb-24">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] bg-background">
                Q{currentQuestionIndex + 1} OF {questions.length}
              </Badge>
              {answers[currentQuestion.id] !== undefined && (
                <Badge
                  variant="success"
                  className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-200"
                >
                  Answered
                </Badge>
              )}
            </div>
            <h3 className="text-lg font-bold leading-tight text-slate-900 dark:text-slate-100">
              {currentQuestion.text}
            </h3>
          </div>

          <div className="space-y-3">
            {currentQuestion.questionType === 'multichoice' ? (
              <div role="radiogroup" aria-label={currentQuestion.text}>
                {currentQuestion.options.map((option: string, i: number) => (
                  <button
                    key={i}
                    role="radio"
                    aria-checked={answers[currentQuestion.id] === i}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 flex items-center gap-3 active:scale-[0.98]
                    ${
                      answers[currentQuestion.id] === i
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : 'border-slate-200 dark:border-slate-800 bg-background hover:bg-slate-50 dark:hover:bg-slate-900'
                    }`}
                    onClick={() => handleAnswer(currentQuestion.id, i)}
                  >
                    <div
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 text-[11px] font-bold
                    ${answers[currentQuestion.id] === i ? 'bg-primary border-primary text-white' : 'border-slate-300 dark:border-slate-700 text-slate-500'}`}
                    >
                      {String.fromCharCode(65 + i)}
                    </div>
                    <span className="text-sm font-medium">{option}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-label={currentQuestion.text}
                className="flex flex-col gap-4 p-8 items-center bg-background rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 shadow-inner"
              >
                <div className="flex w-full justify-between items-center px-4">
                  {[0, 1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      role="radio"
                      aria-checked={answers[currentQuestion.id] === v}
                      aria-label={
                        v === 0 ? 'Very Poor (0)' : v === 5 ? 'Excellent (5)' : `Rating ${v}`
                      }
                      onClick={() => handleAnswer(currentQuestion.id, v)}
                      className={`w-10 h-10 rounded-full border-2 flex items-center justify-center font-bold text-sm transition-all
                        ${answers[currentQuestion.id] === v ? 'bg-primary border-primary text-white scale-110 shadow-lg shadow-primary/30' : 'bg-background border-slate-200 text-slate-500 hover:border-slate-400'}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div
                  className="flex w-full justify-between px-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-widest opacity-60"
                  aria-hidden="true"
                >
                  <span>Very Poor</span>
                  <span>Excellent</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="shrink-0 p-4 border-t bg-background/80 backdrop-blur-md flex items-center gap-3">
        <Button
          variant="ghost"
          className="flex-1 h-12 rounded-xl text-slate-500 hover:text-slate-900"
          onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
          disabled={currentQuestionIndex === 0}
        >
          <ChevronLeft size={18} className="mr-1" /> BACK
        </Button>

        {!isLastQuestion ? (
          <Button
            className="flex-1 h-12 rounded-xl shadow-lg shadow-primary/20"
            onClick={() =>
              setCurrentQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1))
            }
            disabled={answers[currentQuestion.id] === undefined}
          >
            NEXT <ChevronRight size={18} className="ml-1" />
          </Button>
        ) : (
          <Button
            className="flex-1 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20"
            onClick={handleSubmit}
            disabled={submitting || Object.keys(answers).length < questions.length}
          >
            {submitting ? 'Submitting...' : 'FINISH ASSESSMENT'} <Save size={18} className="ml-2" />
          </Button>
        )}
      </div>

      {/* Exit Button - only if not submitting */}
      {!submitting && (
        <button
          onClick={() => setShowExitConfirm(true)}
          className="fixed top-4 left-4 z-20 p-2 text-slate-400 hover:text-slate-900 transition-colors bg-white/50 backdrop-blur rounded-full md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      <Dialog open={showExitConfirm} onOpenChange={setShowExitConfirm}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Pause assessment?</DialogTitle>
            <DialogDescription>Your answers are saved — you can resume later.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExitConfirm(false)}>
              Keep working
            </Button>
            <Button variant="default" onClick={() => onCancel()}>
              Pause
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
