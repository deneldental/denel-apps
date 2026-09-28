import { Loader2, Mail, MapPin, Phone } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'

interface PublicClinic {
  name?: string
  phones?: string[]
  email?: string | null
  address?: string | null
}

// Session cache so the dialog doesn't re-fetch every open.
let cachedClinic: PublicClinic | null = null

/**
 * "Contact the clinic" — opens a dialog of clinic contact details fetched from
 * the public branding endpoint (configured in the portal/HR brand integrations).
 * Fetches lazily on first open. Renders its own inline trigger button.
 */
export function ClinicContactDialog() {
  const [open, setOpen] = useState(false)
  const [clinic, setClinic] = useState<PublicClinic | null>(cachedClinic)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || clinic) return
    setLoading(true)
    api
      .get<PublicClinic>('/api/integrations/branding/public', { suppressSessionExpiredHook: true })
      .then((res) => {
        if (res.success && res.data) {
          cachedClinic = res.data as PublicClinic
          setClinic(cachedClinic)
        }
      })
      .finally(() => setLoading(false))
  }, [open, clinic])

  // Each entry may bundle several numbers (e.g. "024… | 059…") — split them out.
  const phones = (clinic?.phones ?? [])
    .flatMap((p) => p.split(/[|/,]/))
    .map((p) => p.trim())
    .filter(Boolean)
  const hasContact = phones.length > 0 || !!clinic?.email || !!clinic?.address

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="font-medium text-white underline underline-offset-2 transition-opacity hover:opacity-80"
        >
          Contact the clinic
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{clinic?.name ?? 'Contact the clinic'}</DialogTitle>
          <DialogDescription>We’re here to help — reach us any of these ways.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : hasContact ? (
          <div className="space-y-2">
            {phones.map((p) => (
              <a
                key={p}
                href={`tel:${p.replace(/\s+/g, '')}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm transition-colors hover:bg-accent"
              >
                <Phone className="h-4 w-4 shrink-0 text-brand" />
                <span className="font-medium">{p}</span>
              </a>
            ))}
            {clinic?.email && (
              <a
                href={`mailto:${clinic.email}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm transition-colors hover:bg-accent"
              >
                <Mail className="h-4 w-4 shrink-0 text-brand" />
                <span className="truncate font-medium">{clinic.email}</span>
              </a>
            )}
            {clinic?.address && (
              <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <span>{clinic.address}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Contact details aren’t available right now. Please visit the clinic.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
