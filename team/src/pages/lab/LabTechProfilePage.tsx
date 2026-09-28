import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/lib/auth'
import { NotificationPrefsCard } from '@/shared/components/notification-prefs-card'

const PREF_KEY = 'lab-tech-notification-prefs'

// Profile is intentionally lean: identity + notification preferences + sign out.
// Performance stats (completed / turnaround / on-time / rework) and the live
// queue now live on the Home tab (/lab/home).
export default function LabTechProfilePage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const initials = (user?.name ?? 'L T')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="p-5 pb-8 space-y-5">
      <Card>
        <CardContent className="p-5 flex items-center gap-3">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold leading-tight">{user?.name ?? 'Lab Tech'}</h1>
            <p className="text-sm text-muted-foreground truncate">{user?.email ?? '—'}</p>
            <Badge variant="secondary" className="mt-1">
              Lab Technician
            </Badge>
          </div>
        </CardContent>
      </Card>

      <NotificationPrefsCard
        storageKey={PREF_KEY}
        items={[
          { id: 'caseAssigned', label: 'New case assigned' },
          { id: 'stageRequest', label: 'Stage change requested' },
          { id: 'deadlineApproaching', label: 'Case deadline approaching' },
        ]}
      />

      <Button variant="outline" className="w-full" onClick={handleSignOut}>
        <LogOut className="h-4 w-4 mr-2" /> Sign out
      </Button>
    </div>
  )
}
