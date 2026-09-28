// HR Settings.
//
// PR-18 moved the Excuse-days / Off-days / Ad-hoc-excuses panels out to the
// Attendance page (where HR actually reaches for them). What lives here:
//
//   • Titles / Employment / Departments / Documents — lookups.
//     (Specialties moved to the portal: Settings → Clinical → Specialties,
//      alongside doctor creation.)
//   • Features           — Roster / Org chart / Review cycles visibility toggles.
//   • Attendance Device  — Anviz device config (folded in from its own page).
//
// Moved out: PAYE/SSNIT brackets → Tax Configuration page. Request types +
// Leave default → Requests page (+ Suggestions). Attendance scoring → the
// Attendance page (Scoring tab).

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@denel/ui'
import {
  Briefcase,
  Database,
  FileText,
  Fingerprint,
  Loader2,
  Network,
  Plus,
  Settings2,
  Stethoscope,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AnvizConfigCard } from '@/features/integrations/components/anviz-config-card'
import { RawLogsSection } from '@/features/staff/components/raw-logs-section'
import { getHrFeatures, type HrFeatureKey, setHrFeatureFlag } from '@/lib/actions/access-management'
import {
  createEmploymentType,
  createHrDepartment,
  createStaffDocumentType,
  createStaffTitle,
  deleteEmploymentType,
  deleteHrDepartment,
  deleteStaffDocumentType,
  deleteStaffTitle,
  type EmploymentKindValue,
  type EmploymentTypeRow,
  type LookupRow,
  listAllEmploymentTypes,
  listAllHrDepartments,
  listAllStaffDocumentTypes,
  listAllStaffTitles,
  updateEmploymentType,
  updateHrDepartment,
  updateStaffDocumentType,
  updateStaffTitle,
} from '@/lib/actions/lookups'
import { StatusBadge } from '@/shared/components/status-badge'

