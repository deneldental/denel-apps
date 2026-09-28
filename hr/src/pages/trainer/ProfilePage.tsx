import { Avatar, AvatarFallback, Button, Card, CardContent } from '@denel/ui'
import { ExternalLink, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { resetHrScopeAccess } from '@/lib/hr-scope-check'
import { TagBadge } from '@/shared/components/tag-badge'

export default function TrainerProfilePage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const initials = (user?.name ?? 'E T')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const handleSignOut = async () => {
    resetHrScopeAccess()
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
            <h1 className="text-lg font-bold leading-tight">{user?.name ?? 'Trainer'}</h1>
            <p className="text-sm text-muted-foreground truncate">{user?.email ?? '—'}</p>
            <TagBadge className="mt-1">External Trainer</TagBadge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Organisation
          </p>
          <p className="text-sm font-medium">Ghana Dental Education Collective</p>
          <button
            type="button"
            className="text-xs text-primary inline-flex items-center gap-1 mt-1"
            onClick={() => {
              /* deferred */
            }}
          >
            Manage in portal <ExternalLink className="h-3 w-3" />
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Contact
          </p>
          <div className="text-sm">
            <p>{user?.email ?? '—'}</p>
            {user?.phone && <p className="text-muted-foreground">{user.phone}</p>}
          </div>
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={handleSignOut}>
        <LogOut className="h-4 w-4 mr-2" /> Sign out
      </Button>
    </div>
  )
}
