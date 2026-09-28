import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { api } from './api'

export interface PatientUser {
  id: string
  patientId: string | null
  name: string
  email: string | null
  phone: string | null
  dob: string
  gender: string
  category: string
  isChild?: boolean
  isOrtho: boolean
  profileImage?: string | null
}

/** A selectable profile in the family switcher (same shape as the active user). */
export interface PatientProfile extends PatientUser {
  /** Whether this patient has signed the "Patient App Access" consent. */
  consentSigned?: boolean
}

export interface StartLoginResult {
  ok: boolean
  /** false → the phone is not enabled for app access (show the block message). */
  enabled?: boolean
  /** true → an OTP was sent; false → device already trusted, go straight to profiles. */
  requiresOtp?: boolean
  /** Last 4 digits of the destination phone, for display. */
  phoneHint?: string
  error?: string
}

/** The "Patient App Access" consent form returned when a profile needs signing. */
export interface ConsentForm {
  templateId: string
  name: string
  content: string
}

export interface SelectProfileResult {
  ok: boolean
  /** true → the profile needs a signed consent before its session can open. */
  consentRequired?: boolean
  consent?: ConsentForm
  error?: string
}

export interface ConsentPayload {
  /** base64 PNG data URL of the signature. */
  signatureData: string
  signedByName: string
  /** 'self' | 'guardian' | 'spouse' | 'other' */
  relationshipToPatient: string
}

interface PatientAuthContextType {
  /** The active profile, or null when no profile session is established. */
  patient: PatientUser | null
  loading: boolean
  /** Step 1 — submit a phone number. */
  startLogin: (phone: string) => Promise<StartLoginResult>
  /** Step 2 (untrusted device only) — verify the SMS code; trusts the device. */
  verifyOtp: (phone: string, code: string) => Promise<{ ok: boolean; error?: string }>
  /** List the enabled patients reachable from the trusted phone (family switcher). */
  fetchProfiles: () => Promise<PatientProfile[]>
  /** Activate a profile (issues the session). Also used to switch profiles.
   *  May return { consentRequired } if the profile needs a signed consent. */
  selectProfile: (patientId: string) => Promise<SelectProfileResult>
  /** Record the "Patient App Access" consent for a profile, then open its session. */
  signAppConsent: (
    patientId: string,
    payload: ConsentPayload
  ) => Promise<{
    ok: boolean
    error?: string
  }>
  signOut: () => Promise<void>
  /** Merge updates into the cached active patient (e.g. after PATCH /profile). */
  updatePatient: (updates: Partial<PatientUser>) => void
}

const CACHE_KEY = 'patient_auth_user'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 min — stale cache triggers a re-fetch from /me

type CachedEntry = { patient: PatientUser; cachedAt: number }

/**
 * Active-profile cache lives in sessionStorage (cleared on tab close) instead of
 * localStorage so PHI-adjacent fields don't persist forever on shared devices.
 * A 5-minute TTL forces a server re-validate so stale cache can't survive a
 * server-side session revocation.
 *
 * Module-level handle to clear the cache from non-React code (the 401 handler in
 * main.tsx) — set in PatientAuthProvider's mount effect.
 */
let externalClear: (() => void) | null = null
export function clearPatientCache(): void {
  externalClear?.()
}

function getCached(): PatientUser | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const entry = JSON.parse(raw) as Partial<CachedEntry>
    if (!entry?.patient || typeof entry.cachedAt !== 'number') return null
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null
    return entry.patient
  } catch {
    return null
  }
}

function setCached(p: PatientUser | null) {
  try {
    if (p) {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ patient: p, cachedAt: Date.now() }))
    } else {
      sessionStorage.removeItem(CACHE_KEY)
    }
  } catch {
    // sessionStorage disabled / full — fall through silently
  }
}

