import { ChevronRight, Loader2, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { type ConsentForm, type PatientProfile, usePatientAuth } from '@/lib/patient-auth'
import { ConsentScreen } from './consent-screen'

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * The family profile switcher. Lists every enabled patient reachable from the
 * trusted phone and activates the chosen one. Used both at the end of login and
 * from the in-app "Switch profile" screen. `onSelected` fires after a profile's
 * session is established.
 */
export function ProfilePicker({ onSelected }: { onSelected: () => void }) {
  const { fetchProfiles, selectProfile } = usePatientAuth()
  const [profiles, setProfiles] = useState<PatientProfile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Set when a chosen profile needs to sign the app-access consent first.
  const [consentFor, setConsentFor] = useState<{
    patientId: string
    consent: ConsentForm
    isChild: boolean
  } | null>(null)

  useEffect(() => {
    let alive = true
    fetchProfiles()
      .then((list) => {
        if (alive) setProfiles(list)
      })
      .catch(() => {
        if (alive) setProfiles([])
      })
    return () => {
      alive = false
    }
  }, [fetchProfiles])

  async function pick(p: PatientProfile) {
    setBusyId(p.id)
    setError(null)
    const res = await selectProfile(p.id)
    setBusyId(null)
    if (res.ok) {
      onSelected()
      return
    }
    if (res.consentRequired && res.consent) {
      setConsentFor({ patientId: p.id, consent: res.consent, isChild: !!p.isChild })
      return
    }
    setError(res.error ?? 'Could not open this profile')
  }

  // A profile was chosen but needs consent — show the signing screen.
  if (consentFor) {
    return (
      <ConsentScreen
        consent={consentFor.consent}
        patientId={consentFor.patientId}
        defaultGuardian={consentFor.isChild}
        onSigned={onSelected}
        onCancel={() => setConsentFor(null)}
      />
    )
  }

  if (profiles === null) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (profiles.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-center">
        <UserRound className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No profiles are enabled for this number. Please contact the clinic.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      <div className="space-y-2">
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={busyId !== null}
            onClick={() => pick(p)}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent disabled:opacity-60"
          >
            <Avatar className="h-11 w-11">
              {p.profileImage && <AvatarImage src={p.profileImage} alt={p.name} />}
              <AvatarFallback>{initials(p.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name}</p>
              {p.patientId && (
                <p className="truncate text-xs text-muted-foreground">{p.patientId}</p>
              )}
            </div>
            {busyId === p.id ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
