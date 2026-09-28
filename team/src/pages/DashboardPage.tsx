import { NavCard, StatCard, WelcomeCard } from '@denel/ui/blocks'
import {
  CalendarCheck,
  ClipboardCheck,
  FileText,
  FolderOpen,
  GraduationCap,
  ListChecks,
  Megaphone,
  Receipt,
  TrendingUp,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { staffApi } from '@/lib/api'

interface DashboardData {
  staff: {
    id: string
    staffId: string
    fullName: string
    role: string
    position: string
    profileImage: string | null
    isExternalTrainer: boolean
  }
  stats: {
    pendingRequests: number
    newDocuments: number
    pendingTraining: number
    latestPerformanceScore: number | null
    newMemos: number
    pendingTasks: number
    pendingAssessments: number
  }
}

// The home cards carry live badge counters, so we refetch the dashboard on an
// interval and whenever the window regains focus — the counts stay a real-time
// reflection of memos published, tasks assigned, quizzes graded, etc.
const REFRESH_MS = 45_000

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [totalDocs, setTotalDocs] = useState<number>(0)

  const load = useCallback(async () => {
    try {
      const [res, docsRes, profileRes] = await Promise.all([
        staffApi.getDashboard(),
        staffApi.getDocuments().catch(() => ({ success: false, data: [] })),
        staffApi.getProfile().catch(() => ({ success: false, data: null })),
      ])
      if (res.success && res.data) setData(res.data as DashboardData)

      let count = 0
      if (docsRes.success && Array.isArray(docsRes.data)) {
        count += docsRes.data.length
      }
      if (profileRes.success && profileRes.data?.cvUrl) {
        count += 1
      }
      setTotalDocs(count)
    } catch {
      // Transient failure — keep the last-known counts rather than blanking out.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    const id = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(id)
    }
  }, [load])

  if (loading && !data) {
    return (
      <div className="page-enter p-5 space-y-3">
        <div className="skeleton h-24 rounded-lg" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-24 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="page-enter flex items-center justify-center h-[80vh]">
        <p className="text-muted-foreground">Unable to load dashboard</p>
      </div>
    )
  }

  const { staff: staffInfo, stats } = data
  const isTrainer = staffInfo?.isExternalTrainer || false

  return (
    <div className="page-enter space-y-3 p-5">
      <WelcomeCard
        name={staffInfo?.fullName?.split(' ')?.[0] || 'Staff'}
        subtitle={staffInfo?.position || staffInfo?.role}
      />

      {/* Row: Requests + Documents (counts + live badges) */}
      {!isTrainer && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            tone="amber"
            icon={FileText}
            value={stats.pendingRequests || 0}
            label="Pending requests"
            to="/requests"
            chevron
            badge={stats.pendingRequests}
          />
          <StatCard
            tone="sky"
            icon={FolderOpen}
            value={totalDocs}
            label="Documents"
            to="/documents"
            chevron
          />
        </div>
      )}

      {/* Row: Memos + Tasks + Payslips */}
      {isTrainer ? (
        <NavCard
          tone="rose"
          icon={Megaphone}
          title="Memos"
          subtitle="Announcements & notices from the clinic"
          to="/memos"
          badge={stats.newMemos}
        />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            tone="rose"
            icon={Megaphone}
            value={stats.newMemos || 0}
            label="Memos"
            to="/memos"
            badge={stats.newMemos}
          />
          <StatCard
            tone="brand"
            icon={ListChecks}
            value={stats.pendingTasks || 0}
            label="Tasks"
            to="/tasks"
            badge={stats.pendingTasks}
          />
          <StatCard tone="emerald" icon={Receipt} value="View" label="Payslips" to="/payslips" />
        </div>
      )}

      {/* Row: Training + Performance */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          tone="violet"
          icon={GraduationCap}
          value={stats.pendingTraining || 0}
          label="Training due"
          to="/training"
          chevron
          badge={stats.pendingTraining}
        />
        {!isTrainer && (
          <StatCard
            tone="emerald"
            icon={TrendingUp}
            value={stats.latestPerformanceScore != null ? `${stats.latestPerformanceScore}/5` : '—'}
            label="Performance"
            to="/performance"
            chevron
          />
        )}
      </div>

      {/* Long: Assessments — quizzes assigned to the staff */}
      <NavCard
        tone="teal"
        icon={ClipboardCheck}
        title="Assessments"
        subtitle="Quizzes assigned to you"
        to="/assessments"
        badge={stats.pendingAssessments}
      />

      {/* Long: Attendance — the working weekly view (not the dead /attendance-hub) */}
      {!isTrainer && (
        <NavCard
          tone="indigo"
          icon={CalendarCheck}
          title="Attendance"
          subtitle="Your clock-ins & timesheets"
          to="/attendance"
        />
      )}
    </div>
  )
}
