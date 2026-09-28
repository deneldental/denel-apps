import { format } from 'date-fns'
import { Camera, Loader2, LogOut, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { usePatientAuth } from '@/lib/patient-auth'
import { AvatarCropperDialog } from '@/shared/components/avatar-cropper-dialog'
import { NotificationPrefsCard } from '@/shared/components/notification-prefs-card'

export default function PatientProfilePage() {
  const { patient, signOut, updatePatient } = usePatientAuth()
  const navigate = useNavigate()
  // Local preview shown only between crop and upload completion. Once the upload
  // resolves and patient.profileImage is set, we render that URL instead so the
  // picture survives navigation and reload.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  // File the user picked, fed into the cropper.
  const [cropSource, setCropSource] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset the input so picking the same file again re-triggers change.
    e.target.value = ''
    if (file) setCropSource(file)
  }

  async function handleCropped(blob: Blob) {
    if (!patient) return
    const local = URL.createObjectURL(blob)
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return local
    })
    setCropSource(null)
    setUploadingPhoto(true)

    try {
      const ext = blob.type === 'image/png' ? 'png' : 'jpg'
      const file =
        blob instanceof File
          ? blob
          : new File([blob], `${Date.now()}.${ext}`, {
              type: blob.type || 'image/jpeg',
            })

      // Patient-scoped avatar upload: the backend derives the storage path from
      // the session patient id and sets profileImage atomically (no separate
      // PATCH). The old /api/upload route is staff-only and 401s for patients.
      const formData = new FormData()
      formData.append('file', file)

      const uploadRes = await api.post<{ url: string }>('/api/patient-portal/avatar', formData)
      if (!uploadRes.success || !uploadRes.data?.url) {
        toast.error(uploadRes.error || 'Upload failed')
        return
      }

      updatePatient({ profileImage: uploadRes.data.url })
      // Drop the local preview now that we have the persisted URL.
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      toast.success('Profile photo updated')
    } catch (err) {
      console.error('[patient avatar upload]', err)
      toast.error('Profile photo upload failed')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const photoUrl = previewUrl ?? patient?.profileImage ?? null

  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    navigate('/login', { replace: true })
  }

  if (!patient) return null

  return (
    <div className="p-5 pb-8 space-y-6">
      <div className="pt-4">
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your account information</p>
      </div>

      {/* Patient info card */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-4">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={patient.name}
              width={56}
              height={56}
              loading="lazy"
              decoding="async"
              className="h-14 w-14 rounded-full object-cover border border-border"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary text-2xl font-bold">
              {patient.name[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-lg truncate">{patient.name}</p>
            <p className="text-xs font-mono text-muted-foreground">{patient.patientId}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
            >
              {uploadingPhoto ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="mr-1 h-3.5 w-3.5" />
              )}
              {uploadingPhoto ? 'Uploading…' : 'Change photo'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {patient.phone && (
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Phone</p>
              <p className="font-medium">{patient.phone}</p>
            </div>
          )}
          {patient.email && (
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Email</p>
              <p className="font-medium truncate">{patient.email}</p>
            </div>
          )}
          {patient.dob && (
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Date of Birth
              </p>
              <p className="font-medium">{format(new Date(patient.dob), 'MMM d, yyyy')}</p>
            </div>
          )}
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Gender</p>
            <p className="font-medium capitalize">{patient.gender}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Category</p>
            <p className="font-medium capitalize">{patient.category.replace('_', ' ')}</p>
          </div>
          {patient.isOrtho && (
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Type</p>
              <p className="font-medium">Orthodontic</p>
            </div>
          )}
        </div>
      </div>

      {/* Switch profile (family members on this phone) */}
      <button
        type="button"
        onClick={() => navigate('/patient/switch')}
        className="w-full flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Switch profile</span>
        </div>
        <span className="text-xs text-muted-foreground">Change</span>
      </button>

      {/* Notification preferences */}
      <NotificationPrefsCard
        storageKey="patient-notification-prefs"
        items={[
          { id: 'sms', label: 'SMS' },
          { id: 'email', label: 'Email' },
          { id: 'whatsapp', label: 'WhatsApp', disabled: true, disabledCaption: 'Coming soon' },
        ]}
      />

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        className="w-full flex items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 py-3.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-60"
      >
        {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        {signingOut ? 'Signing out...' : 'Sign Out'}
      </button>

      {/* Hidden file input — gallery/file upload only (no camera). */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFilePicked}
      />
      <AvatarCropperDialog
        open={!!cropSource}
        onOpenChange={(o) => !o && setCropSource(null)}
        source={cropSource}
        onCropped={handleCropped}
      />
    </div>
  )
}
