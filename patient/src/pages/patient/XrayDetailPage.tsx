import { format } from 'date-fns'
import { ArrowLeft, ImageOff, Loader2, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

interface ApiXray {
  id: string
  type: string
  imageUrl: string
  thumbnailUrl: string
  takenAt: string // ISO
  toothNumbers: number[]
  notes: string | null
  source: string
}

export default function PatientXrayDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [xray, setXray] = useState<ApiXray | null>(null)
  const [loading, setLoading] = useState(true)
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    api
      .get<ApiXray>(`/api/patient-portal/xrays/${id}`)
      .then((res) => {
        if (res.success && res.data) setXray(res.data)
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )

  if (!xray) {
    return (
      <div className="p-5 pb-8 space-y-4">
        <div className="pt-4 flex flex-col items-center gap-3 py-16 text-center">
          <ImageOff className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground">X-ray not found.</p>
          <Link
            to="/patient/xrays"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to X-rays
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-8">
      <div className="px-5 pt-4">
        <Link
          to="/patient/xrays"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>
      </div>

      <div className="mt-3 w-full bg-neutral-900 dark:bg-black aspect-[4/3] flex items-center justify-center overflow-hidden">
        {imgFailed ? (
          <div className="flex flex-col items-center gap-2 text-neutral-400">
            <ImageOff className="h-8 w-8" />
            <p className="text-xs">Image unavailable</p>
          </div>
        ) : (
          <img
            src={xray.imageUrl}
            alt={`${xray.type} X-ray taken ${xray.takenAt}`}
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>

      <div className="px-5 mt-5 space-y-5">
        <section className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Date taken
            </p>
            <p className="text-sm font-semibold mt-0.5">
              {format(new Date(xray.takenAt), 'EEEE, MMM d, yyyy · h:mm a')}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Type
            </p>
            <Badge variant="secondary" className="mt-1 capitalize">
              {xray.type}
            </Badge>
          </div>

          {xray.toothNumbers && xray.toothNumbers.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Teeth
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {xray.toothNumbers.map((t) => (
                  <span
                    key={t}
                    className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-full bg-muted px-2 text-xs font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {xray.notes && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Clinician notes
              </p>
              <p className="mt-1 text-sm leading-relaxed">{xray.notes}</p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Share with another clinician</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Generate a secure link to share this X-ray with your specialist.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => toast.info('Share feature coming soon')}
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>
        </section>
      </div>
    </div>
  )
}
