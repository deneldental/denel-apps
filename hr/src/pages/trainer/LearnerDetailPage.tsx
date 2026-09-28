// PR-39 — replaced the mock-data lookup with a real fetch through
// trainerApi.getLearners. Same endpoint the list page uses; we filter
// to the matching staff id client-side. The PWA trainer pages don't
// have a dedicated per-learner endpoint and the dataset is small at
// clinic scale, so filtering on the client is fine.

import { Avatar, AvatarFallback, Button, Card, CardContent, Progress } from '@denel/ui'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, BookOpen, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { trainerApi } from '@/lib/actions/trainer'
import { StatusBadge } from '@/shared/components/status-badge'

interface LearnerProgress {
  trainingId: string
  title: string
  status: string
  progressPercent: number
  score?: number | null
  completedAt?: string | null
}

interface Learner {
  id: string
  name: string
  email: string
  role: string
  progressByModule: LearnerProgress[]
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export default function TrainerLearnerDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [learner, setLearner] = useState<Learner | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    trainerApi
      .getLearners()
      .then((res) => {
        if (cancelled) return
        if (res.success && Array.isArray(res.data)) {
          const match = (res.data as Learner[]).find((l) => l.id === id) ?? null
          setLearner(match)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="p-5 pb-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }

  if (!learner) {
    return (
      <div className="p-5 pb-8 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/trainer/learners')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">Learner not found.</p>
        </div>
      </div>
    )
  }

  const lastActivity =
    learner.progressByModule
      .map((p) => p.completedAt)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null

  return (
    <div className="p-5 pb-8 space-y-5">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => navigate('/trainer/learners')}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
              {initialsOf(learner.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold leading-tight truncate">{learner.name}</h1>
            <p className="text-sm text-muted-foreground truncate">{learner.email}</p>
            {lastActivity && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Last activity {formatDistanceToNow(new Date(lastActivity), { addSuffix: true })}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
          Modules
        </h2>
        {learner.progressByModule.length === 0 ? (
          <div className="text-center py-10">
            <BookOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No modules enrolled.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {learner.progressByModule.map((p) => (
              <Card key={p.trainingId} className="rounded-2xl">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-tight">{p.title}</p>
                    <StatusBadge status={p.status} className="shrink-0" />
                  </div>
                  <div className="space-y-1">
                    <Progress value={p.progressPercent} />
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{p.progressPercent}%</span>
                      {typeof p.score === 'number' && (
                        <span className="font-medium tabular-nums">Score {p.score}%</span>
                      )}
                      {p.completedAt && (
                        <span>
                          {formatDistanceToNow(new Date(p.completedAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
