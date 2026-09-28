import { Eye } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { SettingsLoadError } from '@/features/settings/components/settings-load-error'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { useKvSetting } from '@/shared/hooks/use-kv-setting'

const KV_KEY = 'module_visibility'

// Modules the admin can hide from the main sidebar. The IDs match each
// module's `id` in /portals/src/app/modules/. Modules NOT listed here (e.g.
// Patients, Finance, Settings) are always visible — hiding them would lock
// the admin out.
export const TOGGLABLE_MODULES: Array<{ id: string; label: string; description: string }> = [
  { id: 'insurance', label: 'Insurance', description: 'Policies, claims, providers' },
  { id: 'labs', label: 'Labs', description: 'Lab orders and results' },
  { id: 'xrays', label: 'X-ray', description: 'X-ray records and sharing' },
  { id: 'compliance', label: 'Compliance', description: 'Compliance documents and audits' },
  { id: 'audit', label: 'Audit', description: 'Audit log viewer' },
  { id: 'analytics', label: 'Analytics', description: 'Charts and analytics dashboard' },
  { id: 'integrations', label: 'Integrations', description: 'Third-party integrations module' },
]

type Visibility = Record<string, boolean>
const EMPTY_VISIBILITY: Visibility = {}

export function ModuleVisibilitySection() {
  const {
    value: visibility,
    setValue: setVisibility,
    loadError,
    canSave,
    save,
    refetch,
  } = useKvSetting<Visibility>(KV_KEY, EMPTY_VISIBILITY)
  const [savingId, setSavingId] = useState<string | null>(null)
  // Keep a ref in sync with state so async handlers always read the latest value,
  // preventing concurrent toggles from overwriting each other's changes.
  const visibilityRef = useRef<Visibility>({})
  useEffect(() => {
    visibilityRef.current = visibility
  }, [visibility])

  // A module is visible unless its toggle is explicitly `false`. Default = visible.
  const isVisible = (id: string) => visibility[id] !== false

  const handleToggle = async (id: string, val: boolean) => {
    setSavingId(id)
    const next = { ...visibilityRef.current, [id]: val }
    try {
      // The hook invalidates queryKeys.settings.kv('module_visibility') — the
      // key the desktop sidebar + mobile drawer (useModuleVisibility) read —
      // so the toggle takes effect without a page reload.
      await save(next)
      setVisibility(next)
      toast.success(
        `${TOGGLABLE_MODULES.find((m) => m.id === id)?.label} ${val ? 'shown' : 'hidden'}`
      )
    } catch {
      toast.error('Failed to save')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <SettingsLoadError error={loadError} onRetry={refetch} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Module Visibility
          </CardTitle>
          <CardDescription>
            Hide modules from the main sidebar. Hidden modules are still accessible by direct URL —
            this only controls what appears in the navigation rail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TOGGLABLE_MODULES.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0">
                <Label htmlFor={`mv-${m.id}`} className="cursor-pointer font-medium">
                  {m.label}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
              </div>
              <Switch
                id={`mv-${m.id}`}
                checked={isVisible(m.id)}
                onCheckedChange={(v) => handleToggle(m.id, v)}
                disabled={!canSave || savingId === m.id}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
