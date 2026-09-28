import { ACTIONS, MODULES } from '@denel/rbac'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@denel/ui'
import { Loader2, Search, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { type WhoCanDoResult, whoCanDo } from '@/lib/actions/access-management'
import { TagBadge } from '@/shared/components/tag-badge'

const MODULE_VALUES = Object.values(MODULES).sort()
const ACTION_VALUES = Object.values(ACTIONS)

// Access Management overview — orientation + a "who can do X?" reverse lookup.
// Per-user role/scope editing lives on each staff member's detail page (Access).
export default function AccessOverviewPage() {
  const [moduleName, setModuleName] = useState<string>('staff')
  const [action, setAction] = useState<string>('read')
  const [result, setResult] = useState<WhoCanDoResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    const res = await whoCanDo(moduleName, action)
    setBusy(false)
    if (res.success && res.data) setResult(res.data)
    else toast.error(res.error || 'Failed to check who has access')
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Roles
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Scopes + bundles per role.{' '}
              <Link to="/access-management/roles" className="text-primary underline">
                Manage →
              </Link>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Permission matrix
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              What each role can do.{' '}
              <Link to="/access-management/pwa-matrix" className="text-primary underline">
                PWA →
              </Link>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Per-staff access
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Role, scopes & bundles per person live on{' '}
              <Link to="/staff" className="text-primary underline">
                each staff member
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5" />
            Who can do this?
          </CardTitle>
          <CardDescription>
            Reverse lookup — which users hold a given permission (admins always bypass).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Module</Label>
              <Select value={moduleName} onValueChange={setModuleName}>
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {MODULE_VALUES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Action</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_VALUES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={run} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Check
            </Button>
          </div>

          {result && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  {result.users.length} user{result.users.length === 1 ? '' : 's'}
                </span>
                {result.viaRoles.length > 0 && (
                  <span className="text-muted-foreground">
                    via roles: {result.viaRoles.join(', ')}
                  </span>
                )}
                {result.adminBypass && (
                  <Badge variant="outline" className="text-[10px]">
                    + admins (bypass)
                  </Badge>
                )}
              </div>
              <div className="divide-y rounded-md border">
                {result.users.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">
                    No non-admin users hold this permission.
                  </p>
                ) : (
                  result.users.map((u) => (
                    <div key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>
                        {u.name}
                        <span className="ml-2 text-xs text-muted-foreground">{u.email}</span>
                      </span>
                      <TagBadge label={u.roleId ?? 'no role'} className="text-[10px] capitalize">
                        {u.roleId ?? 'no role'}
                      </TagBadge>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
