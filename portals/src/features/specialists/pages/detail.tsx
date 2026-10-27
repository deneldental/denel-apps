import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Banknote, Briefcase, Mail, Pencil, Phone, Stethoscope } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CalendarLinkTab } from '@/features/specialists/components/calendar-link-tab'
import { EditSpecialistSheet } from '@/features/specialists/components/edit-specialist-sheet'
import { SpecialistAccessStep } from '@/features/specialists/components/specialist-access-step'
import { SpecialistStatusButton } from '@/features/specialists/components/specialist-status-button'
import {
  type Commission,
  type CommissionStatus,
  createPayout,
  getSpecialistBalance,
  listSpecialistCommissions,
  postPayout,
  type SpecialistBalance,
} from '@/lib/actions/specialist-payouts'
import { getSpecialist, type Specialist } from '@/lib/actions/specialists'
import { ACTIONS, MODULES } from '@/lib/modules'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Separator } from '@/shared/components/ui/separator'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { formatCurrency } from '@/shared/utils/currency'

// Doctor / specialist management is back in the portal, so the "Manage in HR"
// buttons that used to sit here are gone — the HR Doctors pages they linked to
// no longer exist. Creation lives on the list page (Add specialist).
//
// TODO: per-section editing has not been rebuilt here yet. `updateSpecialist`
// in lib/actions/specialists.ts is the endpoint to wire an edit sheet to.

// ── Tab model (PR-16) ─────────────────────────────────────────────────────
//
// Specialist detail mirrors the staff detail page layout: flat top tabs on
// the left, a 340px bio pane on the right. The Profile tab is structured
// into Identity + Commission sub-steps — there's no Access step (specialist
// access flows through the linked staff record for internal specialists).

// One tab strip. There used to be two nested levels — a top [Profile |
// Commissions] and, inside Profile, [Identity | Commission | Access] — which
// meant two different things called "Commission" (the rate/payout card, and the
// ledger) sitting a click apart. They are now one tab: terms on top, then the
// ledger that those terms produce.
type SpecialistTab = 'identity' | 'commission' | 'access' | 'calendar'

const TABS: Array<{ id: SpecialistTab; label: string }> = [
  { id: 'identity', label: 'Identity' },
  { id: 'commission', label: 'Commission' },
  { id: 'access', label: 'Access' },
  { id: 'calendar', label: 'Calendar link' },
]

const STATUS_VARIANT: Record<
  CommissionStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  accrued: 'outline',
  payable: 'secondary',
  paid: 'default',
  reversed: 'destructive',
}

// No shared query-key group exists for a specialist's payout balance or its
// commission ledger — local literals, module-scoped, shared by the reads
// below and the invalidation in `refresh()` / `_handleSaved`.
const specialistBalanceKey = (specialistId: string) =>
  ['specialists', specialistId, 'balance'] as const
const specialistCommissionsKey = (specialistId: string, status: 'all' | CommissionStatus) =>
  ['specialists', specialistId, 'commissions', status] as const

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

