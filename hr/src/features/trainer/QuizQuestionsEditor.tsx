// Mobile-friendly quiz-question editor for the trainer PWA. Mirrors the
// shape produced by the portal's AssessmentCreator so a quiz created in
// either surface renders the same in the staff-portal runtime.
//
// Question types supported:
//   - multichoice — N options (2–6), one correct
//   - scale       — Likert-style; we still store options but the runtime
//                   treats them as scale points (no correctness)
//
// Persistence: parent owns the array + saves to the backend via
// trainerApi.updateModule({ quizQuestions, quizTimer, passingScore }).
// This component is a controlled editor; it doesn't talk to the API.

import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@denel/ui'
import { CheckCircle2, Circle, Plus, Trash2, X } from 'lucide-react'

export interface QuizQuestion {
  id: string
  text: string
  questionType: 'scale' | 'multichoice'
  options: string[]
  correctAnswerIndex: number
  orderIndex: number
}

interface Props {
  questions: QuizQuestion[]
  onChange: (questions: QuizQuestion[]) => void
  timer: number | null
  onTimerChange: (timer: number | null) => void
  passingScore: number | null
  onPassingScoreChange: (n: number | null) => void
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

export function QuizQuestionsEditor({
  questions,
  onChange,
  timer,
  onTimerChange,
  passingScore,
  onPassingScoreChange,
}: Props) {
  const updateQ = (id: string, patch: Partial<QuizQuestion>) => {
    onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  const addQuestion = () => {
    onChange([
      ...questions,
      {
        id: `q_${Date.now()}`,
        text: '',
        questionType: 'multichoice',
        options: ['', ''],
        correctAnswerIndex: 0,
        orderIndex: questions.length,
      },
    ])
  }

  const removeQuestion = (id: string) => {
    onChange(
      questions
        .filter((q) => q.id !== id)
        // Re-pack orderIndex so the backend stays stable across deletes.
        .map((q, i) => ({ ...q, orderIndex: i }))
    )
  }

  const addOption = (qId: string) => {
    const q = questions.find((x) => x.id === qId)
    if (!q || q.options.length >= 6) return
    updateQ(qId, { options: [...q.options, ''] })
  }

  const removeOption = (qId: string, optIdx: number) => {
    const q = questions.find((x) => x.id === qId)
    if (!q || q.options.length <= 2) return
    const nextOptions = q.options.filter((_, i) => i !== optIdx)
    // Shift correctAnswerIndex left if we removed an option before it,
    // and clamp to 0 if we removed the correct one itself.
    let nextCorrect = q.correctAnswerIndex
    if (nextCorrect === optIdx) nextCorrect = 0
    else if (nextCorrect > optIdx) nextCorrect -= 1
    updateQ(qId, { options: nextOptions, correctAnswerIndex: nextCorrect })
  }

  return (
    <div className="space-y-4">
      {/* Quiz-wide settings */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="quiz-timer" className="text-xs">
                Timer (min)
              </Label>
              <Input
                id="quiz-timer"
                type="number"
                min={0}
                max={1440}
                inputMode="numeric"
                placeholder="No limit"
                value={timer ?? ''}
                onChange={(e) => {
                  const n = e.target.value ? parseInt(e.target.value, 10) : null
                  onTimerChange(Number.isFinite(n as number) ? n : null)
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiz-pass" className="text-xs">
                Passing %
              </Label>
              <Input
                id="quiz-pass"
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                placeholder="None"
                value={passingScore ?? ''}
                onChange={(e) => {
                  const n = e.target.value ? parseInt(e.target.value, 10) : null
                  onPassingScoreChange(Number.isFinite(n as number) ? n : null)
                }}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Timer is total quiz length. Passing % is the auto-grade threshold; below it counts as
            failed.
          </p>
        </CardContent>
      </Card>

      {questions.length === 0 ? (
        <div className="text-center py-10 border border-dashed rounded-lg">
          <p className="text-sm text-muted-foreground">No questions yet. Add one below.</p>
        </div>
      ) : (
        questions.map((q, qIdx) => (
          <Card key={q.id} className="rounded-2xl">
            <CardContent className="p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <Badge variant="outline" className="text-[10px]">
                  Q{qIdx + 1}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeQuestion(q.id)}
                  className="h-7 w-7 p-0 text-destructive"
                  aria-label="Remove question"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`q-${q.id}-text`} className="text-xs">
                  Question
                </Label>
                <Textarea
                  id={`q-${q.id}-text`}
                  value={q.text}
                  onChange={(e) => updateQ(q.id, { text: e.target.value })}
                  placeholder="What do you want to ask?"
                  rows={2}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`q-${q.id}-type`} className="text-xs">
                  Type
                </Label>
                <Select
                  value={q.questionType}
                  onValueChange={(v) =>
                    updateQ(q.id, { questionType: v as QuizQuestion['questionType'] })
                  }
                >
                  <SelectTrigger id={`q-${q.id}-type`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multichoice">Multiple choice</SelectItem>
                    <SelectItem value="scale">Scale (Likert)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  {q.questionType === 'scale' ? 'Scale points' : 'Options (tap to mark correct)'}
                </Label>
                <div className="space-y-1.5">
                  {q.options.map((opt, optIdx) => {
                    const isCorrect = q.correctAnswerIndex === optIdx
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: options is a persisted flat string[] (backend contract) with no natural id; every input below is fully controlled by `opt`, so a shift on add/remove can only affect focus/cursor placement, never displayed data
                      <div key={optIdx} className="flex items-center gap-2">
                        {q.questionType === 'multichoice' ? (
                          <button
                            type="button"
                            onClick={() => updateQ(q.id, { correctAnswerIndex: optIdx })}
                            className="shrink-0"
                            aria-label={isCorrect ? 'Correct answer' : 'Mark as correct'}
                          >
                            {isCorrect ? (
                              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground/40" />
                            )}
                          </button>
                        ) : (
                          <span className="w-5 text-center text-[11px] font-semibold text-muted-foreground">
                            {OPTION_LABELS[optIdx]}
                          </span>
                        )}
                        <Input
                          value={opt}
                          onChange={(e) => {
                            const nextOptions = [...q.options]
                            nextOptions[optIdx] = e.target.value
                            updateQ(q.id, { options: nextOptions })
                          }}
                          placeholder={`Option ${OPTION_LABELS[optIdx]}`}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeOption(q.id, optIdx)}
                          disabled={q.options.length <= 2}
                          className="h-8 w-8 p-0 shrink-0"
                          aria-label="Remove option"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addOption(q.id)}
                  disabled={q.options.length >= 6}
                  className="h-8 text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" /> Add option
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Button type="button" variant="outline" className="w-full" onClick={addQuestion}>
        <Plus className="h-4 w-4 mr-2" />
        Add question
      </Button>
    </div>
  )
}
