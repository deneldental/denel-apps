import { BellOff, BellRing, Info, Music, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type AppointmentAlertConfig,
  getAppointmentAlertConfig,
  setAppointmentAlertConfig,
} from '@/lib/actions/settings'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { isSameStoredFile } from '@/shared/lib/file-name'
import { uploadAudio } from '@/shared/lib/upload-blob'

const MAX_SOUND_BYTES = 5_000_000 // 5MB — file is uploaded to R2, not stored as base64

const ALERT_CONFIG_KEY = queryKeys.settings.appointmentAlertConfig()

export function AlertsSection() {
  const [enabled, setEnabled] = useState(true)
  const [duration, setDuration] = useState<string>('30')
  const [soundDataUrl, setSoundDataUrl] = useState<string | null>(null)
  const [soundName, setSoundName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLAudioElement>(null)

  const configQuery = useApiQuery<AppointmentAlertConfig>(ALERT_CONFIG_KEY, () =>
    getAppointmentAlertConfig()
  )
  const isLoading = configQuery.isLoading

  // Fill the form from the first data only. This config is refetched on focus
  // and polled every 5 minutes by the alarm monitor — and its sound's link is
  // re-signed every 15 — so re-filling on every refetch undid unsaved edits.
  // Later refetches only refresh the sound's link, if the user kept that sound.
  const seeded = useRef(false)
  useEffect(() => {
    const data = configQuery.data
    if (!data) return
    if (!seeded.current) {
      seeded.current = true
      setEnabled(data.enabled !== false)
      setDuration(String(data.durationMinutes))
      setSoundDataUrl(data.soundDataUrl)
      setSoundName(data.soundName)
      return
    }
    setSoundDataUrl((current) =>
      current && data.soundDataUrl && isSameStoredFile(current, data.soundDataUrl)
        ? data.soundDataUrl
        : current
    )
  }, [configQuery.data])

  useEffect(() => {
    if (configQuery.isError)
      toast.error(configQuery.error.message || 'Failed to load alert settings')
  }, [configQuery.isError, configQuery.error])

  const saveMutation = useApiMutation(
    (config: AppointmentAlertConfig) => setAppointmentAlertConfig(config),
    { invalidates: [ALERT_CONFIG_KEY] }
  )
  const isSaving = saveMutation.isPending

  const [isUploading, setIsUploading] = useState(false)

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('audio/')) {
      toast.error('Please select an audio file')
      return
    }
    if (file.size > MAX_SOUND_BYTES) {
      toast.error(`Sound file is too large. Max ${Math.round(MAX_SOUND_BYTES / 1024 / 1024)}MB.`)
      return
    }
    setIsUploading(true)
    try {
      const url = await uploadAudio(file)
      setSoundDataUrl(url)
      setSoundName(file.name)
      toast.success('Sound uploaded')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to upload sound')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemoveSound = () => {
    setSoundDataUrl(null)
    setSoundName(null)
  }

  const handleSave = async () => {
    const num = Number(duration)
    if (!Number.isFinite(num) || num < 1) {
      toast.error('Please enter a duration of 1 minute or more')
      return
    }
    const config: AppointmentAlertConfig = {
      enabled,
      durationMinutes: Math.floor(num),
      soundDataUrl,
      soundName,
    }
    try {
      await saveMutation.mutateAsync(config)
      toast.success('Alert settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                {enabled ? (
                  <BellRing className="h-5 w-5" />
                ) : (
                  <BellOff className="h-5 w-5 text-muted-foreground" />
                )}
                Pre-Appointment Alert
              </CardTitle>
              <CardDescription className="mt-1">
                Notify staff a set number of minutes before each scheduled appointment. The alert
                persists on screen and rings until acknowledged.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant={enabled ? 'destructive' : 'outline'}
              size="sm"
              className="shrink-0"
              disabled={isLoading || isSaving}
              onClick={() => setEnabled((v) => !v)}
            >
              {enabled ? (
                <>
                  <BellOff className="mr-1.5 h-3.5 w-3.5" />
                  Disable
                </>
              ) : (
                <>
                  <BellRing className="mr-1.5 h-3.5 w-3.5" />
                  Enable
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className={`space-y-6 ${!enabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex max-w-xs flex-col gap-2">
              <Label htmlFor="alert-duration">Notify how many minutes before appointment</Label>
              <Input
                id="alert-duration"
                type="number"
                min={1}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={isLoading || !enabled}
                placeholder="30"
              />
              <p className="text-xs text-muted-foreground">Default is 30 minutes.</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Alert sound (ring tone)</Label>
              <p className="text-xs text-muted-foreground">
                Upload an audio file (mp3, wav, ogg). It will loop until the user clicks
                &ldquo;Reviewed&rdquo; on the alert. Max 5 MB.
              </p>

              {soundDataUrl ? (
                <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <Music className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{soundName ?? 'Custom sound'}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveSound}
                      disabled={isLoading || isSaving}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                  {/* biome-ignore lint/a11y/useMediaCaption: ringtone preview */}
                  <audio ref={previewRef} controls src={soundDataUrl} className="w-full" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No custom sound uploaded.</p>
              )}

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={handleFilePick}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || isSaving || isUploading}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {isUploading ? 'Uploading…' : soundDataUrl ? 'Replace sound' : 'Upload sound'}
                </Button>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isLoading || isSaving}>
              {isSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Allow sound on this site
          </CardTitle>
          <CardDescription>
            Browsers block audio from playing automatically until you grant the site permission.
            Each staff member needs to do this once per browser. After that, the alert ringtone will
            play every time without further action.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">Chrome / Edge</p>
            <ol className="ml-5 mt-1 list-decimal space-y-1 text-muted-foreground">
              <li>Click the lock / tune icon to the left of the address bar.</li>
              <li>
                Choose <span className="font-medium">Site settings</span>.
              </li>
              <li>
                Set <span className="font-medium">Sound</span> to{' '}
                <span className="font-medium">Allow</span>.
              </li>
              <li>Reload the page.</li>
            </ol>
          </div>
          <div>
            <p className="font-medium">Firefox</p>
            <ol className="ml-5 mt-1 list-decimal space-y-1 text-muted-foreground">
              <li>Click the lock icon to the left of the address bar.</li>
              <li>
                Find <span className="font-medium">Autoplay</span> and choose{' '}
                <span className="font-medium">Allow Audio and Video</span>.
              </li>
              <li>Reload the page.</li>
            </ol>
          </div>
          <div>
            <p className="font-medium">Safari (macOS)</p>
            <ol className="ml-5 mt-1 list-decimal space-y-1 text-muted-foreground">
              <li>
                Open <span className="font-medium">Safari → Settings → Websites → Auto-Play</span>.
              </li>
              <li>
                Find this site and choose <span className="font-medium">Allow All Auto-Play</span>.
              </li>
              <li>Reload the page.</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
