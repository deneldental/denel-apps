import { Button, Card, CardContent } from '@denel/ui'
import { formatDistanceToNow } from 'date-fns'
import { BookOpen, ClipboardCheck, Loader2, Plus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreateModuleSheet } from '@/features/trainer/CreateModuleSheet'
import { trainerApi } from '@/lib/actions/trainer'
import { useAuth } from '@/lib/auth'
import { TagBadge } from '@/shared/components/tag-badge'

interface AssessmentRow {
  id: string
  staffId: string
  learnerName: string | null
  trainingId: string
  moduleName: string
  score: number | null
  completedAt: string | null
  reviewedAt: string | null
  trainerFeedback: string | null
  status: 'pending' | 'reviewed'
}

export default function TrainerHomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // Only `.length` is read from either list below — no other field of an
  // individual module/learner is consumed on this page.
  const [modules, setModules] = useState<unknown[]>([])
  const [learners, setLearners] = useState<unknown[]>([])
  const [assessments, setAssessments] = useState<AssessmentRow[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const pending = assessments.filter((a) => a.status === 'pending')
  // Recent activity = the 5 most recent submissions, regardless of review state.
  const recent = assessments
    .slice()
    .sort((a, b) => {
      const ta = a.completedAt ? new Date(a.completedAt).getTime() : 0
      const tb = b.completedAt ? new Date(b.completedAt).getTime() : 0
      return tb - ta
    })
    .slice(0, 5)

  useEffect(() => {
    Promise.all([
      trainerApi.getModules().then((res) => {
        if (res.success && Array.isArray(res.data)) setModules(res.data)
      }),
      trainerApi.getLearners().then((res) => {
        if (res.success && Array.isArray(res.data)) setLearners(res.data)
      }),
      trainerApi.getAssessments().then((res) => {
        if (res.success && Array.isArray(res.data)) setAssessments(res.data as AssessmentRow[])
      }),
    ]).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="p-5 flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }

  return (
    <div className="p-5 pb-8 space-y-5">
      {/* Name card */}
      <Card className="bg-primary/10 border-0 rounded-2xl">
        <CardContent className="p-4">
          <p className="text-xs text-primary/70 font-medium mb-1">Welcome back</p>
          <p className="text-xl font-bold leading-tight">{user?.name ?? 'Trainer'}</p>
          <TagBadge className="mt-2 text-xs">External Trainer</TagBadge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="Modules"
          value={modules.length}
          icon={BookOpen}
          to="/trainer/modules"
          navigate={navigate}
        />
        <StatTile
          label="Learners"
          value={learners.length}
          icon={Users}
          to="/trainer/learners"
          navigate={navigate}
        />
        <StatTile
          label="To grade"
          value={pending.length}
          icon={ClipboardCheck}
          to="/trainer/assessments"
          navigate={navigate}
          accent={pending.length > 0}
        />
      </div>

      {pending.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">
                {pending.length} submission{pending.length === 1 ? '' : 's'} awaiting review
              </p>
              <p className="text-xs text-muted-foreground">Tap to review</p>
            </div>
            <Button size="sm" onClick={() => navigate('/trainer/assessments')}>
              Review
            </Button>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
          Recent activity
        </h2>
        <Card>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No submissions yet.
              </div>
            ) : (
              <div className="divide-y divide-border max-h-52 overflow-y-auto">
                {recent.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 flex items-start gap-3 cursor-pointer hover:bg-muted/40"
                    onClick={() => navigate(`/trainer/assessments/${s.id}`)}
                  >
                    <div
                      className={`h-2 w-2 mt-1.5 rounded-full shrink-0 ${
                        s.status === 'pending' ? 'bg-amber-500' : 'bg-primary'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">
                        <span className="font-medium">{s.learnerName ?? 'Unknown'}</span>{' '}
                        {s.status === 'pending' ? 'submitted' : 'completed'} {s.moduleName}
                        {typeof s.score === 'number' ? ` — scored ${s.score}` : ''}
                      </p>
                      {s.completedAt && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {formatDistanceToNow(new Date(s.completedAt), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Button variant="outline" className="w-full" onClick={() => setCreateOpen(true)}>
        <Plus className="h-4 w-4 mr-2" /> Create module
      </Button>

      <CreateModuleSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => navigate(`/trainer/modules/${id}`)}
      />
    </div>
  )
}

function StatTile({
  label,
  value,
  icon: Icon,
  to,
  navigate,
  accent,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  to: string
  navigate: ReturnType<typeof useNavigate>
  accent?: boolean
}) {
  return (
    <Card
      className={`cursor-pointer hover:bg-accent/50 transition-colors ${accent ? 'border-amber-300 bg-amber-50' : ''}`}
      onClick={() => navigate(to)}
    >
      <CardContent className="p-3">
        <Icon className={`h-4 w-4 mb-1.5 ${accent ? 'text-amber-700' : 'text-muted-foreground'}`} />
        <p className="text-xl font-extrabold leading-tight">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}