const PatientAuthContext = createContext<PatientAuthContextType | null>(null)

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [patient, setPatient] = useState<PatientUser | null>(getCached)
  const [loading, setLoading] = useState(true)

  // Expose a cache-clear handle for non-React code (the global 401 handler).
  useEffect(() => {
    externalClear = () => {
      setPatient(null)
      setCached(null)
    }
    return () => {
      externalClear = null
    }
  }, [])

  useEffect(() => {
    // Probe for an existing active-profile session. A 401 here is the normal
    // "no profile selected yet" outcome and must NOT trigger the global
    // session-expired redirect.
    api
      .get<{ patient: PatientUser }>('/api/patient-auth/me', { suppressSessionExpiredHook: true })
      .then((res) => {
        const me = res.patient as PatientUser | undefined
        if (res.success && me) {
          setPatient(me)
          setCached(me)
        } else {
          setPatient(null)
          setCached(null)
        }
      })
      .catch(() => {
        // Network error — keep cached
      })
      .finally(() => setLoading(false))
  }, [])

  const startLogin = async (phone: string): Promise<StartLoginResult> => {
    const res = await api.post(
      '/api/patient-auth/login',
      { phone },
      { suppressSessionExpiredHook: true }
    )
    // Not-enabled block: backend returns { success:false, enabled:false, error }.
    if (res.enabled === false) {
      return { ok: false, enabled: false, error: res.error }
    }
    if (!res.success) {
      return { ok: false, error: res.error ?? 'Sign-in failed' }
    }
    return {
      ok: true,
      requiresOtp: res.requiresOtp === true,
      phoneHint: typeof res.phoneHint === 'string' ? res.phoneHint : undefined,
    }
  }

  const verifyOtp = async (phone: string, code: string) => {
    const res = await api.post(
      '/api/patient-auth/verify-login-otp',
      { phone, code },
      { suppressSessionExpiredHook: true }
    )
    if (res.success) return { ok: true }
    return { ok: false, error: res.error ?? 'Invalid or expired code' }
  }

  const fetchProfiles = async (): Promise<PatientProfile[]> => {
    const res = await api.get<{ profiles: PatientProfile[] }>('/api/patient-auth/profiles', {
      suppressSessionExpiredHook: true,
    })
    const profiles = res.profiles as PatientProfile[] | undefined
    return res.success && Array.isArray(profiles) ? profiles : []
  }

  const selectProfile = async (patientId: string): Promise<SelectProfileResult> => {
    const res = await api.post<{ patient: PatientUser }>(
      '/api/patient-auth/select-profile',
      { patientId },
      { suppressSessionExpiredHook: true }
    )
    if (res.consentRequired) {
      return { ok: false, consentRequired: true, consent: res.consent as ConsentForm | undefined }
    }
    const selected = res.patient as PatientUser | undefined
    if (res.success && selected) {
      setPatient(selected)
      setCached(selected)
      return { ok: true }
    }
    return { ok: false, error: res.error ?? 'Could not open this profile' }
  }

  const signAppConsent = async (patientId: string, payload: ConsentPayload) => {
    const res = await api.post<{ patient: PatientUser }>(
      '/api/patient-auth/sign-app-consent',
      { patientId, ...payload },
      { suppressSessionExpiredHook: true }
    )
    const selected = res.patient as PatientUser | undefined
    if (res.success && selected) {
      setPatient(selected)
      setCached(selected)
      return { ok: true }
    }
    return { ok: false, error: res.error ?? 'Could not record consent' }
  }

  const signOut = async () => {
    const res = await api.post('/api/patient-auth/logout', undefined, {
      suppressSessionExpiredHook: true,
    })
    if (res.success !== false) {
      setPatient(null)
      setCached(null)
    } else {
      throw new Error(res.error ?? 'Failed to sign out. Please check your connection and retry.')
    }
  }

  const updatePatient = (updates: Partial<PatientUser>) => {
    setPatient((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...updates }
      setCached(next)
      return next
    })
  }

  return (
    <PatientAuthContext.Provider
      value={{
        patient,
        loading,
        startLogin,
        verifyOtp,
        fetchProfiles,
        selectProfile,
        signAppConsent,
        signOut,
        updatePatient,
      }}
    >
      {children}
    </PatientAuthContext.Provider>
  )
}

export function usePatientAuth() {
  const ctx = useContext(PatientAuthContext)
  if (!ctx) throw new Error('usePatientAuth must be used within PatientAuthProvider')
  return ctx
}