export default function HrSettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">HR Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage organisation-wide HR configuration. Per-staff attendance setup (holidays, off-days,
          ad-hoc excuses) lives on the Attendance page.
        </p>
      </div>

      <Tabs defaultValue="titles" className="w-full">
        <TabsList>
          <TabsTrigger value="titles" className="gap-2">
            <Stethoscope className="h-4 w-4" />
            Titles
          </TabsTrigger>
          <TabsTrigger value="employment-types" className="gap-2">
            <Briefcase className="h-4 w-4" />
            Employment
          </TabsTrigger>
          <TabsTrigger value="departments" className="gap-2">
            <Network className="h-4 w-4" />
            Departments
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2">
            <FileText className="h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="features" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Features
          </TabsTrigger>
          <TabsTrigger value="attendance-device" className="gap-2">
            <Fingerprint className="h-4 w-4" />
            Attendance Device
          </TabsTrigger>
          <TabsTrigger value="raw-logs" className="gap-2">
            <Database className="h-4 w-4" />
            Raw Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="titles" className="space-y-4">
          <ClinicalTitlesSection />
        </TabsContent>

        <TabsContent value="employment-types" className="space-y-4">
          <EmploymentTypesSection />
        </TabsContent>

        <TabsContent value="departments" className="space-y-4">
          <DepartmentsSection />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <DocumentTypesSection />
        </TabsContent>

        <TabsContent value="features">
          <HrFeaturesCard />
        </TabsContent>

        <TabsContent value="attendance-device" className="space-y-4">
          <AnvizConfigCard />
        </TabsContent>

        <TabsContent value="raw-logs" className="space-y-4">
          <RawLogsSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Staff document types (lookup CRUD) ─────────────────────────────────────

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function DocumentTypesSection() {
  const [rows, setRows] = useState<LookupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listAllStaffDocumentTypes()
    if (res.success && Array.isArray(res.data)) setRows(res.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd() {
    const displayName = newLabel.trim()
    if (!displayName) return
    setAdding(true)
    const res = await createStaffDocumentType({ name: slugify(displayName), displayName })
    setAdding(false)
    if (res.success) {
      setNewLabel('')
      toast.success('Document type added')
      void load()
    } else {
      toast.error(res.error || 'Failed to add (it may already exist)')
    }
  }

  async function toggleActive(row: LookupRow) {
    const res = await updateStaffDocumentType(row.id, { isActive: !row.isActive })
    if (res.success) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isActive: !r.isActive } : r)))
    } else {
      toast.error(res.error || 'Failed to update')
    }
  }

  async function handleDelete(row: LookupRow) {
    const res = await deleteStaffDocumentType(row.id)
    if (res.success) {
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success('Document type deleted')
    } else {
      // Usage-guarded: backend returns 409 when documents reference it.
      toast.error(res.error || 'In use — deactivate it instead of deleting')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Document types</CardTitle>
        <CardDescription>
          Categories used to tag staff documents (contract, application, policy, …). Inactive types
          stay on existing documents but drop out of the upload dropdown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-doc-type">New type</Label>
            <Input
              id="new-doc-type"
              value={newLabel}
              placeholder="e.g. Offer letter"
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <Button onClick={handleAdd} disabled={adding || !newLabel.trim()}>
            {adding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add
          </Button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No document types yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={r.isActive ? 'text-sm' : 'text-sm text-muted-foreground'}>
                    {r.displayName ?? r.name}
                  </span>
                  {!r.isActive && (
                    <StatusBadge tone="danger" className="text-[10px]">
                      Inactive
                    </StatusBadge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Switch checked={r.isActive} onCheckedChange={() => toggleActive(r)} />
                    <span className="text-xs text-muted-foreground">Active</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(r)}
                    aria-label={`Delete ${r.displayName ?? r.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── Clinical titles (lookup CRUD) ──────────────────────────────────────────
// The "Title / clinical position" a staff member picks on the self-registration
// form (Dental Surgeon, Receptionist, …). Same lookup shape as document types.

function ClinicalTitlesSection() {
  const [rows, setRows] = useState<LookupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listAllStaffTitles()
    if (res.success && Array.isArray(res.data)) setRows(res.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd() {
    const displayName = newLabel.trim()
    if (!displayName) return
    setAdding(true)
    const res = await createStaffTitle({ name: slugify(displayName), displayName })
    setAdding(false)
    if (res.success) {
      setNewLabel('')
      toast.success('Title added')
      void load()
    } else {
      toast.error(res.error || 'Failed to add (it may already exist)')
    }
  }

  async function toggleActive(row: LookupRow) {
    const res = await updateStaffTitle(row.id, { isActive: !row.isActive })
    if (res.success) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isActive: !r.isActive } : r)))
    } else {
      toast.error(res.error || 'Failed to update')
    }
  }

  async function handleDelete(row: LookupRow) {
    const res = await deleteStaffTitle(row.id)
    if (res.success) {
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success('Title deleted')
    } else {
      toast.error(res.error || 'In use — deactivate it instead of deleting')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinical titles</CardTitle>
        <CardDescription>
          The job title / clinical position new staff pick on the registration form (Dental Surgeon,
          Receptionist, …). Inactive titles stay on existing staff but drop out of the picker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-title">New title</Label>
            <Input
              id="new-title"
              value={newLabel}
              placeholder="e.g. Orthodontist"
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <Button onClick={handleAdd} disabled={adding || !newLabel.trim()}>
            {adding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add
          </Button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No titles yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={r.isActive ? 'text-sm' : 'text-sm text-muted-foreground'}>
                    {r.displayName ?? r.name}
                  </span>
                  {!r.isActive && (
                    <StatusBadge tone="danger" className="text-[10px]">
                      Inactive
                    </StatusBadge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Switch checked={r.isActive} onCheckedChange={() => toggleActive(r)} />
                    <span className="text-xs text-muted-foreground">Active</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(r)}
                    aria-label={`Delete ${r.displayName ?? r.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── Employment types (migration 0178) ───────────────────────────────────────

const KIND_OPTIONS: Array<{ value: EmploymentKindValue; label: string; hint: string }> = [
  { value: 'permanent', label: 'Permanent', hint: 'Open-ended. No contract end date.' },
  { value: 'contract', label: 'Fixed-term', hint: 'Asks for a contract end date.' },
  { value: 'trainer', label: 'External trainer', hint: 'Marks the staffer as a trainer.' },
]

const KIND_LABELS: Record<EmploymentKindValue, string> = {
  permanent: 'Permanent',
  contract: 'Fixed-term',
  trainer: 'External trainer',
}

/**
 * Employment types were a hard-coded enum until 0178.
 *
 * The `kind` is the important control here and the reason this section isn't
 * just another name/label list: employment type drives behaviour (a fixed-term
 * role gets a contract end date; a trainer is flagged as one). Code branches on
 * `kind`, never on the label — so HR can add "Locum (6 months)" as fixed-term
 * and it behaves correctly with no code change. Changing an existing row's kind
 * changes how staff on it behave, which is why it's called out in the UI.
 */
function EmploymentTypesSection() {
  const [rows, setRows] = useState<EmploymentTypeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [newKind, setNewKind] = useState<EmploymentKindValue>('permanent')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listAllEmploymentTypes()
    if (res.success && Array.isArray(res.data)) setRows(res.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd() {
    const displayName = newLabel.trim()
    if (!displayName) return
    setAdding(true)
    const res = await createEmploymentType({
      name: slugify(displayName),
      displayName,
      kind: newKind,
    })
    setAdding(false)
    if (res.success) {
      setNewLabel('')
      setNewKind('permanent')
      toast.success('Employment type added')
      void load()
    } else {
      toast.error(res.error || 'Failed to add (it may already exist)')
    }
  }

  async function toggleActive(row: EmploymentTypeRow) {
    const res = await updateEmploymentType(row.id, { isActive: !row.isActive })
    if (res.success) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isActive: !r.isActive } : r)))
    } else {
      toast.error(res.error || 'Failed to update')
    }
  }

  async function changeKind(row: EmploymentTypeRow, kind: EmploymentKindValue) {
    const res = await updateEmploymentType(row.id, { kind })
    if (res.success) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, kind } : r)))
      toast.success(`“${row.displayName ?? row.name}” is now ${KIND_LABELS[kind].toLowerCase()}`)
    } else {
      toast.error(res.error || 'Failed to update')
    }
  }

  async function handleDelete(row: EmploymentTypeRow) {
    const res = await deleteEmploymentType(row.id)
    if (res.success) {
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success('Employment type deleted')
    } else {
      // The backend blocks deletion of a type staff still hold — that's the
      // FK on staff.employmentType, surfaced as a 409 rather than a raw error.
      toast.error(res.error || 'In use — deactivate it instead of deleting')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Employment types</CardTitle>
        <CardDescription>
          The employment type picked when onboarding staff (Permanent, Contract, …). Each type has a
          behaviour: <strong>fixed-term</strong> types ask for a contract end date. Inactive types
          stay on existing staff but drop out of the picker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-emp-type">New employment type</Label>
            <Input
              id="new-emp-type"
              value={newLabel}
              placeholder="e.g. Locum (6 months)"
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="w-44 space-y-1.5">
            <Label htmlFor="new-emp-kind">Behaviour</Label>
            <Select value={newKind} onValueChange={(v) => setNewKind(v as EmploymentKindValue)}>
              <SelectTrigger id="new-emp-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAdd} disabled={adding || !newLabel.trim()}>
            {adding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add
          </Button>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          {KIND_OPTIONS.find((k) => k.value === newKind)?.hint}
        </p>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No employment types yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={r.isActive ? 'text-sm' : 'text-sm text-muted-foreground'}>
                    {r.displayName ?? r.name}
                  </span>
                  {!r.isActive && (
                    <StatusBadge tone="danger" className="text-[10px]">
                      Inactive
                    </StatusBadge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Select
                    value={r.kind}
                    onValueChange={(v) => changeKind(r, v as EmploymentKindValue)}
                  >
                    <SelectTrigger className="h-8 w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KIND_OPTIONS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1.5">
                    <Switch checked={r.isActive} onCheckedChange={() => toggleActive(r)} />
                    <span className="text-xs text-muted-foreground">Active</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(r)}
                    aria-label={`Delete ${r.displayName ?? r.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── Departments (migration 0178) ────────────────────────────────────────────

/**
 * Restored lookup. 0060 added it, 0154 dropped it as unused ("the clinic never
 * populated departments"), then 0174 re-added staff.department as an enum for
 * the public registration form — where it's required. So the concept is live
 * again and needs somewhere to be managed.
 */
function DepartmentsSection() {
  const [rows, setRows] = useState<LookupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listAllHrDepartments()
    if (res.success && Array.isArray(res.data)) setRows(res.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd() {
    const displayName = newLabel.trim()
    if (!displayName) return
    setAdding(true)
    const res = await createHrDepartment({ name: slugify(displayName), displayName })
    setAdding(false)
    if (res.success) {
      setNewLabel('')
      toast.success('Department added')
      void load()
    } else {
      toast.error(res.error || 'Failed to add (it may already exist)')
    }
  }

  async function toggleActive(row: LookupRow) {
    const res = await updateHrDepartment(row.id, { isActive: !row.isActive })
    if (res.success) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isActive: !r.isActive } : r)))
    } else {
      toast.error(res.error || 'Failed to update')
    }
  }

  async function handleDelete(row: LookupRow) {
    const res = await deleteHrDepartment(row.id)
    if (res.success) {
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success('Department deleted')
    } else {
      toast.error(res.error || 'In use — deactivate it instead of deleting')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Departments</CardTitle>
        <CardDescription>
          The department a staff member belongs to, picked during onboarding and on the public
          registration form. Inactive departments stay on existing staff but drop out of the picker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-dept">New department</Label>
            <Input
              id="new-dept"
              value={newLabel}
              placeholder="e.g. Radiology"
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <Button onClick={handleAdd} disabled={adding || !newLabel.trim()}>
            {adding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add
          </Button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No departments yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={r.isActive ? 'text-sm' : 'text-sm text-muted-foreground'}>
                    {r.displayName ?? r.name}
                  </span>
                  {!r.isActive && (
                    <StatusBadge tone="danger" className="text-[10px]">
                      Inactive
                    </StatusBadge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Switch checked={r.isActive} onCheckedChange={() => toggleActive(r)} />
                    <span className="text-xs text-muted-foreground">Active</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(r)}
                    aria-label={`Delete ${r.displayName ?? r.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function HrFeaturesCard() {
  const [rosterEnabled, setRosterEnabled] = useState(false)
  const [orgChartEnabled, setOrgChartEnabled] = useState(false)
  const [reviewCyclesEnabled, setReviewCyclesEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<null | 'roster' | 'org' | 'reviews'>(null)

  useEffect(() => {
    void (async () => {
      const res = await getHrFeatures()
      if (res.success && res.data) {
        setRosterEnabled(res.data.rosterEnabled)
        setOrgChartEnabled(res.data.orgChartEnabled)
        setReviewCyclesEnabled(res.data.reviewCyclesEnabled)
      }
      setLoading(false)
    })()
  }, [])

  type Slot = 'roster' | 'org' | 'reviews'
  const KEY_BY_SLOT: Record<Slot, HrFeatureKey> = {
    roster: 'hr:roster_enabled',
    org: 'hr:org_chart_enabled',
    reviews: 'hr:review_cycles_enabled',
  }

  async function persist(slot: Slot, value: boolean) {
    setSaving(slot)
    const res = await setHrFeatureFlag(KEY_BY_SLOT[slot], value)
    if (!res.success) {
      toast.error(res.error || 'Failed to update setting')
      // Roll back the local optimistic flip.
      if (slot === 'roster') setRosterEnabled((v) => !v)
      else if (slot === 'org') setOrgChartEnabled((v) => !v)
      else setReviewCyclesEnabled((v) => !v)
    } else {
      toast.success(value ? 'Enabled' : 'Hidden')
    }
    setSaving(null)
  }

  const rows = useMemo(
    () => [
      {
        slot: 'roster' as const,
        label: 'Roster',
        description: 'Weekly shift grid. Disable while shift planning is in beta.',
        enabled: rosterEnabled,
        setEnabled: setRosterEnabled,
      },
      {
        slot: 'org' as const,
        label: 'Org chart',
        description:
          'Reporting tree. Disable while manager relationships are still being filled in.',
        enabled: orgChartEnabled,
        setEnabled: setOrgChartEnabled,
      },
      {
        slot: 'reviews' as const,
        label: 'Review cycles',
        description:
          "Quarterly / annual review cycles. Disable if your team isn't running structured reviews yet.",
        enabled: reviewCyclesEnabled,
        setEnabled: setReviewCyclesEnabled,
      },
    ],
    [rosterEnabled, orgChartEnabled, reviewCyclesEnabled]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">HR feature visibility</CardTitle>
        <CardDescription>
          Toggle entire HR sections without removing their data. Nav items and routes are hidden
          when off; the underlying backend endpoints stay live.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          rows.map((r) => (
            <FeatureToggleRow
              key={r.slot}
              label={r.label}
              description={r.description}
              enabled={r.enabled}
              saving={saving === r.slot}
              onChange={(v) => {
                r.setEnabled(v)
                void persist(r.slot, v)
              }}
            />
          ))
        )}
      </CardContent>
    </Card>
  )
}

function FeatureToggleRow({
  label,
  description,
  enabled,
  saving,
  onChange,
}: {
  label: string
  description: string
  enabled: boolean
  saving: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={enabled} onCheckedChange={onChange} disabled={saving} aria-label={label} />
    </div>
  )
}
