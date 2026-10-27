import { format } from 'date-fns'
import {
  AlertTriangle,
  BriefcaseBusiness,
  Calendar,
  Globe,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Smartphone,
  User,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ViewAuditHistoryLink } from '@/features/audit-logs/components/view-audit-history-link'
import { MedicalRecordsSubTabs } from '@/features/patient-cases/components/medical-records-sub-tabs'
import { DocumentsTab } from '@/features/patient-media/components/documents-tab'
import { EditPatientSheet } from '@/features/patients/components/edit-patient-sheet'
import { PatientLedgerTab } from '@/features/patients/components/patient-ledger-tab'
import { PatientTimelineTab } from '@/features/patients/components/patient-timeline-tab'
import { PwaAccessTab } from '@/features/patients/components/pwa-access-tab'
import { StatementsTab } from '@/features/patients/components/statements-tab'
import { TagPills } from '@/features/patients/components/tag-pills'
import type { PatientSummary } from '@/features/patients/types/patient-summary'
import { api } from '@/lib/api-client'
import type { patients } from '@/lib/db/schema'
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar'
import { Badge } from '@/shared/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/components/ui/breadcrumb'
import { Button } from '@/shared/components/ui/button'
import { Separator } from '@/shared/components/ui/separator'
import { Switch } from '@/shared/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { formatCurrency, formatCurrencyCompact } from '@/shared/utils/currency'

// ─── Types ────────────────────────────────────────────────────────────────────

// §2.7 — patients no longer carry `type`/`isOrtho`; the API supplies `tags`.
type Patient = Omit<typeof patients.$inferSelect, 'type' | 'isOrtho'> & {
  tags?: Array<{ id: string; name: string; color: string }>
}

interface PatientDetailContentProps {
  patient: Patient
  isAdmin?: boolean
  isDoctor?: boolean
  canViewMedicalRecords?: boolean
  canEdit?: boolean
  onReload?: () => void
}

// ─── Medical Records sub-tabs ─────────────────────────────────────────────────

// ─── Bio row ─────────────────────────────────────────────────────────────────

function BioRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label?: string
  value: string | null | undefined
}) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 text-muted-foreground/70 shrink-0">{icon}</span>
      <div className="min-w-0">
        {label && (
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            {label}
          </p>
        )}
        <p className="break-words leading-snug">{value}</p>
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PatientDetailContent({
  patient: initialPatient,
  isAdmin = false,
  isDoctor = false,
  canViewMedicalRecords = false,
  canEdit = true,
  onReload,
}: PatientDetailContentProps) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Granting patient-app access is an admin-only action, so the tab (and the
  // bio-pane toggle further down) are hidden from every other role.
  const VALID_TABS = (
    isDoctor
      ? ['medical', 'documents']
      : isAdmin
        ? ['timeline', 'medical', 'documents', 'ledger', 'statements', 'pwa']
        : ['timeline', 'medical', 'documents', 'ledger', 'statements']
  ).filter((t) => t !== 'medical' || canViewMedicalRecords)
  const tabParam = searchParams.get('tab') ?? (isDoctor ? 'medical' : 'timeline')
  const activeTab = VALID_TABS.includes(tabParam) ? tabParam : isDoctor ? 'medical' : 'timeline'

  const [patient, setPatient] = useState(initialPatient)
  // Re-sync when the parent hands us a fresh patient object — e.g. after
  // EditPatientSheet's save invalidates the query cache and detail.tsx's
  // patientQuery refetches. Without this, the local copy below (needed for
  // the two optimistic PWA-toggle updates) stayed frozen at whatever was
  // passed in on first mount, so an edit never appeared anywhere on this
  // page — bio pane, breadcrumb, or any tab — until a full reload.
  useEffect(() => {
    setPatient(initialPatient)
  }, [initialPatient])
  const [pwaToggling, setPwaToggling] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [activePlans, setActivePlans] = useState<PatientSummary['paymentPlans']>([])
  const [outstandingBalance, setOutstandingBalance] = useState<number | null>(null)

  // One aggregate call. This used to be two — the full patient ledger (built
  // from ~7 queries) and every non-archived payment plan with its invoices,
  // payments and invoice lines eager-loaded — issued purely to render the
  // numbers below. `/summary` returns exactly those numbers.
  useEffect(() => {
    let cancelled = false
    api.get<PatientSummary>(`/api/patients/${patient.id}/summary`).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setActivePlans(res.data.paymentPlans ?? [])
        setOutstandingBalance(res.data.outstandingBalance ?? 0)
      }
    })
    return () => {
      cancelled = true
    }
  }, [patient.id])

  // PatientLedgerTab calls this every time it refreshes the ledger — keeps
  // the bio-pin "Outstanding Balance" in sync with payments posted from inside
  // the Ledger tab without forcing the bio to refetch on its own.
  const handleLedgerChange = useCallback((ledger: { outstandingBalance: number }) => {
    setOutstandingBalance(ledger.outstandingBalance ?? 0)
  }, [])

  // Bio computed values
  const dob = patient.dob ? new Date(patient.dob) : null
  const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handlePwaToggle(enabled: boolean) {
    setPwaToggling(true)
    const res = await api.post(`/api/patients/${patient.id}/enable-pwa`, { enabled })
    if (res.success && res.data) {
      setPatient((prev: Patient) => ({ ...prev, ...(res.data as Partial<Patient>) }))
      toast.success(enabled ? 'Portal access enabled — SMS sent' : 'Portal access revoked')
    } else {
      toast.error((res.error as string) ?? 'Failed to update portal access')
    }
    setPwaToggling(false)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* ── Breadcrumb bar ────────────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b shrink-0">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/patients">Patients</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{patient.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* ── Two-column body ───────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Left: main tabs (2/3) ────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })}
          >
            <TabsList>
              {!isDoctor && <TabsTrigger value="timeline">Timeline</TabsTrigger>}
              {canViewMedicalRecords && <TabsTrigger value="medical">Medical Records</TabsTrigger>}
              <TabsTrigger value="documents">Documents</TabsTrigger>
              {!isDoctor && (
                <>
                  <TabsTrigger value="ledger">Ledger</TabsTrigger>
                  <TabsTrigger value="statements">Statements</TabsTrigger>
                  {isAdmin && <TabsTrigger value="pwa">PWA Access</TabsTrigger>}
                </>
              )}
            </TabsList>

            <TabsContent value="timeline" className="mt-5">
              <PatientTimelineTab patientId={patient.id} />
            </TabsContent>

            {canViewMedicalRecords && (
              <TabsContent value="medical" className="mt-5">
                <MedicalRecordsSubTabs
                  patientId={patient.id}
                  patientName={patient.name}
                  canEdit={canEdit}
                />
              </TabsContent>
            )}

            <TabsContent value="documents" className="mt-5">
              <DocumentsTab patientId={patient.id} canEdit={canEdit} />
            </TabsContent>

            <TabsContent value="ledger" className="mt-5">
              <PatientLedgerTab
                patientId={patient.id}
                isAdmin={isAdmin}
                onLedgerChange={handleLedgerChange}
              />
            </TabsContent>

            <TabsContent value="statements" className="mt-5">
              <StatementsTab patientId={patient.id} canGenerate={canEdit} isAdmin={isAdmin} />
            </TabsContent>

            {isAdmin && (
              <TabsContent value="pwa" className="mt-5">
                <PwaAccessTab
                  patientId={patient.id}
                  patientName={patient.name}
                  pwaEnabled={!!patient.pwaAccessEnabled}
                  onChanged={() => {
                    // The side-pin Switch + this tab share state via the patient
                    // object. After a grant/revoke we refetch to sync.
                    setPatient((prev: Patient) => ({
                      ...prev,
                      pwaAccessEnabled: !prev.pwaAccessEnabled,
                    }))
                  }}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* ── Right: bio pin (1/3) ─────────────────────────────────────── */}
        <div className="w-[340px] shrink-0 border-l overflow-y-auto bg-muted/10">
          <div className="p-5 pb-8 space-y-5">
            {/* Avatar + name + ID — square with rounded corners (passport-photo style) */}
            <div className="flex flex-col items-center text-center gap-3 pt-2">
              <Avatar className="h-24 w-24 rounded-lg ring-2 ring-border ring-offset-2 ring-offset-background">
                {patient.profileImage ? (
                  <AvatarImage
                    src={patient.profileImage}
                    alt={patient.name}
                    className="rounded-lg"
                  />
                ) : (
                  <AvatarFallback className="rounded-lg text-2xl font-semibold bg-muted">
                    {patient.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                )}
              </Avatar>
              <div>
                <h2 className="text-base font-bold leading-snug">{patient.name}</h2>
                {patient.patientId && (
                  <p className="text-xs font-mono text-muted-foreground mt-0.5 tracking-wider">
                    {patient.patientId}
                  </p>
                )}
                <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
                  {patient.isChild && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      Child
                    </Badge>
                  )}
                  {/* §2.7 — tag pills replace the legacy "Ortho" badge. */}
                  {patient.tags && patient.tags.length > 0 && (
                    <TagPills tags={patient.tags} className="justify-center" />
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {/* Contact */}
            <div className="space-y-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Contact
              </p>
              <BioRow icon={<Phone className="h-3.5 w-3.5" />} value={patient.phone} />
              <BioRow icon={<Mail className="h-3.5 w-3.5" />} value={patient.email} />
              <BioRow icon={<MapPin className="h-3.5 w-3.5" />} value={patient.address} />
            </div>

            <Separator />

            {/* Personal details */}
            <div className="space-y-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Personal
              </p>
              {dob && !Number.isNaN(dob.getTime()) && (
                <div className="flex items-start gap-2.5 text-sm">
                  <Calendar className="h-3.5 w-3.5 mt-0.5 text-muted-foreground/70 shrink-0" />
                  <div>
                    <p>{format(dob, 'MMM d, yyyy')}</p>
                    {age != null && (
                      <p className="text-xs text-muted-foreground">{age} years old</p>
                    )}
                  </div>
                </div>
              )}
              {patient.gender && (
                <BioRow
                  icon={<User className="h-3.5 w-3.5" />}
                  value={patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)}
                />
              )}
              <BioRow icon={<Globe className="h-3.5 w-3.5" />} value={patient.nationality} />
              <BioRow
                icon={<BriefcaseBusiness className="h-3.5 w-3.5" />}
                value={patient.occupation}
              />
              <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Joined{' '}
                  {patient.createdAt
                    ? (() => {
                        try {
                          return format(new Date(patient.createdAt), 'MMM d, yyyy')
                        } catch {
                          return '—'
                        }
                      })()
                    : '—'}
                </span>
              </div>
            </div>

            {!isDoctor && (
              <>
                <Separator />

                {/* Outstanding balance */}
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Outstanding Balance
                  </p>
                  <div className="flex items-baseline justify-between gap-2">
                    {outstandingBalance === null ? (
                      <div className="h-8 w-24 animate-pulse rounded bg-muted" />
                    ) : (
                      <span
                        className={`text-2xl font-bold tabular-nums ${
                          outstandingBalance > 0
                            ? 'text-destructive'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                        title={formatCurrency(outstandingBalance)}
                      >
                        {formatCurrencyCompact(outstandingBalance)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const url = new URL(window.location.href)
                        url.searchParams.set('tab', 'ledger')
                        navigate(`${url.pathname}${url.search}`)
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      View ledger →
                    </button>
                  </div>
                </div>
              </>
            )}

            {!isDoctor && (
              <>
                <Separator />

                {/* Active payment plans */}
                <div className="space-y-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Payment Plans
                  </p>
                  {activePlans.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No active plans.</p>
                  ) : (
                    <div className="space-y-2">
                      {activePlans.map((plan) => (
                        <div key={plan.id} className="rounded-lg border bg-card p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold capitalize truncate">
                              {plan.templateName ?? `${plan.planType} plan`}
                            </p>
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border capitalize shrink-0 ${
                                plan.status === 'activated'
                                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                  : plan.status === 'overdue'
                                    ? 'text-red-700 bg-red-50 border-red-200'
                                    : 'text-amber-700 bg-amber-50 border-amber-200'
                              }`}
                            >
                              {plan.status}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-muted-foreground">Total</span>
                            <span
                              className="text-xs font-semibold tabular-nums"
                              title={formatCurrency(plan.totalAmount)}
                            >
                              {formatCurrencyCompact(plan.totalAmount)}
                            </span>
                          </div>
                          {plan.amountPerInstallment != null && (
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs text-muted-foreground">Per installment</span>
                              <span
                                className="text-xs font-semibold tabular-nums"
                                title={formatCurrency(plan.amountPerInstallment)}
                              >
                                {formatCurrencyCompact(plan.amountPerInstallment)}
                              </span>
                            </div>
                          )}
                          {plan.paymentFrequency && (
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs text-muted-foreground">Frequency</span>
                              <span className="text-xs font-medium capitalize">
                                {plan.paymentFrequency}
                              </span>
                            </div>
                          )}
                          {/* Guarded on > 0 — a flexible plan has no schedule,
                              so "0 of 0" would be noise rather than progress. */}
                          {plan.installmentsTotal > 0 && (
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs text-muted-foreground">Installments</span>
                              <span className="text-xs font-semibold tabular-nums">
                                {plan.installmentsPaid} of {plan.installmentsTotal}
                              </span>
                            </div>
                          )}
                          {plan.nextDueAt && (
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs text-muted-foreground">Next due</span>
                              <span className="text-xs font-medium">
                                {(() => {
                                  const due = new Date(plan.nextDueAt)
                                  return Number.isNaN(due.getTime())
                                    ? plan.nextDueAt
                                    : format(due, 'MMM d, yyyy')
                                })()}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Guardian (child patients) */}
            {patient.isChild && (patient.guardianName || patient.guardianPhone) && (
              <>
                <Separator />
                <div className="space-y-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Guardian / Parent
                  </p>
                  <BioRow icon={<User className="h-3.5 w-3.5" />} value={patient.guardianName} />
                  <BioRow icon={<Phone className="h-3.5 w-3.5" />} value={patient.guardianPhone} />
                  <BioRow
                    icon={<BriefcaseBusiness className="h-3.5 w-3.5" />}
                    value={patient.guardianOccupation}
                  />
                  <BioRow
                    icon={<MapPin className="h-3.5 w-3.5" />}
                    value={patient.guardianAddress}
                  />
                </div>
              </>
            )}

            {/* Insurance + Emergency contact */}
            {(patient.insuranceProvider || patient.emergencyContactName) && (
              <>
                <Separator />
                <div className="space-y-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Additional
                  </p>
                  {patient.insuranceProvider && (
                    <div className="text-sm space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                        Insurance
                      </p>
                      <p>{patient.insuranceProvider}</p>
                      {patient.insurancePolicyNumber && (
                        <p className="text-xs font-mono text-muted-foreground">
                          {patient.insurancePolicyNumber}
                        </p>
                      )}
                    </div>
                  )}
                  {patient.emergencyContactName && (
                    <div className="text-sm space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                        Emergency Contact
                      </p>
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-muted-foreground/70 shrink-0" />
                        <div>
                          <p>{patient.emergencyContactName}</p>
                          {patient.emergencyContactPhone && (
                            <p className="text-muted-foreground text-xs">
                              {patient.emergencyContactPhone}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {isAdmin && (
              <>
                <Separator />

                {/* Patient portal access — admin-only (grant/revoke is an admin action) */}
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5">
                    <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Patient Portal
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground min-w-0">
                      {patient.pwaAccessEnabled ? (
                        <>
                          <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                            Access enabled
                          </p>
                          <p className="truncate">Login: {patient.patientId} + phone digits</p>
                        </>
                      ) : (
                        <p>Portal access disabled</p>
                      )}
                    </div>
                    <Switch
                      checked={!!patient.pwaAccessEnabled}
                      onCheckedChange={handlePwaToggle}
                      disabled={pwaToggling}
                      aria-label="Toggle patient portal access"
                    />
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* Edit button */}
            {canEdit && !isDoctor && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowEditDialog(true)}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Edit Profile
              </Button>
            )}

            {/* §19.2 — admin-only audit drill-down for this patient */}
            {isAdmin && <ViewAuditHistoryLink entityId={patient.id} className="w-full" />}
          </div>
        </div>
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      {showEditDialog && (
        <EditPatientSheet
          patient={patient}
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          onSaved={onReload}
        />
      )}
    </div>
  )
}
