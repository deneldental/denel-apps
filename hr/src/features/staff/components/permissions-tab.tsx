import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Separator,
  Textarea,
} from '@denel/ui'
import { Loader2, ShieldAlert, ShieldOff, UserCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  getUserPermissions,
  offboardStaff,
  type UserPermissions,
} from '@/lib/actions/access-management'
import { TagBadge } from '@/shared/components/tag-badge'

/**
 * Read-only permission matrix + offboard danger zone for the staff detail
 * page's Access step.
 *
 * Editing (role, scope, bundles, clinic tag) lives in `EditAccessSheet` —
 * opened from the Edit button on the Access summary card. Everything in
 * this component is either a snapshot of the effective permission state or
 * the destructive offboard flow.
 *
 * PR-12 — dropped the inline role select + scope toggles that used to live
 * here. Both fields are sheet-only now to avoid two places mutating the
 * same state.
 */
export function PermissionsTab({
  userId,
  staffName,
  onChanged,
}: {
  userId: string
  staffName: string
  onChanged?: () => void
}) {
  const [banned, setBanned] = useState(false)
  const [permissions, setPermissions] = useState<UserPermissions | null>(null)
  const [permissionsLoading, setPermissionsLoading] = useState(true)

  const [offboardOpen, setOffboardOpen] = useState(false)
  const [offboardReason, setOffboardReason] = useState('')
  const [offboardSubmitting, setOffboardSubmitting] = useState(false)

  const loadPermissions = useCallback(async () => {
    setPermissionsLoading(true)
    try {
      const res = await getUserPermissions(userId)
      if (res.success && res.data) {
        setPermissions(res.data)
        setBanned(res.data.user.banned)
      }
    } finally {
      setPermissionsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadPermissions()
  }, [loadPermissions])

  async function handleOffboard() {
    setOffboardSubmitting(true)
    try {
      const res = await offboardStaff(userId, offboardReason.trim())
      if (!res.success) {
        toast.error(res.error || 'Failed to offboard')
        return
      }
      toast.success(`${staffName} offboarded.`)
      setOffboardOpen(false)
      setOffboardReason('')
      onChanged?.()
    } finally {
      setOffboardSubmitting(false)
    }
  }

  // Group permissions by module for the matrix view.
  const groupedPerms = (() => {
    if (!permissions) return new Map<string, string[]>()
    const map = new Map<string, string[]>()
    for (const p of permissions.permissions) {
      const list = map.get(p.module) ?? []
      list.push(p.action)
      map.set(p.module, list)
    }
    return map
  })()

  return (
    <div className="space-y-6">
      {/* What can this person do? */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCircle className="h-4 w-4" />
            What this person can do
          </CardTitle>
          <CardDescription>
            Effective permission matrix from the role's bundles + per-user grants. Updated when any
            of them change.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {permissionsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !permissions ? (
            <p className="text-sm text-muted-foreground">Permissions unavailable.</p>
          ) : permissions.adminBypass ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <span>
                <strong>Admin bypass</strong> — this account has admin role and can perform any
                action regardless of bundle membership.
              </span>
            </div>
          ) : permissions.permissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No permissions assigned.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                  Bundles ({permissions.bundles.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {permissions.bundles.map((b) => (
                    <TagBadge key={b.id} label={b.name} className="text-xs">
                      {b.name}
                    </TagBadge>
                  ))}
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                  Permissions ({permissions.permissions.length})
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {Array.from(groupedPerms.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([module, actions]) => (
                      <div key={module} className="rounded-md border p-2">
                        <p className="text-xs font-medium">{module}</p>
                        <p className="text-xs text-muted-foreground">{actions.join(' · ')}</p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <ShieldOff className="h-4 w-4" />
            Offboard
          </CardTitle>
          <CardDescription>
            Unsets the role, revokes portal and PWA access, bans the account, and soft-deletes the
            staff record in one transaction. The audit log captures your reason.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setOffboardOpen(true)} disabled={banned}>
            <ShieldOff className="mr-2 h-4 w-4" />
            {banned ? 'Already offboarded' : 'Offboard staff member'}
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={offboardOpen}
        onOpenChange={(open) => {
          setOffboardOpen(open)
          if (!open) setOffboardReason('')
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldOff className="h-4 w-4 text-destructive" />
              Offboard {staffName}
            </DialogTitle>
            <DialogDescription>
              Captured on the audit log for compliance. Required (≥3 characters).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="perm-offboard-reason">Reason</Label>
            <Textarea
              id="perm-offboard-reason"
              value={offboardReason}
              onChange={(e) => setOffboardReason(e.target.value)}
              placeholder="e.g. Resignation effective today; equipment returned."
              rows={3}
              disabled={offboardSubmitting}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOffboardOpen(false)}
              disabled={offboardSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleOffboard}
              disabled={offboardSubmitting || offboardReason.trim().length < 3}
            >
              {offboardSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Offboarding…
                </>
              ) : (
                <>
                  <ShieldOff className="mr-2 h-4 w-4" /> Offboard
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
