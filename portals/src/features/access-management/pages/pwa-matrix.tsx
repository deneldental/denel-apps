import { Loader2, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  PWA_MODULE_GROUPS,
  PWA_MODULE_LABELS,
  RolePermissionMatrix,
} from '@/features/access-management/components/role-permission-matrix'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Switch } from '@/shared/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'

// ── Enabled Modules tab ────────────────────────────────────────────────────────

const ALL_PWA_MODULES = PWA_MODULE_GROUPS.flatMap((g) => g.modules)
const SETTING_KEY = 'pwa_enabled_modules'

function EnabledModulesTab() {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(ALL_PWA_MODULES))
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get<string[] | null>(`/api/settings/kv/${SETTING_KEY}`).then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setEnabled(new Set(res.data))
      }
      // null → key absent → default all enabled
      setLoading(false)
    })
  }, [])

  function toggle(mod: string) {
    setDirty(true)
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(mod)) next.delete(mod)
      else next.add(mod)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    const res = await api.put(`/api/settings/kv/${SETTING_KEY}`, {
      value: Array.from(enabled),
    })
    setSaving(false)
    if (res.success) {
      toast.success('PWA module list saved.')
      setDirty(false)
    } else {
      toast.error(res.error ?? 'Failed to save')
    }
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const disabledCount = ALL_PWA_MODULES.length - enabled.size

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Disabled modules are completely hidden from the PWA for all roles.
          </p>
          {disabledCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {disabledCount} disabled
            </Badge>
          )}
          {dirty && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
              Unsaved changes
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" />
          )}
          Save changes
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        {PWA_MODULE_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="bg-muted/20 border-b border-t px-4 py-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {group.label}
              </span>
            </div>
            {group.modules.map((mod) => {
              const isEnabled = enabled.has(mod)
              return (
                <div
                  key={mod}
                  className="flex items-center justify-between px-4 py-3 border-b last:border-b-0 hover:bg-muted/10 transition-colors"
                >
                  <div>
                    <p
                      className={`text-sm font-medium ${!isEnabled ? 'text-muted-foreground' : ''}`}
                    >
                      {PWA_MODULE_LABELS[mod] ?? mod}
                    </p>
                    {!isEnabled && (
                      <p className="text-xs text-destructive/70 mt-0.5">Blocked from PWA</p>
                    )}
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={() => toggle(mod)}
                    aria-label={`${mod} enabled`}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

type RoleOption = { id: string; name: string }

export default function PwaMatrixPage() {
  const [roles, setRoles] = useState<RoleOption[]>([])

  useEffect(() => {
    api.get<RoleOption[]>('/api/roles').then((res) => {
      if (res.success && res.data) setRoles(res.data)
    })
  }, [])

  return (
    <div className="p-6 space-y-4">
      <Tabs defaultValue="permissions">
        <TabsList>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="enabled-modules">Enabled Modules</TabsTrigger>
        </TabsList>

        <TabsContent value="permissions" className="mt-4">
          {roles.length > 0 ? (
            <RolePermissionMatrix roles={roles} scope="pwa" />
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              Loading roles…
            </div>
          )}
        </TabsContent>

        <TabsContent value="enabled-modules" className="mt-4">
          <EnabledModulesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
