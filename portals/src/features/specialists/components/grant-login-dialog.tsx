import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { grantSpecialistLogin, type Specialist } from '@/lib/actions/specialists'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useSeedOnOpen } from '@/shared/hooks/use-seed-on-open'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 10

interface GrantLoginDialogProps {
  specialist: Specialist
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the login exists, so the page can refetch. */
  onGranted: () => void
}

/**
 * Give an existing specialist a portal login.
 *
 * This is the only way to do it for a specialist who was added without one —
 * the Type field on the edit sheet is a label and never created anything. What
 * it creates depends on where the specialist is starting from, so the copy says
 * which: an external specialist becomes internal (gaining an employment record),
 * while an internal one who simply never got a password keeps the record they have.
 */
export function GrantLoginDialog({
  specialist,
  open,
  onOpenChange,
  onGranted,
}: GrantLoginDialogProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isSubmitting, submit } = useSubmitGuard()

  // Seed once per open — a refetch while the dialog is up must not wipe a
  // half-typed password, and a cancelled attempt must not leave one behind.
  useSeedOnOpen(open, specialist.id, () => {
    setEmail(specialist.contactEmail ?? '')
    setPassword('')
    setError(null)
  })

  const isExternal = specialist.specialistType === 'external'

  function validate(): string | null {
    if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address.'
    if (password.length < MIN_PASSWORD_LENGTH)
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    return null
  }

  function handleGrant() {
    const problem = validate()
    if (problem) {
      setError(problem)
      return Promise.resolve()
    }
    setError(null)

    return submit(async () => {
      const res = await grantSpecialistLogin(specialist.id, { email: email.trim(), password })
      if (!res.success) {
        // Stay open and keep what was typed: the usual failure is an email that
        // already has a login, which the admin fixes by changing the email.
        setError(res.error ?? 'Could not grant the login.')
        return
      }
      toast.success(`${specialist.name} can now sign in to the portal`)
      onOpenChange(false)
      onGranted()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Grant portal login</DialogTitle>
          <DialogDescription>
            {isExternal
              ? `${specialist.name} is an external specialist. Granting a login makes them an internal specialist: they get a portal login with the Doctor role, and an employment record for payroll and attendance.`
              : `${specialist.name} has no login yet. This creates a portal login with the Doctor role and links it to their existing employment record.`}
          </DialogDescription>
        </DialogHeader>

        {/* noValidate: validation is ours, so a bad email and a short password
            read the same way instead of one getting a browser bubble. */}
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void handleGrant()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="gl-email">Sign-in email</Label>
            <Input
              id="gl-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gl-password">Temporary password</Label>
            <Input
              id="gl-password"
              type="password"
              autoComplete="new-password"
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Share it with them securely and ask them to change it after the first sign-in.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Grant login
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
