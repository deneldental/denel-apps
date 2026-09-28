import { useQueryClient } from '@tanstack/react-query'
import { Cloud, KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  type GoogleAuthMethod,
  getActiveAuthMethod,
  setActiveAuthMethod,
} from '@/lib/actions/google-calendar'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'

interface Props {
  /** Fires after a successful toggle so siblings can refresh their state. */
  onChange?: (method: GoogleAuthMethod) => void
}

// NOTE: this key literal is duplicated (deliberately — see query.ts docs on
// local module-scoped keys) in `pages/google-calendar.tsx`, which reads the
// same `/api/google-calendar/auth-method` endpoint for page-level gating.
// Keep the two in sync so both observers share one cache entry.
const AUTH_METHOD_KEY = ['integrations', 'google-calendar', 'auth-method'] as const

export function GoogleAuthMethodSelector({ onChange }: Props) {
  const query = useApiQuery(AUTH_METHOD_KEY, getActiveAuthMethod)
  const method = query.data?.method ?? null
  const loading = query.isLoading
  const [forbidden, setForbidden] = useState(false)

  const queryClient = useQueryClient()
  const switchMutation = useApiMutation(setActiveAuthMethod, { invalidates: [AUTH_METHOD_KEY] })
  const switching = switchMutation.isPending

  async function toggle(next: GoogleAuthMethod) {
    if (switching || next === method) return
    try {
      const data = await switchMutation.mutateAsync(next)
      // Reflect the switch immediately rather than waiting on the
      // invalidate-triggered background refetch.
      queryClient.setQueryData(AUTH_METHOD_KEY, data)
      toast.success(`Switched to ${next === 'oauth' ? 'OAuth' : 'Service Account'}`)
      onChange?.(data.method)
    } catch (err) {
      if (err instanceof Error && /forbidden/i.test(err.message)) {
        setForbidden(true)
        toast.error('Only admins can change the auth method')
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to switch')
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Authentication method</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <MethodTile
              icon={<KeyRound className="h-4 w-4" />}
              label="OAuth (per-doctor)"
              description="Each doctor connects their own Google account. Events land in their own primary calendar."
              isActive={method === 'oauth'}
              disabled={switching || forbidden}
              onClick={() => toggle('oauth')}
              busy={switching && method !== 'oauth'}
            />
            <MethodTile
              icon={<Cloud className="h-4 w-4" />}
              label="Service Account"
              description="A single service-account credential writes every appointment to one shared clinic calendar."
              isActive={method === 'service_account'}
              disabled={switching || forbidden}
              onClick={() => toggle('service_account')}
              busy={switching && method !== 'service_account'}
            />
          </div>
        )}
        {forbidden && (
          <p className="mt-3 text-xs text-muted-foreground">
            Read-only view. Switching requires the admin role.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

interface MethodTileProps {
  icon: React.ReactNode
  label: string
  description: string
  isActive: boolean
  disabled: boolean
  busy: boolean
  onClick: () => void
}

function MethodTile({
  icon,
  label,
  description,
  isActive,
  disabled,
  busy,
  onClick,
}: MethodTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'text-left rounded-lg border p-3 transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        isActive
          ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30'
          : 'border-border hover:bg-muted/50',
      ].join(' ')}
      aria-pressed={isActive}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-sm">
          {icon}
          {label}
        </div>
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : isActive ? (
          <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            Active
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground leading-snug">{description}</p>
    </button>
  )
}
