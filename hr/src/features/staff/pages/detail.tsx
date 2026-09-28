import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@denel/ui'
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Hash,
  HeartPulse,
  IdCard,
  Mail,
  MonitorSmartphone,
  Pencil,
  Phone,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChildRecordsCard } from '@/features/staff/components/child-records-card'
import { CompensationStep } from '@/features/staff/components/compensation-step'
import { EditAccessSheet } from '@/features/staff/components/edit-access-sheet'
import { EditEmploymentSheet } from '@/features/staff/components/edit-employment-sheet'
import { EditIdentitySheet } from '@/features/staff/components/edit-identity-sheet'
import { EditPersonalSheet } from '@/features/staff/components/edit-personal-sheet'
import { PermissionsTab } from '@/features/staff/components/permissions-tab'
import { buildColumns as buildDocumentColumns } from '@/features/staff/components/staff-documents-columns'
import { StaffPaymentBuilder } from '@/features/staff/components/staff-payment-builder'
import { PayslipHistoryCard } from '@/features/staff/components/staff-payslip-history'
import { StaffPerformanceTab } from '@/features/staff/components/staff-performance-tab'
import { StaffSessionsTab } from '@/features/staff/components/staff-sessions-tab'
import { StaffTimelineTab } from '@/features/staff/components/staff-timeline-tab'
import {
  getStaffAttendance,
  getStaffMember,
  getStaffPerformanceHistory,
  type StaffDetailRecord,
} from '@/lib/actions/staff'
import { useLoading } from '@/lib/loading-context'
import { cn } from '@/lib/utils'
import { DataTable } from '@/shared/components/data-table/data-table'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'
import { AddDocumentButton } from './add-document-button'

// ── Tab model ──────────────────────────────────────────────────────────────
//
// The staff detail page mirrors the patient detail layout — a left content
// pane with flat top-level tabs + a right bio pane. Profile is just stacked
// cards (Identity + Employment); Access and Compensation are their own tabs
// (each an edit card). Credentials are dropped for v1 (return in v2); the
// Timeline tab lands in a later slice.

type StaffTab =
  | 'timeline'
  | 'profile'
  | 'documents'
  | 'access'
  | 'compensation'
  | 'performance'
  | 'sessions'

const TABS: Array<{ id: StaffTab; label: string }> = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'profile', label: 'Profile' },
  { id: 'documents', label: 'Documents' },
  { id: 'access', label: 'Access' },
  { id: 'compensation', label: 'Compensation' },
  { id: 'performance', label: 'Performance' },
  { id: 'sessions', label: 'Sessions' },
]

const VALID_TABS = new Set<StaffTab>(TABS.map((t) => t.id))

/**
 * Map legacy `?tab=X` deep-link tokens (dashboard alerts, AM overview,
 * pre-redesign bookmarks) onto the current flat tabs. `attendance` folded into
 * the Performance tab (now a unified attendance + training calendar).
 */
