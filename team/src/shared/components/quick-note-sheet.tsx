import { Camera, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'

import { CameraSheet } from './camera-sheet'

interface PatientOption {
  id: string
  patientId: string
  name: string
  phone: string | null
}

const TAGS = ['Urgent', 'Follow-up', 'Consent needed'] as const
type Tag = (typeof TAGS)[number]

export interface QuickNoteSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultPatient?: { id: string; name: string }
  onSubmit?: (note: { patientId: string; body: string; tags: string[] }) => void
}

export function QuickNoteSheet({
  open,
  onOpenChange,
  defaultPatient,
  onSubmit,
}: QuickNoteSheetProps) {
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  const [query, setQuery] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string } | null>(
    defaultPatient ?? null
  )
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [allPatients, setAllPatients] = useState<PatientOption[]>([])

  useEffect(() => {
    if (!open) return
    api.get<{ data: PatientOption[] }>('/api/patients').then((res) => {
      if (res.success && res.data?.data) setAllPatients(res.data.data)
    })
  }, [open])

  // Reset internal state when sheet closes
  useEffect(() => {
    if (!open) {
      setBody('')
      setTags([])
      setQuery('')
      setSelectedPatient(defaultPatient ?? null)
      setPhotoBlob(null)
    }
  }, [open, defaultPatient])

  // Keep selectedPatient in sync when defaultPatient prop changes between opens
  useEffect(() => {
    if (open && defaultPatient) setSelectedPatient(defaultPatient)
  }, [open, defaultPatient])

  // Manage object URL for photo preview
  useEffect(() => {
    if (!photoBlob) {
      setPhotoUrl(null)
      return
    }
    const url = URL.createObjectURL(photoBlob)
    setPhotoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photoBlob])

  const matches = useMemo<PatientOption[]>(() => {
    if (selectedPatient || !query.trim()) return []
    const q = query.trim().toLowerCase()
    return allPatients
      .filter((p) => {
        return (
          p.name.toLowerCase().includes(q) ||
          (p.phone ?? '').includes(q) ||
          p.patientId.toLowerCase().includes(q)
        )
      })
      .slice(0, 5)
  }, [query, selectedPatient, allPatients])

  const toggleTag = (tag: Tag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  const canPost = !!selectedPatient && body.trim().length > 0

  const handlePost = async () => {
    if (!selectedPatient || !body.trim()) return
    const payload = { patientId: selectedPatient.id, body: body.trim(), tags: [...tags] }
    const res = await api.post(`/api/patient-timeline/${selectedPatient.id}`, {
      eventType: 'note',
      title: body.trim(),
      description: tags.length > 0 ? tags.join(', ') : undefined,
    })
    if (res.success) {
      toast.success('Note posted')
    } else {
      toast.error(res.error ?? 'Failed to post note')
    }
    if (onSubmit) onSubmit(payload)
    onOpenChange(false)
  }

  const handleCapture = (blob: Blob) => {
    setPhotoBlob(blob)
    setCameraOpen(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[85vh] flex flex-col p-0 gap-0"
          aria-describedby={undefined}
          onInteractOutside={(e) => {
            if (cameraOpen) e.preventDefault()
          }}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-4 py-3">
            <SheetTitle>Quick note</SheetTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Patient
              </p>
              {selectedPatient ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
                  {selectedPatient.name}
                  {!defaultPatient && (
                    <button
                      type="button"
                      onClick={() => setSelectedPatient(null)}
                      aria-label="Clear patient"
                      className="rounded-full hover:bg-primary/20 p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder="Search patient by name, phone or ID..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {matches.length > 0 && (
                    <div className="rounded-md border border-border divide-y divide-border bg-card">
                      {matches.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setSelectedPatient({ id: p.id, name: p.name })
                            setQuery('')
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-accent transition-colors"
                        >
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            #{p.patientId}
                            {p.phone ? ` · ${p.phone}` : ''}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Note
              </p>
              <Textarea
                rows={4}
                placeholder="What did you observe?"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Tags
              </p>
              <div className="flex flex-wrap gap-2">
                {TAGS.map((t) => {
                  const on = tags.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        on
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border-border hover:bg-accent'
                      }`}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCameraOpen(true)}>
                <Camera className="h-4 w-4 mr-2" /> Attach photo
              </Button>
              {photoUrl && (
                <div className="relative inline-block">
                  <img
                    src={photoUrl}
                    alt="Attached"
                    className="h-20 w-20 object-cover rounded-md border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotoBlob(null)}
                    aria-label="Remove photo"
                    className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5 shadow"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 z-10 border-t bg-background px-4 py-3 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={!canPost} onClick={handlePost}>
              Post note
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <CameraSheet
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        facingMode="environment"
        title="Attach photo"
        onCapture={handleCapture}
      />
    </>
  )
}
