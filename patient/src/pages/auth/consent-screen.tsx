import { Loader2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type ConsentForm, usePatientAuth } from '@/lib/patient-auth'
import { SignaturePad } from './signature-pad'

const RELATIONSHIPS = [
  { value: 'self', label: 'Myself' },
  { value: 'guardian', label: 'Parent / Guardian' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'other', label: 'Other' },
]

/**
 * Gate 2 — the "Patient App Access" consent. Shown when a profile has no signed
 * consent on file. On submit it records the signature and opens the session.
 * For a minor the relationship defaults to Parent/Guardian.
 */
export function ConsentScreen({
  consent,
  patientId,
  defaultGuardian,
  onSigned,
  onCancel,
}: {
  consent: ConsentForm
  patientId: string
  defaultGuardian: boolean
  onSigned: () => void
  onCancel: () => void
}) {
  const { signAppConsent } = usePatientAuth()
  const [name, setName] = useState('')
  const [relationship, setRelationship] = useState(defaultGuardian ? 'guardian' : 'self')
  const [signature, setSignature] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!agreed) return setError('Please tick the box to agree.')
    if (!name.trim()) return setError('Please enter your full name.')
    if (!signature) return setError('Please sign in the box.')
    setError(null)
    setSubmitting(true)
    const res = await signAppConsent(patientId, {
      signatureData: signature,
      signedByName: name.trim(),
      relationshipToPatient: relationship,
    })
    setSubmitting(false)
    if (res.ok) onSigned()
    else setError(res.error ?? 'Could not record consent')
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{consent.name}</h2>
        <p className="text-sm text-muted-foreground">Please review and sign to continue.</p>
      </div>

      <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
        {consent.content}
      </div>

      <div className="space-y-2">
        <Label htmlFor="signer-rel">I am signing as</Label>
        <select
          id="signer-rel"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {RELATIONSHIPS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="signer-name">Full name</Label>
        <Input
          id="signer-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Signature</Label>
        <SignaturePad onChange={setSignature} />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="text-muted-foreground">
          I have read and agree to the Patient App Access consent above.
        </span>
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Agree & continue
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Back
        </button>
      </div>
    </form>
  )
}
