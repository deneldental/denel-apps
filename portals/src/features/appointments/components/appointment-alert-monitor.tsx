import { format } from 'date-fns'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getAppointmentAlertConfig } from '@/lib/actions/settings'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { isSameStoredFile } from '@/shared/lib/file-name'

type AlertAppointment = {
  id: string
  date: string
  type: string
  patientName: string
  patientId: string
  doctorName: string | null
}

const POLL_MS = 60_000
const CONFIG_REFRESH_MS = 5 * 60_000

// Session-scoped set of `${id}@${isoDate}` keys we've already toasted so we
// don't repeat in the same session. Including the date means a reschedule of
// the same appointment row produces a fresh alert when its new time approaches.
const alerted = new Set<string>()

export function AppointmentAlertMonitor() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingCountRef = useRef(0)

  const ensureAudio = useCallback((url: string | null): HTMLAudioElement | null => {
    if (!url) return null
    const current = audioRef.current
    if (!current || current.src !== url) {
      // The sound's link is re-signed every 15 minutes. While it is ringing,
      // keep the ringing element — replacing it would leave it looping with
      // nothing able to stop it. Otherwise swap in the fresh link, silencing
      // the old element first.
      if (current && !current.paused && isSameStoredFile(current.src, url)) return current
      current?.pause()
      const el = new Audio(url)
      el.loop = true
      audioRef.current = el
    }
    return audioRef.current
  }, [])

  const stopRinging = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
  }, [])

  // Shares its cache entry with settings/components/alerts-section.tsx, so
  // saving a new duration/sound there refetches this immediately instead of
  // waiting up to CONFIG_REFRESH_MS for the next poll.
  const configQuery = useApiQuery(
    queryKeys.settings.appointmentAlertConfig(),
    () => getAppointmentAlertConfig(),
    { refetchInterval: CONFIG_REFRESH_MS }
  )
  const minutes = configQuery.data?.durationMinutes ?? 30
  const soundDataUrl = configQuery.data?.soundDataUrl ?? null

  // Give the initial config fetch a moment before the first alert check, same
  // as the original 5s delayed first poll.
  const [alertsEnabled, setAlertsEnabled] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setAlertsEnabled(true), 5_000)
    return () => clearTimeout(t)
  }, [])

  const alertsQuery = useApiQuery(
    ['appointments', 'upcoming-alerts', minutes] as const,
    () => api.get<AlertAppointment[]>(`/api/appointments/upcoming-alerts?minutes=${minutes}`),
    { enabled: alertsEnabled, refetchInterval: POLL_MS }
  )

  useEffect(() => {
    const list = alertsQuery.data
    if (!list) return

    for (const appt of list) {
      const key = `${appt.id}@${new Date(appt.date).toISOString()}`
      if (alerted.has(key)) continue
      alerted.add(key)

      const time = format(new Date(appt.date), 'h:mm a')
      const doctor = appt.doctorName ? `Dr. ${appt.doctorName.replace(/^Dr\.?\s*/i, '')}` : 'doctor'

      pendingCountRef.current += 1
      const audio = ensureAudio(soundDataUrl)
      if (audio) {
        audio.currentTime = 0
        audio.play().catch(() => {})
      }

      let acknowledged = false
      const ack = () => {
        if (acknowledged) return
        acknowledged = true
        pendingCountRef.current = Math.max(0, pendingCountRef.current - 1)
        if (pendingCountRef.current === 0) stopRinging()
      }

      toast.warning(`Appointment in ~${minutes} min — ${appt.patientName}`, {
        description: `${time} with ${doctor} · ${appt.type || 'Consultation'}`,
        duration: Number.POSITIVE_INFINITY,
        dismissible: false,
        action: {
          label: 'Reviewed',
          onClick: ack,
        },
        onDismiss: ack,
      })
    }
  }, [alertsQuery.data, ensureAudio, soundDataUrl, stopRinging, minutes])

  useEffect(() => stopRinging, [stopRinging])

  return null
}