function normalizeTab(rawTab: string | null): StaffTab {
  if (rawTab === 'permissions') return 'access'
  if (rawTab === 'credentials') return 'documents' // credentials dropped in v1
  if (rawTab === 'attendance') return 'performance' // attendance merged into performance
  if (rawTab === 'lifecycle' || rawTab === 'goals' || rawTab === 'one-on-ones') return 'profile'
  return rawTab && VALID_TABS.has(rawTab as StaffTab) ? (rawTab as StaffTab) : 'profile'
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [staff, setStaff] = useState<StaffDetailRecord | null>(null)
  // Per-section edit sheets. Identity + Employment edit from the Profile tab;
  // Access edits from the Access tab.
  const [identityOpen, setIdentityOpen] = useState(false)
  const [employmentOpen, setEmploymentOpen] = useState(false)
  const [personalOpen, setPersonalOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [scores, setScores] = useState<{
    attendancePct: number | null
    trainingPct: number | null
  }>({ attendancePct: null, trainingPct: null })
  const { isLoading, setIsLoading } = useLoading()

  // Active tab from URL. Legacy `?tab=permissions`/`credentials`/removed-tab
  // tokens still resolve cleanly so deep-links + old bookmarks keep working.
  const activeTab = useMemo(() => normalizeTab(searchParams.get('tab')), [searchParams])

  function setTab(next: StaffTab) {
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        out.set('tab', next)
        out.delete('step')
        return out
      },
      { replace: true }
    )
  }

  const load = useCallback(async () => {
    if (!id) {
      navigate('/staff')
      return
    }
    try {
      setIsLoading(true)
      const result = await getStaffMember(id)
      if (!result.success || !result.data) {
        navigate('/staff')
      } else {
        setStaff(result.data)
      }
    } finally {
      setIsLoading(false)
    }
  }, [id, navigate, setIsLoading])

  useEffect(() => {
    void load()
  }, [load])

  // Right-pane glance scores: current-month attendance + latest training score.
  useEffect(() => {
    if (!staff?.id) return
    let cancelled = false
    const month = new Date().toISOString().slice(0, 7)
    Promise.all([
      getStaffAttendance(staff.id, month),
      getStaffPerformanceHistory(staff.id, 1),
    ]).then(([att, perf]) => {
      if (cancelled) return
      const attendancePct = att.success && att.data ? att.data.summary.attendancePct : null
      const latest = perf.success && perf.data.length > 0 ? perf.data[0] : null
      const trainingPct =
        latest && latest.trainingScorePct !== null ? Number(latest.trainingScorePct) : null
      setScores({ attendancePct, trainingPct })
    })
    return () => {
      cancelled = true
    }
  }, [staff?.id])

  if (isLoading || !staff) return null

  return (
    <div className="flex h-full flex-col">
      {/* ── Breadcrumb bar ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild aria-label="Go back">
            <Link to="/staff" aria-label="Back to staff">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/staff" className="hover:underline hover:text-foreground">
              Staff
            </Link>
            <span>/</span>
            <span className="font-medium text-foreground">{staff.fullName}</span>
          </nav>
        </div>
      </div>

      {/* ── Two-column body ───────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Left: tabs (2/3) */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <Tabs value={activeTab} onValueChange={(v) => setTab(v as StaffTab)}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="profile" className="mt-5 space-y-5">
              <IdentityStep staff={staff} onEdit={() => setIdentityOpen(true)} />
              <PersonalStep staff={staff} onEdit={() => setPersonalOpen(true)} />
              <EmploymentStep staff={staff} onEdit={() => setEmploymentOpen(true)} />
              {/* The one-to-many records (migration 0177). The Personal card
                  above still renders the legacy flat columns until the contract
                  migration drops them. */}
              <ChildRecordsCard staffId={staff.id} />
              <CompensationStep staffId={staff.id} staff={staff} />
            </TabsContent>

            <TabsContent value="performance" className="mt-5">
              <StaffPerformanceTab staffId={staff.id} staff={staff} />
            </TabsContent>

            <TabsContent value="documents" className="mt-5">
              <DocumentsCard
                staffId={staff.id}
                staffName={staff.fullName}
                staff={staff}
                onReload={load}
              />
            </TabsContent>

            <TabsContent value="access" className="mt-5">
              <AccessStep staff={staff} onEdit={() => setAccessOpen(true)} onChanged={load} />
            </TabsContent>

            <TabsContent value="compensation" className="mt-5 space-y-5">
              <StaffPaymentBuilder staffId={staff.id} staff={staff} onSaved={load} />
              <PayslipHistoryCard staffId={staff.id} />
            </TabsContent>

            <TabsContent value="timeline" className="mt-5">
              <StaffTimelineTab staffId={staff.id} />
            </TabsContent>

            <TabsContent value="sessions" className="mt-5">
              <StaffSessionsTab staffId={staff.id} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: bio pin (1/3) — matches the patient detail layout */}
        <StaffBioPane staff={staff} scores={scores} />
      </div>

      <EditIdentitySheet
        open={identityOpen}
        onOpenChange={setIdentityOpen}
        staff={staff}
        onSaved={load}
      />
      <EditPersonalSheet
        open={personalOpen}
        onOpenChange={setPersonalOpen}
        staff={staff}
        onSaved={load}
      />
      <EditEmploymentSheet
        open={employmentOpen}
        onOpenChange={setEmploymentOpen}
        staff={staff}
        onSaved={load}
      />
      <EditAccessSheet
        open={accessOpen}
        onOpenChange={setAccessOpen}
        staff={staff}
        onSaved={load}
      />
    </div>
  )
}