export default function SpecialistDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const _navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // HR-L11: "Issue payout" posts a GL entry + flips commissions to paid — hide it
  // from users who can't create commission payouts (backend also enforces).
  const { hasPermission } = usePermissions()
  const canIssuePayout = hasPermission(MODULES.COMMISSIONS as string, ACTIONS.CREATE as string)
  // HR-L11: editing a specialist's commission config is privileged (specialists:update).
  const canEditCommission = hasPermission(MODULES.SPECIALISTS as string, ACTIONS.UPDATE as string)

  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<'all' | CommissionStatus>('all')

  const {
    data: specialist,
    isLoading: loading,
    refetch: refetchSpecialist,
  } = useApiQuery(queryKeys.specialists.detail(id), () => getSpecialist(id))

  const { data: balance = null, refetch: refetchBalance } = useApiQuery(
    specialistBalanceKey(id),
    () => getSpecialistBalance(id)
  )

  const { data: commissions = [], refetch: refetchCommissions } = useApiQuery(
    specialistCommissionsKey(id, statusFilter),
    () =>
      listSpecialistCommissions(
        id,
        statusFilter === 'all' ? undefined : { status: statusFilter as CommissionStatus }
      )
  )

  // Kept as a stable name for the callbacks below (edit sheet save, calendar
  // link change, access-tab permission change, payout post) — each of those
  // touches data across all three reads, so re-fetch all three rather than
  // have every caller know which subset to invalidate.
  function refresh() {
    void refetchSpecialist()
    void refetchBalance()
    void refetchCommissions()
  }

  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = new Date()
  firstOfMonth.setDate(1)
  const [periodStart, setPeriodStart] = useState(firstOfMonth.toISOString().slice(0, 10))
  const [periodEnd, setPeriodEnd] = useState(today)
  const [payoutOpen, setPayoutOpen] = useState(false)
  // Free-form so the configurable lookup's slug submits verbatim; re-narrowed to
  // `postPayout`'s method union only at the call boundary.
  const [payoutMethod, setPayoutMethod] = useState<string>('bank_transfer')
  const [busy, setBusy] = useState(false)

  // Lifted out of the removed ProfileSection: Identity and Commission both open
  // the same sheet, and they are now sibling tabs rather than nested steps.
  const [editOpen, setEditOpen] = useState(false)

  const activeTab = useMemo<SpecialistTab>(() => {
    const v = searchParams.get('tab')
    // `commissions` (plural) was the old top-level ledger tab; keep saved links
    // and back-navigation working now that it is merged into `commission`.
    if (v === 'commission' || v === 'commissions') return 'commission'
    if (v === 'access') return 'access'
    if (v === 'calendar') return 'calendar'
    return 'identity'
  }, [searchParams])

  function setTab(next: SpecialistTab) {
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        out.set('tab', next)
        out.delete('step') // legacy param from the nested layout
        return out
      },
      { replace: true }
    )
  }

  // After an edit on this page, refetch the detail AND invalidate the list
  // query so the specialists table reflects the change on back-navigation
  // (the list is a separate React Query cache that `refresh` alone never touches).
  function handleSaved() {
    refresh()
    queryClient.invalidateQueries({ queryKey: queryKeys.specialists.all })
  }

  async function onCreatePayout() {
    setBusy(true)
    const draft = await createPayout({
      specialistId: id,
      periodStart,
      periodEnd,
    })
    if (!draft.success || !draft.data) {
      setBusy(false)
      return toast.error(draft.error ?? 'Failed to draft payout')
    }
    const post = await postPayout(draft.data.id, {
      method: payoutMethod as Parameters<typeof postPayout>[1]['method'],
    })
    setBusy(false)
    if (!post.success) return toast.error(post.error ?? 'Failed to post payout')
    toast.success(
      `Posted payout ${draft.data.payoutNumber} — JE ${post.data?.journalEntry.entryNumber ?? ''}`
    )
    setPayoutOpen(false)
    refresh()
  }

  if (loading) return <Skeleton className="m-6 h-64" />
  if (!specialist) return <div className="p-6 text-red-600">Specialist not found</div>

  const payable = balance?.payableAmount ?? 0

  return (
    <div className="flex h-full flex-col">
      {/* ── Breadcrumb bar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild aria-label="Go back">
            <Link to="/specialists" aria-label="Back to specialists">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/specialists" className="hover:underline hover:text-foreground">
              Specialists
            </Link>
            <span>/</span>
            <span className="font-medium text-foreground">{specialist.name}</span>
          </nav>
        </div>
        <SpecialistStatusButton specialist={specialist} onChanged={handleSaved} />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: tabs */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <EditSpecialistSheet
            specialist={specialist}
            open={editOpen}
            onOpenChange={setEditOpen}
            onSaved={handleSaved}
          />

          <Tabs value={activeTab} onValueChange={(v) => setTab(v as SpecialistTab)}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="identity" className="mt-5">
              <IdentityStep
                specialist={specialist}
                canEdit={canEditCommission}
                onEdit={() => setEditOpen(true)}
              />
            </TabsContent>

            <TabsContent value="commission" className="mt-5">
              {/* Terms first, then the ledger those terms produce. */}
              <div className="space-y-5">
                <CommissionStep
                  specialist={specialist}
                  canEdit={canEditCommission}
                  onEdit={() => setEditOpen(true)}
                />
                <CommissionsTab
                  balance={balance}
                  commissions={commissions}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  onIssuePayout={() => setPayoutOpen(true)}
                  payable={payable}
                  canIssuePayout={canIssuePayout}
                />
              </div>
            </TabsContent>

            <TabsContent value="access" className="mt-5">
              <SpecialistAccessStep specialist={specialist} onChanged={handleSaved} />
            </TabsContent>

            <TabsContent value="calendar" className="mt-5">
              <CalendarLinkTab
                specialist={specialist}
                canEdit={canEditCommission}
                onChanged={refresh}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: bio pane */}
        <SpecialistBioPane specialist={specialist} />
      </div>

      <Dialog open={payoutOpen} onOpenChange={setPayoutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue payout to {specialist.name}</DialogTitle>
            <DialogDescription>
              Bundles every `payable` commission in the selected period and posts the journal entry.
              The matching commission rows transition to `paid`.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Period start</Label>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div>
                <Label>Period end</Label>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Payment method</Label>
              <PaymentMethodSelect
                value={payoutMethod}
                onValueChange={setPayoutMethod}
                placeholder="Select method"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Total payable across all periods is {formatCurrency(payable)} — only the portion in
              this date range will be included.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setPayoutOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onCreatePayout} disabled={busy}>
              {busy ? 'Posting…' : 'Create & post payout'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Bio pane ──────────────────────────────────────────────────────────────

function SpecialistBioPane({ specialist }: { specialist: Specialist }) {
  const isExternal = specialist.specialistType === 'external'
  return (
    <div className="hidden w-[340px] shrink-0 overflow-y-auto border-l bg-muted/10 lg:block">
      <div className="space-y-5 p-5 pb-8">
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <Avatar className="h-24 w-24 rounded-lg ring-2 ring-border ring-offset-2 ring-offset-background">
            {specialist.profileImage ? (
              <AvatarImage
                src={specialist.profileImage}
                alt={specialist.name}
                className="rounded-lg"
              />
            ) : (
              <AvatarFallback className="rounded-lg bg-muted text-2xl font-semibold">
                {getInitials(specialist.name)}
              </AvatarFallback>
            )}
          </Avatar>
          <div>
            <h2 className="text-base font-bold leading-snug">{specialist.name}</h2>
            {specialist.specialty && (
              <p className="mt-0.5 text-xs italic text-muted-foreground">{specialist.specialty}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <Badge
                variant={specialist.isActive ? 'default' : 'outline'}
                className="h-4 px-1.5 text-[10px] capitalize"
              >
                {specialist.isActive ? 'active' : 'inactive'}
              </Badge>
              <Badge
                variant={isExternal ? 'outline' : 'secondary'}
                className="h-4 px-1.5 text-[10px]"
              >
                {isExternal ? 'External' : 'Internal'}
              </Badge>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Contact
          </p>
          <BioRow icon={<Mail className="h-3.5 w-3.5" />} value={specialist.contactEmail} />
          <BioRow icon={<Phone className="h-3.5 w-3.5" />} value={specialist.contactPhone} />
        </div>

        {specialist.defaultCommissionRate > 0 && (
          <>
            <Separator />
            <div className="space-y-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Commission
              </p>
              <BioRow
                icon={<Banknote className="h-3.5 w-3.5" />}
                value={`${specialist.defaultCommissionRate}% per service`}
              />
              {specialist.payoutMethod && (
                <BioRow
                  icon={<Briefcase className="h-3.5 w-3.5" />}
                  value={specialist.payoutMethod.replace(/_/g, ' ')}
                  valueClassName="capitalize"
                />
              )}
            </div>
          </>
        )}
      </div>
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

// ── Profile section ───────────────────────────────────────────────────────

function IdentityStep({
  specialist,
  canEdit,
  onEdit,
}: {
  specialist: Specialist
  canEdit: boolean
  onEdit: () => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            Identity
          </CardTitle>
          <CardDescription>
            Name, specialisation, contact, and internal/external type.
          </CardDescription>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" value={specialist.name} />
          <Field label="Specialisation" value={specialist.specialty} />
          <Field label="Email" value={specialist.contactEmail} />
          <Field label="Phone" value={specialist.contactPhone} />
          <Field
            label="Type"
            value={specialist.specialistType === 'internal' ? 'Internal' : 'External'}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function CommissionStep({
  specialist,
  canEdit,
  onEdit,
}: {
  specialist: Specialist
  canEdit: boolean
  onEdit: () => void
}) {
  const receivesCommission = specialist.defaultCommissionRate > 0
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            Commission
          </CardTitle>
          <CardDescription>
            Whether this specialist earns commission, the rate, and how they get paid.
          </CardDescription>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {receivesCommission ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Commission rate" value={`${specialist.defaultCommissionRate}%`} />
            <Field
              label="Payout method"
              value={specialist.payoutMethod?.replace(/_/g, ' ') ?? null}
              capitalize
            />
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            This specialist does not receive commission. (Internal specialists are typically paid
            via payroll, not commission.)
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  value,
  capitalize,
}: {
  label: string
  value: string | null | undefined
  capitalize?: boolean
}) {
  return (
    <div>
      <h4 className="text-sm font-medium text-muted-foreground">{label}</h4>
      <p
        className={cn(
          'text-sm',
          capitalize && 'capitalize',
          !value && 'italic text-muted-foreground'
        )}
      >
        {value || '—'}
      </p>
    </div>
  )
}

// ── Commissions tab ───────────────────────────────────────────────────────

function CommissionsTab({
  balance,
  commissions,
  statusFilter,
  onStatusFilterChange,
  onIssuePayout,
  payable,
  canIssuePayout,
}: {
  balance: SpecialistBalance | null
  commissions: Commission[]
  statusFilter: 'all' | CommissionStatus
  onStatusFilterChange: (s: 'all' | CommissionStatus) => void
  onIssuePayout: () => void
  payable: number
  canIssuePayout: boolean
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Accrued (awaiting patient payment)</CardDescription>
            <CardTitle className="text-2xl font-mono">
              {formatCurrency(balance?.accruedAmount ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Payable (ready to pay)</CardDescription>
            <CardTitle className="text-2xl font-mono text-emerald-600">
              {formatCurrency(payable)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Paid lifetime</CardDescription>
            <CardTitle className="text-2xl font-mono">
              {formatCurrency(balance?.paidAmount ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => onStatusFilterChange(v as 'all' | CommissionStatus)}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="accrued">Accrued</TabsTrigger>
            <TabsTrigger value="payable">Payable</TabsTrigger>
            <TabsTrigger value="paid">Paid</TabsTrigger>
            <TabsTrigger value="reversed">Reversed</TabsTrigger>
          </TabsList>
        </Tabs>
        {canIssuePayout && (
          <Button onClick={onIssuePayout} disabled={payable <= 0}>
            Issue payout
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          {commissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commissions in this view.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Accrued</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Gross line</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Payable</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">{c.accruedAt.slice(0, 10)}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {c.invoice?.invoiceNumber ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(c.grossAmount)}
                    </TableCell>
                    <TableCell className="text-right">{c.commissionRate}%</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(c.commissionAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(c.payableAmount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
