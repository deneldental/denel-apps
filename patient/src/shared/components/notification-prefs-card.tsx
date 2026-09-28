import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  getCurrentSubscription,
  getPushPermission,
  isPushSupported,
  type PushPermissionState,
  sendTestNotification,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/shared/lib/push-notifications'

export interface NotificationPrefItem {
  id: string
  label: string
  description?: string
  disabled?: boolean
  disabledCaption?: string
}

interface Props {
  storageKey: string
  items: NotificationPrefItem[]
}

type PrefsState = Record<string, boolean>

export function NotificationPrefsCard({ storageKey, items }: Props) {
  const [prefs, setPrefs] = useState<PrefsState>(() => readPrefs(storageKey, items))
  const [pushState, setPushState] = useState<PushPermissionState>(() => getPushPermission())
  const [subscribed, setSubscribed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)

  // Reflect the REAL subscription state on this device — granting permission
  // once isn't the same as having an active subscription (the patient may have
  // turned it off, or never finished subscribing).
  useEffect(() => {
    setPushState(getPushPermission())
    getCurrentSubscription()
      .then((sub) => setSubscribed(!!sub))
      .catch(() => setSubscribed(false))
  }, [])

  const writePrefs = (next: PrefsState) => {
    setPrefs(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // ignore quota errors
    }
  }

  const togglePush = async (enable: boolean) => {
    setPushBusy(true)
    try {
      if (enable) {
        const sub = await subscribeToPush()
        if (sub) {
          toast.success('Push notifications enabled')
          setPushState('granted')
          setSubscribed(true)
        } else {
          toast.error('Permission denied')
          setPushState('denied')
          setSubscribed(false)
        }
      } else {
        await unsubscribeFromPush()
        toast.success('Push notifications disabled')
        setSubscribed(false)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update push')
    } finally {
      setPushBusy(false)
    }
  }

  const pushSupported = isPushSupported()
  const pushChecked = subscribed
  const pushDisabled = !pushSupported || pushState === 'denied' || pushBusy

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Notifications</h3>
        </div>

        <div className="flex items-center justify-between gap-3 py-2 border-b border-border">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Push notifications</p>
            <p className="text-xs text-muted-foreground">
              {!pushSupported
                ? 'Not supported on this device'
                : pushState === 'denied'
                  ? 'Blocked — enable in browser settings'
                  : 'In-app alerts on this device'}
            </p>
          </div>
          <Switch
            checked={pushChecked}
            onCheckedChange={(c) => togglePush(c)}
            disabled={pushDisabled}
          />
        </div>

        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 py-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{item.label}</p>
              {(item.description || item.disabledCaption) && (
                <p className="text-xs text-muted-foreground">
                  {item.disabled ? (item.disabledCaption ?? 'Coming soon') : item.description}
                </p>
              )}
            </div>
            <Switch
              checked={prefs[item.id] ?? false}
              onCheckedChange={(c) => writePrefs({ ...prefs, [item.id]: c })}
              disabled={item.disabled}
            />
          </div>
        ))}

        {import.meta.env.DEV && pushChecked && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full mt-2"
            onClick={async () => {
              const ok = await sendTestNotification({
                title: 'Denel test',
                body: 'This is a local test notification.',
                tag: 'test',
              })
              if (!ok) toast.error('Could not show a notification on this device')
            }}
          >
            Send test notification
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function readPrefs(key: string, items: NotificationPrefItem[]): PrefsState {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as PrefsState
  } catch {
    // ignore parse errors
  }
  return Object.fromEntries(items.map((i) => [i.id, !i.disabled]))
}
