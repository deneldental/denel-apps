import { ShieldCheck, ShieldOff, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { GrantLoginDialog } from '@/features/specialists/components/grant-login-dialog'
import { PermissionsTab } from '@/features/staff/components/permissions-tab'
import type { Specialist } from '@/lib/actions/specialists'
import { ACTIONS, MODULES } from '@/lib/modules'
import { useCan } from '@/lib/permissions-context'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

interface SpecialistAccessStepProps {
  specialist: Specialist
  onChanged: () => void
}

/**
 * The Access tab on a specialist's page.
 *
 * Three states, by what the specialist can currently do:
 *   • external, or internal with no login → cannot sign in; offer to grant one;
 *   • internal with a login → manage role, scopes and bundle grants.
 *
 * Granting needs both `specialists:update` and `specialists:create` — it edits
 * a record and mints credentials, the create-side privilege. The backend
 * enforces the same pair; the button just isn't offered to someone who'd be refused.
 */
export function SpecialistAccessStep({ specialist, onChanged }: SpecialistAccessStepProps) {
  const canUpdate = useCan(MODULES.SPECIALISTS, ACTIONS.UPDATE)
  const canCreate = useCan(MODULES.SPECIALISTS, ACTIONS.CREATE)
  const canGrant = canUpdate && canCreate
  const [grantOpen, setGrantOpen] = useState(false)

  if (specialist.userId) {
    // Internal specialist with a linked user — full permissions surface.
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Access summary
            </CardTitle>
            <CardDescription>
              Manages this specialist's role + scope + per-user bundle grants. The same controls HR
              uses on the staff detail page.
            </CardDescription>
          </CardHeader>
        </Card>
        <PermissionsTab
          userId={specialist.userId}
          staffName={specialist.name}
          onChanged={onChanged}
        />
      </div>
    )
  }

  const isExternal = specialist.specialistType === 'external'
  const Icon = isExternal ? ShieldOff : UserPlus

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className="h-4 w-4" />
            Access
          </CardTitle>
          <CardDescription>
            {isExternal
              ? "External specialists don't sign in — they're visiting providers billed by commission. You can give this specialist a portal login, which makes them an internal specialist."
              : "This internal specialist has no login, so they can't sign in."}
          </CardDescription>
        </CardHeader>
        {canGrant && (
          <CardContent className="space-y-2">
            <Button onClick={() => setGrantOpen(true)} disabled={!specialist.isActive}>
              <UserPlus className="mr-2 h-4 w-4" />
              Grant portal login
            </Button>
            {!specialist.isActive && (
              <p className="text-xs text-muted-foreground">
                Reactivate this specialist before granting a login.
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <GrantLoginDialog
        specialist={specialist}
        open={grantOpen}
        onOpenChange={setGrantOpen}
        onGranted={onChanged}
      />
    </>
  )
}
