import { Button, Checkbox, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@denel/ui'
import { Info, Loader2, Save, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { StatusBadge } from '@/shared/components/status-badge'

// Ported from the portal's Access Management. Read/Write-per-module editor for a
// role's permission matrix, per scope (portal | pwa). Admin is filtered out
// (always full access). Writing switches the (role, scope) to matrix mode.

interface PermissionRow {
  id: string
  module: string
  action: string
  description: string | null
  granted: boolean
}

interface MatrixData {
  roleId: string
  mode: 'matrix' | 'bundle' | 'inherited'
  scope: 'portal' | 'pwa'
  permissions: PermissionRow[]
}

interface RoleOption {
  id: string
  name: string
}

// ── Module grouping ────────────────────────────────────────────────────────────

const MODULE_GROUPS: { label: string; modules: string[] }[] = [
  {
    label: 'Clinical',
    modules: ['patients', 'medical_records', 'ortho_consent', 'insurance', 'xrays', 'labs'],
  },
  { label: 'Appointments', modules: ['appointments'] },
  {
    label: 'Finance',
    modules: [
      'payments',
      'payment_plans',
      'expenses',
      'financial_records',
      'ledger_adjustments',
      'accounts',
      'journal_entries',
      'credit_notes',
      'bills',
      'suppliers',
      'specialists',
      'commissions',
      'tax_calculations',
    ],
  },
  {
    label: 'HR & Staff',
    modules: ['staff', 'staff_requests', 'staff_training', 'staff_performance', 'payroll'],
  },
  { label: 'Inventory', modules: ['inventory', 'products'] },
  { label: 'Communications', modules: ['messaging', 'sms'] },
  { label: 'Compliance & Reports', modules: ['compliance', 'reports', 'analytics'] },
  {
    label: 'System',
    modules: [
      'dashboard',
      'settings',
      'users',
      'audit_logs',
      'integrations',
      'sync',
      'data_inject',
    ],
  },
]

// PWA-only module catalog — the modules that actually have a staff-PWA surface.
export const PWA_MODULE_GROUPS: { label: string; modules: string[] }[] = [
  {
    label: 'Staff Hub',
    // Self-service tab gates (MY_* in @denel/rbac). The admin payroll /
    // staff_* modules are deliberately absent: the Team app has no admin
    // surface, and the staff-administration APIs refuse Team-app sessions.
    modules: ['dashboard', 'my_requests', 'messaging', 'my_training', 'my_payslips'],
  },
  {
    label: 'Clinical',
    modules: ['appointments', 'patients', 'medical_records', 'xrays', 'labs'],
  },
]

export const PWA_MODULE_LABELS: Record<string, string> = {
  dashboard: 'Home / Dashboard',
  my_requests: 'Requests',
  messaging: 'Memos / Messaging',
  my_training: 'Training',
  my_payslips: 'Payslips',
  appointments: 'Appointments (Doctor)',
  patients: 'Patient Search (Doctor)',
  medical_records: 'Quick Notes (Doctor)',
  xrays: 'X-rays (Doctor)',
  labs: 'Lab Jobs',
}

const MODULE_LABELS: Record<string, string> = {
  patients: 'Patients',
  medical_records: 'Medical Records',
  ortho_consent: 'Ortho Consent',
  insurance: 'Insurance',
  xrays: 'X-rays',
  labs: 'Labs',
  appointments: 'Appointments',
  payments: 'Payments',
  payment_plans: 'Payment Plans',
  expenses: 'Expenses',
  financial_records: 'Financial Records',
  ledger_adjustments: 'Ledger Adjustments',
  accounts: 'Accounts',
  journal_entries: 'Journal Entries',
  credit_notes: 'Credit Notes',
  bills: 'Bills',
  suppliers: 'Suppliers',
  specialists: 'Specialists',
  commissions: 'Commissions',
  tax_calculations: 'Tax Calculations',
  staff: 'Staff',
  staff_requests: 'Staff Requests',
  staff_training: 'Training',
  staff_performance: 'Performance',
  payroll: 'Payroll',
  inventory: 'Inventory',
  products: 'Products',
  messaging: 'Messaging',
  sms: 'SMS',
  compliance: 'Compliance',
  reports: 'Reports',
  analytics: 'Analytics',
  dashboard: 'Dashboard',
  settings: 'Settings',
  users: 'Users',
  audit_logs: 'Audit Logs',
  integrations: 'Integrations',
  sync: 'Data Sync',
  data_inject: 'Data Inject',
}

// Write actions — if any are granted, the write cell is checked.
const WRITE_ACTIONS = ['create', 'update', 'delete']

// Modules that only have read (no write concept).
const READ_ONLY_MODULES = new Set(['analytics', 'audit_logs', 'dashboard'])

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildGrantMap(perms: PermissionRow[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const p of perms) {
    if (!map.has(p.module)) map.set(p.module, new Set())
    if (p.granted) map.get(p.module)?.add(p.action)
  }
  return map
}

function collectGrantedPairs(
  grantMap: Map<string, Set<string>>,
  allPerms: PermissionRow[]
): string[] {
  const result: string[] = []
  for (const p of allPerms) {
    const actions = grantMap.get(p.module)
    if (actions?.has(p.action)) result.push(`${p.module}:${p.action}`)
  }
  return result
}

// ── MatrixEditor ───────────────────────────────────────────────────────────────

function MatrixEditor({
  roleId,
  data,
  onSaved,
}: {
  roleId: string
  data: MatrixData
  onSaved: () => void
  scope: 'portal' | 'pwa'
}) {
  const [grantMap, setGrantMap] = useState<Map<string, Set<string>>>(() =>
    buildGrantMap(data.permissions)
  )
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Reset if roleId changes (tab switch)
  useEffect(() => {
    setGrantMap(buildGrantMap(data.permissions))
    setDirty(false)
  }, [data])

  function isReadGranted(module: string) {
    return grantMap.get(module)?.has('read') ?? false
  }
  function isWriteGranted(module: string) {
    const actions = grantMap.get(module)
    return WRITE_ACTIONS.some((a) => actions?.has(a))
  }

  function toggle(module: string, type: 'read' | 'write') {
    setDirty(true)
    setGrantMap((prev) => {
      const next = new Map(prev)
      const cur = new Set(next.get(module) ?? [])

      if (type === 'read') {
        if (cur.has('read')) {
          // Turning read off: also clear all write actions
          cur.delete('read')
          for (const a of WRITE_ACTIONS) cur.delete(a)
        } else {
          cur.add('read')
        }
      } else {
        // Toggle write = toggle all write actions together
        const anyWrite = WRITE_ACTIONS.some((a) => cur.has(a))
        if (anyWrite) {
          for (const a of WRITE_ACTIONS) cur.delete(a)
        } else {
          const available = data.permissions.filter(
            (p) => p.module === module && WRITE_ACTIONS.includes(p.action)
          )
          for (const p of available) cur.add(p.action)
        }
      }

      next.set(module, cur)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    const granted = collectGrantedPairs(grantMap, data.permissions)
    const res = await api.put(`/api/roles/${roleId}/permissions?scope=${data.scope}`, {
      permissions: granted,
    })
    setSaving(false)
    if (res.success) {
      toast.success('Permissions saved.')
      setDirty(false)
      onSaved()
    } else {
      toast.error(res.error ?? 'Failed to save permissions')
    }
  }

  const availableModules = new Set(data.permissions.map((p) => p.module))

  return (
    <div className="space-y-6">
      {data.mode === 'inherited' && (
        <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No PWA permissions configured yet — showing inherited portal grants. Saving will lock
            these in as the PWA starting point for this role.
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {data.mode === 'matrix' ? (
            <StatusBadge tone="success" className="text-xs normal-case">
              Matrix mode
            </StatusBadge>
          ) : data.mode === 'inherited' ? (
            <StatusBadge tone="warning" className="text-xs normal-case">
              Inherited from portal
            </StatusBadge>
          ) : (
            <StatusBadge tone="neutral" className="text-xs normal-case">
              Bundle mode — save to switch to matrix
            </StatusBadge>
          )}
          {dirty && (
            <StatusBadge tone="warning" className="text-xs normal-case">
              Unsaved changes
            </StatusBadge>
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
        <div className="grid grid-cols-[1fr_80px_80px] bg-muted/50 border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Module</span>
          <span className="text-center">Read</span>
          <span className="text-center">Write</span>
        </div>

        {(data.scope === 'pwa' ? PWA_MODULE_GROUPS : MODULE_GROUPS).map((group) => {
          const groupModules = group.modules.filter((m) => availableModules.has(m))
          if (groupModules.length === 0) return null
          const labelMap = data.scope === 'pwa' ? PWA_MODULE_LABELS : MODULE_LABELS
          return (
            <div key={group.label}>
              <div className="bg-muted/20 border-b border-t px-4 py-1.5">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {group.label}
                </span>
              </div>
              {groupModules.map((mod) => {
                const readOn = isReadGranted(mod)
                const writeOn = isWriteGranted(mod)
                const readOnly = READ_ONLY_MODULES.has(mod)
                const hasWritePerms = data.permissions.some(
                  (p) => p.module === mod && WRITE_ACTIONS.includes(p.action)
                )
                return (
                  <div
                    key={mod}
                    className="grid grid-cols-[1fr_80px_80px] items-center px-4 py-2.5 border-b last:border-b-0 hover:bg-muted/10 transition-colors"
                  >
                    <span className="text-sm font-medium pl-2">{labelMap[mod] ?? mod}</span>
                    <div className="flex justify-center">
                      <Checkbox
                        checked={readOn}
                        onCheckedChange={() => toggle(mod, 'read')}
                        aria-label={`${mod} read`}
                      />
                    </div>
                    <div className="flex justify-center">
                      {readOnly || !hasWritePerms ? (
                        <Checkbox checked={false} disabled aria-label={`${mod} write`} />
                      ) : (
                        <Checkbox
                          checked={writeOn}
                          disabled={!readOn}
                          onCheckedChange={() => toggle(mod, 'write')}
                          aria-label={`${mod} write`}
                          className={!readOn ? 'opacity-30' : ''}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── RolePermissionMatrix ───────────────────────────────────────────────────────

export function RolePermissionMatrix({
  roles,
  scope = 'portal',
}: {
  roles: RoleOption[]
  scope?: 'portal' | 'pwa'
}) {
  const editableRoles = roles.filter((r) => r.id !== 'admin')
  const [activeRole, setActiveRole] = useState<string>(editableRoles[0]?.id ?? '')
  const [matrixData, setMatrixData] = useState<Record<string, MatrixData>>({})
  const [loading, setLoading] = useState(false)

  const fetchRole = useCallback(
    async (roleId: string) => {
      setLoading(true)
      const res = await api.get<MatrixData>(`/api/roles/${roleId}/permissions?scope=${scope}`)
      if (res.success && res.data) {
        const data = res.data
        setMatrixData((prev) => ({ ...prev, [roleId]: data }))
      } else {
        toast.error('Failed to load permissions')
      }
      setLoading(false)
    },
    [scope]
  )

  const loadRole = useCallback(
    (roleId: string) => {
      if (matrixData[roleId]) return
      void fetchRole(roleId)
    },
    [matrixData, fetchRole]
  )

  useEffect(() => {
    if (activeRole) loadRole(activeRole)
  }, [activeRole, loadRole])

  function handleSaved() {
    // Go straight to fetchRole (bypassing loadRole's cache guard) — loadRole
    // closes over the pre-update `matrixData`, so calling it right after
    // scheduling the cache-delete below would still see the stale, un-deleted
    // entry and skip the refetch.
    setMatrixData((prev) => {
      const next = { ...prev }
      delete next[activeRole]
      return next
    })
    void fetchRole(activeRole)
  }

  if (editableRoles.length === 0) return null

  const title = scope === 'pwa' ? 'PWA Permission Matrix' : 'Permission Matrix'
  const description =
    scope === 'pwa'
      ? 'Configure which modules each role can access in the staff PWA. Admin always has full access.'
      : 'Configure read / write access per module for each role. Admin always has full access.'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      <Tabs value={activeRole} onValueChange={setActiveRole}>
        <TabsList>
          {editableRoles.map((r) => (
            <TabsTrigger key={r.id} value={r.id} className="capitalize">
              {r.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {editableRoles.map((r) => (
          <TabsContent key={r.id} value={r.id} className="mt-4">
            {loading && !matrixData[r.id] ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length (8) decorative skeleton, never reordered
                  <Skeleton key={`sk-${r.id}-${i}`} className="h-10 w-full rounded" />
                ))}
              </div>
            ) : matrixData[r.id] ? (
              <MatrixEditor
                roleId={r.id}
                data={matrixData[r.id]}
                onSaved={handleSaved}
                scope={scope}
              />
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