// ── Bio pane (PR-9) ────────────────────────────────────────────────────────
//
// Right-rail summary of the staff member — mirrors the patient detail bio
// pin. Avatar, name, ID, position chip, contact, status, edit shortcut.

const BIO_PANE_COLLAPSED_KEY = 'hr:staffBioPaneCollapsed'

function StaffBioPane({
  staff,
  scores,
}: {
  staff: StaffDetailRecord
  scores: { attendancePct: number | null; trainingPct: number | null }
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(BIO_PANE_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(BIO_PANE_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // ignore — collapse state is a nicety, not load-bearing
      }
      return next
    })
  }

  if (collapsed) {
    return (
      <div className="hidden w-12 shrink-0 flex-col items-center border-l bg-muted/10 py-3 lg:flex">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label="Expand details"
          title="Expand details"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="hidden w-[340px] shrink-0 overflow-y-auto border-l bg-muted/10 lg:block">
      <div className="space-y-5 p-5 pb-8">
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label="Collapse details"
            title="Collapse details"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col items-center gap-3 text-center">
          <Avatar className="h-24 w-24 rounded-lg ring-2 ring-border ring-offset-2 ring-offset-background">
            {staff.profileImage ? (
              <AvatarImage src={staff.profileImage} alt={staff.fullName} className="rounded-lg" />
            ) : (
              <AvatarFallback className="rounded-lg bg-muted text-2xl font-semibold">
                {getInitials(staff.fullName)}
              </AvatarFallback>
            )}
          </Avatar>
          <div>
            <h2 className="text-base font-bold leading-snug">{staff.fullName}</h2>
            {staff.staffId && (
              <p className="mt-0.5 font-mono text-xs tracking-wider text-muted-foreground">
                {staff.staffId}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <StatusBadge status={staff.status ?? 'active'} className="h-4 px-1.5 text-[10px]" />
              {staff.isClinicalPractitioner && (
                <TagBadge className="h-4 px-1.5 text-[10px]">Clinical</TagBadge>
              )}
            </div>
          </div>
        </div>

        <Separator />

        {/* Quick stats */}
        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Role &amp; position
          </p>
          {staff.position ? (
            <BioRow icon={<Briefcase className="h-3.5 w-3.5" />} value={staff.position} />
          ) : (
            <BioRow icon={<Briefcase className="h-3.5 w-3.5" />} value={null} />
          )}
          {staff.role ? (
            <BioRow
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              value={String(staff.role).replace(/_/g, ' ')}
              valueClassName="capitalize"
            />
          ) : (
            <BioRow
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              value="No system role"
              valueClassName="italic text-muted-foreground"
            />
          )}
        </div>

        <Separator />

        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Contact
          </p>
          <BioRow icon={<Mail className="h-3.5 w-3.5" />} value={staff.email} />
          <BioRow icon={<Phone className="h-3.5 w-3.5" />} value={staff.phone} />
        </div>

        {(staff.emergencyContactName || staff.emergencyContactPhone) && (
          <>
            <Separator />
            <div className="space-y-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Emergency contact
              </p>
              <BioRow
                icon={<HeartPulse className="h-3.5 w-3.5" />}
                value={
                  [staff.emergencyContactName, staff.emergencyContactRelationship]
                    .filter(Boolean)
                    .join(' · ') || null
                }
              />
              {staff.emergencyContactPhone && (
                <BioRow
                  icon={<Phone className="h-3.5 w-3.5" />}
                  value={staff.emergencyContactPhone}
                />
              )}
            </div>
          </>
        )}

        <Separator />

        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Employment
          </p>
          <BioRow
            icon={<UserCog className="h-3.5 w-3.5" />}
            value={staff.employmentType}
            valueClassName="capitalize"
          />
          {staff.dateOfJoining && (
            <BioRow
              icon={<Calendar className="h-3.5 w-3.5" />}
              value={`Joined ${new Date(staff.dateOfJoining).toLocaleDateString()}`}
            />
          )}
          {staff.deviceUserId && (
            <BioRow
              icon={<MonitorSmartphone className="h-3.5 w-3.5" />}
              value={`Attendance ID ${staff.deviceUserId}`}
              valueClassName="font-mono"
            />
          )}
        </div>

        <Separator />

        {/* Glanceable scores */}
        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Snapshot
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ScorePill
              label="Attendance"
              value={scores.attendancePct == null ? '—' : `${Math.round(scores.attendancePct)}%`}
            />
            <ScorePill
              label="Training"
              value={scores.trainingPct == null ? '—' : `${Math.round(scores.trainingPct)}%`}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Attendance = this month · Training = latest month
          </p>
        </div>
      </div>
    </div>
  )
}

function ScorePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}

function BioRow({
  icon,
  value,
  valueClassName,
}: {
  icon: React.ReactNode
  value: string | null | undefined
  valueClassName?: string
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 shrink-0 text-muted-foreground/70">{icon}</span>
      <span
        className={cn(
          'min-w-0 break-words',
          !value && 'italic text-muted-foreground',
          valueClassName
        )}
      >
        {value || '—'}
      </span>
    </div>
  )
}

function IdentityStep({ staff, onEdit }: { staff: StaffDetailRecord; onEdit: () => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="h-4 w-4" />
            Identity
          </CardTitle>
          <CardDescription>
            Who this staff member is and how they appear across the clinic.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" value={staff.fullName} />
          <Field label="Staff ID" value={staff.staffId} mono />
          <Field label="Email" value={staff.email} />
          <Field label="Phone" value={staff.phone} />
        </div>

        <Separator />

        {/* Clinical role — capability chips that drive system behaviour */}
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Stethoscope className="h-3.5 w-3.5" />
            Clinical role
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {staff.isClinicalPractitioner ? (
              <TagBadge>Clinical practitioner</TagBadge>
            ) : (
              <span className="text-sm italic text-muted-foreground">
                Not a clinical practitioner
              </span>
            )}
            {staff.receivesCommission && <TagBadge>Commission</TagBadge>}
            {staff.hasPayslip && <TagBadge>Payslip</TagBadge>}
            {staff.tracksAttendance && <TagBadge>Attendance-tracked</TagBadge>}
            {staff.requiresLicense && <TagBadge>License-required</TagBadge>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Employee master data — the read/correct surface for everything the standard
 * calls "personal information".
 *
 * Every field here was previously invisible: self-registration wrote them and
 * then no HR screen displayed them and no API could change them. The consent
 * record in particular matters for Act 843 — we were recording consent and then
 * unable to produce it.
 */
function PersonalStep({ staff, onEdit }: { staff: StaffDetailRecord; onEdit: () => void }) {
  const consentAt = staff.consentAt ? new Date(staff.consentAt).toLocaleDateString() : null
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <IdCard className="h-4 w-4" />
            Personal
          </CardTitle>
          <CardDescription>
            Biographical data, identification, address, emergency contacts, and education.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Date of birth"
            value={staff.dateOfBirth ? new Date(staff.dateOfBirth).toLocaleDateString() : null}
          />
          <Field label="Gender" value={staff.gender} capitalize />
          <Field label="Nationality" value={staff.nationality} />
          <Field label="Marital status" value={staff.maritalStatus} capitalize />
          <Field label="Ghana Card PIN" value={staff.ghanaCardPin} mono />
          <Field label="Digital address" value={staff.digitalAddress} mono />
        </div>

        <Field label="Residential address" value={staff.residentialAddress} />

        <Separator />

        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <HeartPulse className="h-3.5 w-3.5" />
            Emergency contact
          </h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Name" value={staff.emergencyContactName} />
            <Field label="Relationship" value={staff.emergencyContactRelationship} />
            <Field label="Phone" value={staff.emergencyContactPhone} />
          </div>
        </div>

        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Next of kin
          </h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Name" value={staff.nextOfKinName} />
            <Field label="Relationship" value={staff.nextOfKinRelationship} />
            <Field label="Phone" value={staff.nextOfKinPhone} />
          </div>
        </div>

        <Separator />

        {/* Act 843 — the consent record must be producible on demand. */}
        <div className="flex flex-wrap items-center gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Data-processing consent
          </h4>
          {staff.consentGiven ? (
            <StatusBadge tone="success" className="normal-case">
              Given{consentAt ? ` — ${consentAt}` : ''}
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning" className="normal-case">
              Not recorded
            </StatusBadge>
          )}
          {staff.cvUrl && (
            <a
              href={staff.cvUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline underline-offset-4"
            >
              View CV
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function EmploymentStep({ staff, onEdit }: { staff: StaffDetailRecord; onEdit: () => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            Employment
          </CardTitle>
          <CardDescription>Position, contract dates, and payroll identifiers.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Edit
        </Button>
      </CardHeader>
      <CardContent>
        {/* Emergency contact lives on the Personal card — it's personal data,
            not an employment term, and the relationship field only exists
            there. Splitting the triple across two cards was how it ended up
            half-editable. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Position" value={staff.position} />
          <Field label="Employment type" value={staff.employmentType} capitalize />
          <Field label="Department" value={staff.department} capitalize />
          <Field
            label="Date of joining"
            value={staff.dateOfJoining ? new Date(staff.dateOfJoining).toLocaleDateString() : null}
          />
          <Field
            label="Probation ends"
            value={
              staff.probationEndDate ? new Date(staff.probationEndDate).toLocaleDateString() : null
            }
          />
          <Field
            label="Contract ends"
            value={
              staff.contractEndDate ? new Date(staff.contractEndDate).toLocaleDateString() : null
            }
          />
          <Field
            label="Joined system"
            value={staff.createdAt ? new Date(staff.createdAt).toLocaleDateString() : null}
          />
          <Field label="SSNIT ID" value={staff.ssnitId ?? null} mono />
        </div>
      </CardContent>
    </Card>
  )
}

function AccessStep({
  staff,
  onEdit,
  onChanged,
}: {
  staff: StaffDetailRecord
  onEdit: () => void
  onChanged: () => void
}) {
  if (!staff.userId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          This staff record has no linked user account — nothing to manage here.
        </CardContent>
      </Card>
    )
  }
  // PR-11 — read-only summary card on top with Edit button, plus the existing
  // PermissionsTab below for the permission matrix + offboard danger zone.
  // The matrix has to stay live (it reflects role + bundle resolution which
  // the sheet itself mutates), so we keep PermissionsTab embedded.
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Access summary
            </CardTitle>
            <CardDescription>
              Clinic tag, system role, surface access, and granted bundles. Edit to change any of
              them.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Clinic tag"
              value={staff.positionTag === 'non_staff' ? 'Non-staff' : 'Staff'}
            />
            <Field
              label="System role"
              value={staff.role ? String(staff.role).replace(/_/g, ' ') : null}
              capitalize
            />
          </div>
        </CardContent>
      </Card>
      <PermissionsTab userId={staff.userId} staffName={staff.fullName} onChanged={onChanged} />
    </div>
  )
}

function Field({
  label,
  value,
  capitalize,
  mono,
}: {
  label: string
  value: string | null | undefined
  capitalize?: boolean
  mono?: boolean
}) {
  return (
    <div>
      <h4 className="text-sm font-medium text-muted-foreground">{label}</h4>
      <p
        className={cn(
          'text-sm',
          capitalize && 'capitalize',
          mono && 'font-mono',
          !value && 'italic text-muted-foreground'
        )}
      >
        {value || '—'}
      </p>
    </div>
  )
}

// ── Documents card (PR-9) ──────────────────────────────────────────────────

function DocumentsCard({
  staffId,
  staffName,
  staff,
  onReload,
}: {
  staffId: string
  staffName: string
  staff: StaffDetailRecord
  onReload: () => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Hash className="h-4 w-4" />
            Documents
          </CardTitle>
          <CardDescription>
            Contracts, IDs, certifications, and other documents uploaded for this staff member.
          </CardDescription>
        </div>
        <AddDocumentButton staffId={staffId} staffName={staffName} onUploaded={onReload} />
      </CardHeader>
      <CardContent>
        <DataTable columns={buildDocumentColumns(onReload)} data={staff.documents || []} />
      </CardContent>
    </Card>
  )
}
