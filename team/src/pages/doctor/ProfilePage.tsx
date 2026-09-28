import { NavCard } from '@denel/ui/blocks'
import { CalendarClock, Camera, LogOut } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { staffApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { CameraSheet } from '@/shared/components/camera-sheet'
import { NotificationPrefsCard } from '@/shared/components/notification-prefs-card'

export default function DoctorProfilePage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [cameraOpen, setCameraOpen] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(user?.image ?? null)

  const initials = (user?.name ?? 'D R')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const handlePhotoCapture = async (blob: Blob) => {
    setCameraOpen(false)
    // Optimistic local preview while the upload runs.
    const preview = URL.createObjectURL(blob)
    setPhotoUrl(preview)
    const res = await staffApi.uploadAvatar(blob)
    const url = (res as { url?: string }).url
    if (res.success && url) {
      setPhotoUrl(url)
      toast.success('Photo updated')
    } else {
      toast.error(res.error || 'Failed to save photo')
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="p-5 pb-8 space-y-5">
      <Card>
        <CardContent className="p-5 flex items-center gap-3">
          <Avatar className="h-14 w-14">
            {photoUrl && <AvatarImage src={photoUrl} alt={user?.name ?? ''} />}
            <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold leading-tight">Dr {user?.name ?? 'Doctor'}</h1>
            <p className="text-sm text-muted-foreground truncate">{user?.email ?? '—'}</p>
            <Badge variant="secondary" className="mt-1">
              Doctor
            </Badge>
          </div>
        </CardContent>
      </Card>

      <NavCard
        tone="indigo"
        icon={CalendarClock}
        title="My schedule"
        subtitle="Today's appointments"
        to="/doctor/today"
      />

      <NotificationPrefsCard
        storageKey="doctor-notification-prefs"
        items={[
          { id: 'patientCheckedIn', label: 'Patient checked in' },
          { id: 'appointmentSoon', label: 'Appointment starting in 5 min' },
          { id: 'labReady', label: 'Lab case ready for delivery' },
          { id: 'dailySummary', label: 'Daily summary' },
        ]}
      />

      <Button variant="outline" className="w-full" onClick={() => setCameraOpen(true)}>
        <Camera className="h-4 w-4 mr-2" /> Update profile photo
      </Button>

      <Button variant="outline" className="w-full" onClick={handleSignOut}>
        <LogOut className="h-4 w-4 mr-2" /> Sign out
      </Button>

      <CameraSheet
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        facingMode="user"
        title="Profile photo"
        onCapture={handlePhotoCapture}
      />
    </div>
  )
}
