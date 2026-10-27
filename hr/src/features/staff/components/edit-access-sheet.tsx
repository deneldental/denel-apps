import {
  Button,
  Label,
  PasswordInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
} from '@denel/ui'
import { KeyRound, Layers, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { roleOptionsFor } from '@/features/staff/__mock__/team-members'
import { roleControlFor } from '@/features/staff/role-access'
import {
  type AvailableBundle,
  grantUserBundle,
  listAvailableBundles,
  listUserBundles,
  revokeUserBundle,
  type UserBundleGrant,
} from '@/lib/actions/access-management'
import { resetStaffPassword, updateStaff } from '@/lib/actions/staff'
import { api } from '@/lib/api-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useCanAssignAnyRole } from '@/shared/hooks/use-role-authority'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

type PositionTag = 'staff' | 'non_staff'
const UNASSIGNED = '__unassigned__'

/** Minimum shape required by EditAccessSheet. */
interface StaffAccessProps {
  id: string
  userId?: string | null
  positionTag?: string | null
  role?: string | null
  fullName?: string | null
}

/**
 * Per-section Access editor.
 *
 * PR-11 — Access is the third Profile sub-step. Captures everything that
 * decides what a staff member can DO in the system:
 *   • Clinic tag (positionTag): staff vs non-staff — drives default PWA
 *     bundle auto-grant.
 *   • System role: composes role bundles.
 *   • Portal/PWA scope toggles: per-user surface access.
 *   • Per-user bundle grants: granular additive permissions on top of role.
 *
 * The `bundle_pwa_standard` row is shown but disabled when granted via
 * positionTag — HR has to flip the tag, not the bundle, to revoke it.
 */
export function EditAccessSheet({
  open,
  onOpenChange,
  staff,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: StaffAccessProps
  onSaved: () => void
}) {
  // An administrator may give any role, change scopes and grant bundles; an HR administrator
  // only the everyday roles, and not the scope/bundle controls (those calls need an administrator).
  const canAssignAnyRole = useCanAssignAnyRole()
  const [positionTag, setPositionTag] = useState<PositionTag>('staff')
  const [role, setRole] = useState<string>(UNASSIGNED)
  // Initialised to null so scope rows render only after the data-fetch resolves,
  // preventing a brief flash of stale hardcoded defaults on sheet open.
  const [portalAccess, setPortalAccess] = useState<boolean | null>(null)
  const [pwaAccess, setPwaAccess] = useState<boolean | null>(null)
  const [available, setAvailable] = useState<AvailableBundle[]>([])
  const [grants, setGrants] = useState<UserBundleGrant[]>([])
  const [loading, setLoading] = useState(false)
  // Password reset is its own commit — saves on click, not on the
  // sheet's main "Save changes" button. Keeps the dirty-guard logic
  // simple and prevents an accidental Cancel from losing a reset that's
  // already been typed.
  const [resetPassword, setResetPassword] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)

  // useSubmitGuard handles the batched positionTag+role submit with
  // double-submit prevention and guaranteed finally cleanup.
  const { isSubmitting, submit } = useSubmitGuard()

  // In-flight guards for immediate-save operations.
  // pendingBundles: Set of bundleId strings currently being toggled.
  // pendingScopes: Set of scope strings currently being toggled.
  // pendingCount: total in-flight immediate-save requests (disables sheet close).
  const pendingBundles = useRef(new Set<string>())
  const pendingScopes = useRef(new Set<string>())
  const [pendingCount, setPendingCount] = useState(0)

  // Track initial values to compute isDirty.
  const initialState = useMemo(
    () => ({
      positionTag: (staff.positionTag as PositionTag) ?? 'staff',
      role: staff.role ?? UNASSIGNED,
    }),
    [staff.positionTag, staff.role]
  )

  useEffect(() => {
    if (!open) return
    setPositionTag(initialState.positionTag)
    setRole(initialState.role)
    // Scopes and bundles are administrator-only endpoints; do not call them as anyone else.
    if (!canAssignAnyRole) {
      setAvailable([])
      setGrants([])
      setPortalAccess(false)
      setPwaAccess(true)
      setLoading(false)
      return
    }
    setLoading(true)
    void (async () => {
      const [bundlesRes, grantsRes, permsRes] = await Promise.all([
        listAvailableBundles(),
        staff.userId
          ? listUserBundles(staff.userId)
          : Promise.resolve({ success: true, data: [] as UserBundleGrant[] }),
        staff.userId
          ? api.get<{ scopes: { portal: boolean; pwa: boolean } }>(
              `/api/access-management/users/${staff.userId}/permissions`
            )
          : Promise.resolve({ success: true, data: null }),
      ])
      if (bundlesRes.success && bundlesRes.data) setAvailable(bundlesRes.data)
      if (grantsRes.success && grantsRes.data) setGrants(grantsRes.data)
      const scopes = permsRes.success && permsRes.data ? permsRes.data.scopes : null
      setPortalAccess(scopes?.portal ?? false)
      setPwaAccess(scopes?.pwa ?? true)
      setLoading(false)
    })()
  }, [open, staff.userId, initialState.positionTag, initialState.role, canAssignAnyRole])

  const isDirty = positionTag !== initialState.positionTag || role !== initialState.role

  // Prevent close while any immediate-save request is in flight (scope/bundle toggles).
  const anyPending = pendingCount > 0

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting && !anyPending,
    onClose: () => onOpenChange(false),
  })

  function handleSubmit() {
    if (!staff.id) return
    void submit(async () => {
      // 1. Save positionTag if changed. The backend side-effect handles
      //    bundle_pwa_standard auto-grant/revoke.
      if (positionTag !== initialState.positionTag) {
        const res = await updateStaff(staff.id, { positionTag } as Record<string, unknown>)
        if (!res.success) {
          surfaceApiError(res, 'Failed to update clinic tag')
          return
        }
      }

      // 2. Save role if changed. Goes through the AM endpoint that keeps
      //    user.role + user.roleId in sync.
      if (role !== initialState.role && staff.userId) {
        const nextRole = role === UNASSIGNED ? null : role
        const res = await api.patch(`/api/access-management/staff/${staff.userId}/role`, {
          role: nextRole,
        })
        if (!res.success) {
          surfaceApiError(res, 'Failed to update role')
          return
        }
      }

      toast.success('Access updated.')
      onOpenChange(false)
      onSaved()
    })
  }

  async function handleResetPassword() {
    if (!staff.id) return
    const next = resetPassword.trim()
    if (next.length < 10) {
      toast.error('New password must be at least 10 characters.')
      return
    }
    setResettingPassword(true)
    try {
      const res = await resetStaffPassword(staff.id, next)
      if (!res.success) {
        surfaceApiError(res, 'Failed to reset password')
        return
      }
      toast.success(
        `Password reset. ${staff.fullName ?? 'Staff'} will be asked to change it on next login.`
      )
      setResetPassword('')
    } finally {
      setResettingPassword(false)
    }
  }

  async function handleScopeToggle(scope: 'portal' | 'pwa', granted: boolean) {
    if (!staff.userId) return
    if (pendingScopes.current.has(scope)) return
    pendingScopes.current.add(scope)
    setPendingCount((n) => n + 1)
    const setter = scope === 'portal' ? setPortalAccess : setPwaAccess
    const previous = scope === 'portal' ? portalAccess : pwaAccess
    setter(granted)
    try {
      const res = await api.post(`/api/access-management/staff/${staff.userId}/scope`, {
        scope,
        granted,
      })
      if (!res.success) {
        setter(previous)
        surfaceApiError(res, 'Failed to update scope')
        return
      }
      onSaved()
    } finally {
      pendingScopes.current.delete(scope)
      setPendingCount((n) => n - 1)
    }
  }

  async function handleBundleToggle(bundleId: string, currentlyGranted: boolean) {
    if (!staff.userId) return
    if (pendingBundles.current.has(bundleId)) return
    pendingBundles.current.add(bundleId)
    setPendingCount((n) => n + 1)
    try {
      if (currentlyGranted) {
        const res = await revokeUserBundle(staff.userId, bundleId)
        if (!res.success) {
          surfaceApiError(res, 'Failed to revoke bundle')
          return
        }
        setGrants((prev) => prev.filter((g) => g.bundleId !== bundleId))
      } else {
        const res = await grantUserBundle(staff.userId, bundleId)
        if (!res.success) {
          surfaceApiError(res, 'Failed to grant bundle')
          return
        }
        const meta = available.find((b) => b.id === bundleId)
        if (meta) {
          setGrants((prev) => [
            ...prev,
            {
              bundleId: meta.id,
              bundleName: meta.name,
              scope: meta.scope,
              grantSource: 'manual',
              grantedAt: new Date().toISOString(),
            },
          ])
        }
      }
      onSaved()
    } finally {
      pendingBundles.current.delete(bundleId)
      setPendingCount((n) => n - 1)
    }
  }

  const grantMap = new Map(grants.map((g) => [g.bundleId, g]))

  // What the role control shows (role-access.ts): editable, or read-only for a doctor (set from
  // Portal → Specialists) or for a role only an administrator may change. Detected off the SAVED
  // role (initialState), not the live `role` state, since with no Select in the read-only
  // branches the two never diverge anyway.
  const roleControl = roleControlFor(
    initialState.role === UNASSIGNED ? null : initialState.role,
    canAssignAnyRole
  )

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Edit access"
        description="Clinic tag, system role, portal/PWA scope, and per-user bundle grants."
        size="md"
        submitLabel="Save changes"
        submitting={isSubmitting}
        submitDisabled={!isDirty || anyPending}
        onSubmit={handleSubmit}
      >
        <div className="grid gap-5">
          {/* Clinic tag */}
          <div className="space-y-2">
            <Label htmlFor="edit-position-tag">Clinic tag</Label>
            <Select value={positionTag} onValueChange={(v) => setPositionTag(v as PositionTag)}>
              <SelectTrigger id="edit-position-tag">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff — auto-grant PWA Standard bundle</SelectItem>
                <SelectItem value="non_staff">Non-staff — no auto PWA grant</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The clinic tag drives the default PWA bundle. Flip to <strong>Staff</strong> to
              auto-grant <em>PWA Standard Access</em>; flip to <strong>Non-staff</strong> to revoke
              that auto-grant. Manual bundle grants below are unaffected.
            </p>
          </div>

          {/* System role */}
          <div className="space-y-2">
            <Label htmlFor="edit-role">System role</Label>
            {roleControl.kind === 'admin-only' ? (
              <>
                <div
                  id="edit-role"
                  className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{roleControl.label}</span>
                  <TagBadge label={roleControl.label} className="text-[10px]">
                    Administrator only
                  </TagBadge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Only an administrator can change this role. HR administrators can give Staff,
                  Receptionist and Lab Technician, and only to people who hold one of those or none.
                </p>
              </>
            ) : roleControl.kind === 'specialist-only' ? (
              <>
                <div
                  id="edit-role"
                  className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{roleControl.label}</span>
                  <TagBadge label={roleControl.label} className="text-[10px]">
                    Read-only here
                  </TagBadge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Set from Portal → Specialists, not here — this role links to a specialist record
                  (specialty, licence, commission) that this screen doesn't manage. Change it from
                  the Specialists page.
                </p>
              </>
            ) : (
              <>
                <Select value={role} onValueChange={setRole} disabled={!staff.userId}>
                  <SelectTrigger id="edit-role">
                    <SelectValue placeholder="Pick a role…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>
                      <span className="italic text-muted-foreground">Unassigned</span>
                    </SelectItem>
                    {roleOptionsFor(canAssignAnyRole).map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The role's bundles set the baseline permissions. Use the bundle list below to add
                  extras for this person specifically. Doctor isn't offered here — set it from
                  Portal → Specialists.
                </p>
              </>
            )}
          </div>

          <Separator />

          {/* Reset password — separate commit (its own button) so a
              typed password doesn't get lost if the trainer cancels the
              other access edits. Mirrors the team-member-sheet's Edit
              flow which previously was the only place this lived. */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-medium">Reset password</h4>
            </div>
            <p className="text-xs text-muted-foreground">
              Set a new sign-in password for this staff. They'll be asked to change it on next
              login. Share it privately.
            </p>
            <div className="flex items-start gap-2">
              <PasswordInput
                id="edit-reset-password"
                placeholder="At least 10 characters"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="flex-1"
                disabled={!staff.userId || resettingPassword}
                maxLength={128}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleResetPassword}
                disabled={!staff.userId || resettingPassword || resetPassword.trim().length < 10}
              >
                {resettingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reset'}
              </Button>
            </div>
            {resetPassword.length > 0 && resetPassword.trim().length < 10 && (
              <p className="text-xs text-destructive">Password must be at least 10 characters.</p>
            )}
            {!staff.userId && (
              <p className="text-[11px] text-muted-foreground">
                This staff has no linked sign-in account yet.
              </p>
            )}
          </div>

          {canAssignAnyRole ? (
            <>
              <Separator />

              {/* Scope toggles — save on flip (no batched submit) */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium">Surface access</h4>
                  <p className="text-xs text-muted-foreground">
                    Where this person can sign in. Normally this follows their system role; a switch
                    here is a per-person exception. Toggling saves immediately.
                  </p>
                </div>
                {loading || portalAccess === null || pwaAccess === null ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : (
                  <>
                    <ScopeRow
                      label="Portal"
                      description="Can sign into the clinic portal."
                      checked={portalAccess}
                      onChange={(v) => handleScopeToggle('portal', v)}
                      disabled={!staff.userId}
                    />
                    <ScopeRow
                      label="PWA"
                      description="Can sign into the Team app on their phone."
                      checked={pwaAccess}
                      onChange={(v) => handleScopeToggle('pwa', v)}
                      disabled={!staff.userId}
                    />
                  </>
                )}
              </div>

              <Separator />

              {/* Per-user bundle grants — save on flip */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    Granular access — per-user bundles
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Extra bundles attached directly to this person, on top of their role.
                    Auto-granted bundles (from the clinic tag) are read-only — flip the tag instead.
                  </p>
                </div>
                {loading ? (
                  <p className="text-xs text-muted-foreground">Loading bundles…</p>
                ) : (
                  <div className="space-y-2">
                    {available.map((b) => {
                      const grant = grantMap.get(b.id)
                      const granted = !!grant
                      const isAuto = grant?.grantSource === 'auto_position_tag'
                      return (
                        <div
                          key={b.id}
                          className="flex items-start justify-between gap-3 rounded-md border p-3"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <Label className="text-sm font-medium">{b.name}</Label>
                              <TagBadge label={b.scope} className="h-4 px-1 text-[10px] capitalize">
                                {b.scope}
                              </TagBadge>
                              {isAuto && (
                                <StatusBadge tone="warning" className="h-4 gap-1 px-1 text-[10px]">
                                  <Lock className="h-2.5 w-2.5" />
                                  Auto
                                </StatusBadge>
                              )}
                            </div>
                            {b.description && (
                              <p className="text-xs text-muted-foreground">{b.description}</p>
                            )}
                          </div>
                          <Switch
                            checked={granted}
                            onCheckedChange={() => handleBundleToggle(b.id, granted)}
                            disabled={isAuto || !staff.userId}
                            aria-label={b.name}
                            title={
                              isAuto
                                ? 'Auto-granted via clinic tag — flip the tag to revoke.'
                                : undefined
                            }
                          />
                        </div>
                      )
                    })}
                    {available.length === 0 && (
                      <p className="text-xs text-muted-foreground">No assignable bundles.</p>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground">
                Where this person can sign in and any extra permissions are set by an administrator.
              </p>
            </>
          )}

          {/* Visual reminder */}
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p>
              Scope toggles and bundle grants save immediately. Clinic tag and role changes save on{' '}
              <strong>Save changes</strong>.
            </p>
          </div>
        </div>
      </SheetFormLayout>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}

function ScopeRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </div>
  )
}
