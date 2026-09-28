import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  Copy,
  Edit3,
  FileText,
  KeyRound,
  MonitorSmartphone,
  MoreVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  UserCog,
  UserX,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  createKioskDevice,
  deactivateKioskOperator,
  deleteKioskDevice,
  getKioskDeviceOperations,
  getKioskDevices,
  getKioskOperators,
  type KioskDevice,
  type KioskOperator,
  reissueKioskCode,
  revokeKioskDevice,
  setKioskOperator,
  updateKioskDevice,
  updateKioskOperator,
} from '@/lib/actions/kiosk-admin'
import { listSpecialists } from '@/lib/actions/specialists'
import { getStaff } from '@/lib/actions/staff'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'

// Surfaces a kiosk station can run (mirrors backend VALID_SURFACES).
const SURFACES = ['xrays', 'consents', 'clinical', 'doctor_station'] as const
type Surface = (typeof SURFACES)[number]
const SURFACE_LABEL: Record<Surface, string> = {
  xrays: 'X-rays',
  consents: 'Consent signing',
  clinical: 'Clinical Workspace / Doctor Kiosk',
  doctor_station: 'Doctor Station (Shared)',
}

// Capabilities provisionable per surface.
const CAPS_BY_SURFACE: Record<Surface, string[]> = {
  xrays: ['can_capture', 'can_share'],
  consents: ['can_sign'],
  clinical: ['can_diagnose', 'can_prescribe', 'can_chart'],
  doctor_station: ['can_diagnose', 'can_prescribe', 'can_chart'],
}

function surfaceCaps(op: KioskOperator, surface: Surface): string[] {
  const caps = op.capabilities?.[surface]
  return Array.isArray(caps) ? caps : []
}

interface StaffLite {
  id: string
  fullName: string
  rawName: string
  isDoctor: boolean
  title: 'Dr.' | 'DT.'
  specialty?: string | null
}

interface RevealCode {
  deviceId?: string
  label: string
  code: string
  expiresAt: string | null
}

// Live mm:ss countdown for a one-time pairing code
function CodeCountdown({ expiresAt }: { expiresAt: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!expiresAt) return null
  const msLeft = new Date(expiresAt).getTime() - now
  if (msLeft <= 0) {
    return <span className="text-sm font-semibold text-red-600">Expired — re-issue the code</span>
  }
  const totalSec = Math.floor(msLeft / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  const urgent = totalSec <= 60
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums ${
        urgent ? 'text-red-600' : 'text-[#7C5B27] dark:text-[#E4C076]'
      }`}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${
            urgent ? 'bg-red-500' : 'bg-[#B8873A]'
          }`}
        />
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            urgent ? 'bg-red-500' : 'bg-[#B8873A]'
          }`}
        />
      </span>
      Expires in {mm}:{ss}
    </span>
  )
}

export default function KioskAdminPage() {
  const [devices, setDevices] = useState<KioskDevice[]>([])
  const [operators, setOperators] = useState<KioskOperator[]>([])

  // Reference-data reads (staff directory + specialist directory, used only to
  // label operators as Dr./DT. and infer their specialty) — migrated off the
  // combined `load()` below since neither changes when a kiosk device/operator
  // is mutated. Device + operator state stays local: it's tangled with the
  // pairing-code polling/countdown machinery below (auto-detect pairing,
  // 2.5s poll, banners), which isn't a plain fetch-into-state swap.
  const { data: staffRaw = [] } = useApiQuery(queryKeys.staff.list(), () => getStaff())
  const { data: specialistsRaw = [] } = useApiQuery(queryKeys.specialists.list(), () =>
    listSpecialists()
  )
  const staff = useMemo<StaffLite[]>(() => {
    // `Specialist` doesn't declare `staffId` in its TS type, but the backend
    // row carries it — same runtime-only field the pre-migration code relied on.
    const specialistsList = specialistsRaw as Array<{
      staffId?: string
      userId?: string
      isActive?: boolean
      specialty?: string | null
    }>
    return (staffRaw as Array<{ id: string; fullName: string; userId?: string | null }>).map(
      (x) => {
        const spec = specialistsList.find(
          (sp) => sp.staffId === x.id || (x.userId && sp.userId === x.userId)
        )
        const isDoctor = Boolean(spec && spec.isActive !== false)
        const title = isDoctor ? ('Dr.' as const) : ('DT.' as const)
        const rawName = (x.fullName || '').replace(/^(Dr\.|DT\.|Doctor|Technician)\s+/i, '').trim()
        return {
          id: x.id,
          rawName,
          fullName: `${title} ${rawName}`,
          isDoctor,
          title,
          specialty: spec?.specialty || (isDoctor ? 'Doctor' : 'Dental Technician'),
        }
      }
    )
  }, [staffRaw, specialistsRaw])
  const [revealCode, setRevealCode] = useState<RevealCode | null>(null)
  const [pairedNotice, setPairedNotice] = useState<{ label: string } | null>(null)

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [opModalConfig, setOpModalConfig] = useState<{
    open: boolean
    initialStaffId?: string
    initialSurface?: Surface
    initialCaps?: string[]
    isEditing?: boolean
  }>({ open: false })
  const [resetPinTarget, setResetPinTarget] = useState<{
    staffId: string
    name: string
    isDoctor: boolean
  } | null>(null)

  const load = useCallback(async () => {
    const [d, o] = await Promise.all([getKioskDevices(), getKioskOperators()])
    if (d.success && d.data) {
      setDevices(d.data)
    }
    if (o.success && o.data) setOperators(o.data)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Polling for device pairing status when a pairing code is active
  useEffect(() => {
    if (!revealCode) return
    const timer = setInterval(async () => {
      const res = await getKioskDevices()
      if (res.success && res.data) {
        setDevices(res.data)
        const target = res.data.find(
          (d) =>
            (revealCode.deviceId && d.id === revealCode.deviceId && d.isPaired) ||
            (!revealCode.deviceId && d.label === revealCode.label && d.isPaired)
        )
        if (target) {
          setRevealCode(null)
          setPairedNotice({ label: target.label })
          toast.success(`Station "${target.label}" paired successfully!`)
          load()
        }
      }
    }, 2500)
    return () => clearInterval(timer)
  }, [revealCode, load])

  // Auto-dismiss the pairing success notification after 7 seconds
  useEffect(() => {
    if (!pairedNotice) return
    const t = setTimeout(() => setPairedNotice(null), 7000)
    return () => clearTimeout(t)
  }, [pairedNotice])

  const staffName = (id: string) => staff.find((s) => s.id === id)?.fullName ?? id
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? null

  async function revoke(id: string) {
    const res = await revokeKioskDevice(id)
    if (res.success) {
      toast.success('Device revoked')
      load()
    } else toast.error(res.error || 'Failed')
  }

  async function remove(id: string) {
    const res = await deleteKioskDevice(id)
    if (res.success) {
      toast.success('Device deleted')
      if (selectedDeviceId === id) setSelectedDeviceId(null)
      load()
    } else toast.error(res.error || 'Failed to delete')
  }

  async function reissue(d: KioskDevice) {
    const res = await reissueKioskCode(d.id)
    if (res.success && res.data) {
      setRevealCode({
        deviceId: d.id,
        label: d.label,
        code: res.data.pairingCode,
        expiresAt: res.data.pairingExpiresAt,
      })
      toast.success('New pairing code generated')
      load()
    } else toast.error(res.error || 'Failed')
  }

  async function toggleOperatorActive(staffId: string, currentActive: boolean) {
    if (currentActive) {
      const res = await deactivateKioskOperator(staffId)
      if (res.success) {
        toast.success('Operator disabled')
        load()
      } else toast.error(res.error || 'Failed')
    } else {
      const res = await updateKioskOperator(staffId, { isActive: true })
      if (res.success) {
        toast.success('Operator enabled')
        load()
      } else toast.error(res.error || 'Failed to enable operator')
    }
  }

  return (
    <div className="space-y-8 p-6">
      {/* Active Pairing Code Banner */}
      {revealCode && (
        <div className="rounded-xl border border-[#B8873A]/40 bg-[#B8873A]/10 p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              Pairing code for <span className="font-semibold">{revealCode.label}</span> — enter it
              on the device. Code will automatically dismiss once paired.
            </p>
            <CodeCountdown expiresAt={revealCode.expiresAt} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <code className="rounded-lg bg-background px-3 py-2 font-mono text-xl font-bold tracking-widest text-primary shadow-inner">
              {revealCode.code}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(revealCode.code)
                toast.success('Copied pairing code')
              }}
            >
              <Copy className="mr-1.5 h-4 w-4" /> Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRevealCode(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Paired Successfully Banner */}
      {pairedNotice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                  Device Paired Successfully!
                </p>
                <p className="text-xs text-emerald-800 dark:text-emerald-200/90">
                  Station <span className="font-bold">{pairedNotice.label}</span> is now active,
                  connected, and ready for operator PIN login.
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPairedNotice(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Devices Section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <MonitorSmartphone className="h-5 w-5 text-primary" /> Kiosk devices
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Click any device to manage settings, view operations timeline, and assign operators.
            </p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Pair a device
          </Button>
        </div>

        {devices.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <MonitorSmartphone className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
            <p className="text-sm font-medium">No kiosk devices paired yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Pair your first tablet or PC to enable shared clinical stations.
            </p>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Pair a device
            </Button>
          </div>
        ) : (
          <div className="divide-y rounded-lg border bg-card shadow-sm overflow-hidden">
            {devices.map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedDeviceId(d.id)}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedDeviceId(d.id)}
                className="group flex cursor-pointer items-center justify-between gap-4 p-3.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <MonitorSmartphone className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground group-hover:text-primary transition-colors">
                        {d.label}
                      </p>
                      <Badge variant="outline" className="text-xs font-normal">
                        {SURFACE_LABEL[d.surface as Surface] ?? d.surface}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {!d.isActive
                        ? 'Revoked'
                        : d.isPaired
                          ? `Paired${d.lastSeenAt ? ` · last seen ${new Date(d.lastSeenAt).toLocaleString()}` : ''}`
                          : 'Pending pairing'}
                      {d.location ? ` · ${d.location}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant={d.isActive ? (d.isPaired ? 'default' : 'secondary') : 'outline'}
                    className={
                      d.isPaired && d.isActive
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : undefined
                    }
                  >
                    {!d.isActive ? 'revoked' : d.isPaired ? 'paired' : 'pending'}
                  </Badge>

                  {d.isActive ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          reissue(d)
                        }}
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Re-issue code
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Revoke device"
                        onClick={(e) => {
                          e.stopPropagation()
                          revoke(d.id)
                        }}
                      >
                        <ShieldOff className="h-4 w-4 text-muted-foreground hover:text-amber-600" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Delete device"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(d.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Global Operators Section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <UserCog className="h-5 w-5 text-primary" /> Kiosk operators
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Staff members provisioned with PIN access and station capabilities.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() =>
              setOpModalConfig({
                open: true,
                initialSurface: SURFACES[0],
                initialCaps: CAPS_BY_SURFACE[SURFACES[0]],
              })
            }
          >
            <Plus className="mr-1.5 h-4 w-4" /> Set operator PIN
          </Button>
        </div>

        {operators.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <UserCog className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
            <p className="text-sm font-medium">No operators provisioned</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Set a 6-digit PIN for doctors or dental technicians to operate kiosks.
            </p>
            <Button
              size="sm"
              onClick={() =>
                setOpModalConfig({
                  open: true,
                  initialSurface: SURFACES[0],
                  initialCaps: CAPS_BY_SURFACE[SURFACES[0]],
                })
              }
            >
              <Plus className="mr-1.5 h-4 w-4" /> Set operator PIN
            </Button>
          </div>
        ) : (
          <div className="divide-y rounded-lg border bg-card shadow-sm overflow-hidden">
            {operators.map((o) => {
              const opStaff = staff.find((s) => s.id === o.staffId)
              const isDoctor = opStaff?.isDoctor ?? false
              const name = opStaff?.fullName ?? staffName(o.staffId)
              return (
                <div key={o.id} className="flex items-center justify-between gap-4 p-3.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground">{name}</p>
                      <Badge
                        variant="secondary"
                        className={`text-xs ${
                          isDoctor
                            ? 'bg-primary/10 text-primary border-primary/25 dark:bg-primary/25 dark:text-primary-foreground'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}
                      >
                        {isDoctor ? 'Dr. / Doctor' : 'Dental Technician'}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {Object.entries(o.capabilities).flatMap(([surface, caps]) =>
                        caps.map((cap) => (
                          <Badge
                            key={`${surface}:${cap}`}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {SURFACE_LABEL[surface as Surface] ?? surface}:{cap}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!o.isActive && <Badge variant="outline">disabled</Badge>}
                    {o.lockedUntil && new Date(o.lockedUntil) > new Date() && (
                      <Badge variant="destructive">locked</Badge>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setResetPinTarget({
                          staffId: o.staffId,
                          name,
                          isDoctor,
                        })
                      }
                    >
                      <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Reset PIN
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleOperatorActive(o.staffId, o.isActive)}
                    >
                      {o.isActive ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Slide-in Device Detail Sheet */}
      <KioskDeviceDetailSheet
        device={selectedDevice}
        open={Boolean(selectedDevice)}
        onOpenChange={(open) => {
          if (!open) setSelectedDeviceId(null)
        }}
        staff={staff}
        operators={operators}
        onRefresh={load}
        onRevoke={revoke}
        onDelete={remove}
        onResetPin={(op) => setResetPinTarget(op)}
        onOpenAssignOperator={(surface) =>
          setOpModalConfig({
            open: true,
            initialSurface: surface,
            initialCaps: CAPS_BY_SURFACE[surface],
          })
        }
        onEditOperatorCaps={(staffId, surface, caps) =>
          setOpModalConfig({
            open: true,
            initialStaffId: staffId,
            initialSurface: surface,
            initialCaps: caps,
            isEditing: true,
          })
        }
      />

      {/* Add Device Dialog */}
      <AddDeviceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(label, code, expiresAt, deviceId) => {
          setRevealCode({ deviceId, label, code, expiresAt })
          load()
        }}
      />

      {/* Set / Assign Operator Dialog */}
      <SetOperatorDialog
        open={opModalConfig.open}
        onOpenChange={(open) => setOpModalConfig((prev) => ({ ...prev, open }))}
        staff={staff}
        initialStaffId={opModalConfig.initialStaffId}
        initialSurface={opModalConfig.initialSurface}
        initialCaps={opModalConfig.initialCaps}
        isEditing={opModalConfig.isEditing}
        onSaved={() => {
          setOpModalConfig({ open: false })
          load()
        }}
      />

      {/* Reset PIN Dialog */}
      <ResetPinDialog
        open={Boolean(resetPinTarget)}
        onOpenChange={(open) => {
          if (!open) setResetPinTarget(null)
        }}
        target={resetPinTarget}
        onSaved={() => {
          setResetPinTarget(null)
          load()
        }}
      />
    </div>
  )
}

// ── Slide-in Details Sheet for a Kiosk Device ───────────────────────────────

function KioskDeviceDetailSheet({
  device,
  open,
  onOpenChange,
  staff,
  operators,
  onRefresh,
  onRevoke,
  onDelete,
  onResetPin,
  onOpenAssignOperator,
  onEditOperatorCaps,
}: {
  device: KioskDevice | null
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: StaffLite[]
  operators: KioskOperator[]
  onRefresh: () => void
  onRevoke: (id: string) => void
  onDelete: (id: string) => void
  onResetPin: (op: { staffId: string; name: string; isDoctor: boolean }) => void
  onOpenAssignOperator: (surface: Surface) => void
  onEditOperatorCaps: (staffId: string, surface: Surface, caps: string[]) => void
}) {
  const [activeTab, setActiveTab] = useState<'settings' | 'operators' | 'operations'>('settings')

  // Settings form state
  const [label, setLabel] = useState('')
  const [location, setLocation] = useState('')
  const [surface, setSurface] = useState<Surface>('xrays')
  const [saving, setSaving] = useState(false)

  // Operations activity log — a clean fetch-into-state swap (unlike the
  // devices/operators state above, this isn't tangled with pairing polling).
  const {
    data: operations = [],
    isFetching: loadingOps,
    refetch: refetchOperations,
  } = useApiQuery(
    ['kiosk', 'devices', device?.id ?? 'none', 'operations'] as const,
    () => getKioskDeviceOperations(device!.id),
    { enabled: open && activeTab === 'operations' && !!device }
  )

  // Sheet-specific pairing code state & close caution dialog
  const [sheetRevealCode, setSheetRevealCode] = useState<RevealCode | null>(null)
  const [reissuing, setReissuing] = useState(false)
  const [showCloseCautionDialog, setShowCloseCautionDialog] = useState(false)
  const [pairedSuccessNotice, setPairedSuccessNotice] = useState<string | null>(null)

  useEffect(() => {
    if (device) {
      setLabel(device.label)
      setLocation(device.location || '')
      setSurface((device.surface as Surface) || 'xrays')
    }
  }, [device])

  // Reset pairing state when sheet closes
  useEffect(() => {
    if (!open) {
      setSheetRevealCode(null)
      setShowCloseCautionDialog(false)
      setPairedSuccessNotice(null)
    }
  }, [open])

  // Auto-detect pairing completion for sheet pairing code
  useEffect(() => {
    if (!sheetRevealCode || !open) return
    const timer = setInterval(async () => {
      const res = await getKioskDevices()
      if (res.success && res.data) {
        const target = res.data.find(
          (d) =>
            (sheetRevealCode.deviceId && d.id === sheetRevealCode.deviceId && d.isPaired) ||
            (!sheetRevealCode.deviceId && d.label === sheetRevealCode.label && d.isPaired)
        )
        if (target) {
          setSheetRevealCode(null)
          setPairedSuccessNotice(`Station "${target.label}" paired successfully!`)
          toast.success(`Station "${target.label}" paired successfully!`)
          onRefresh()
        }
      }
    }, 2500)
    return () => clearInterval(timer)
  }, [sheetRevealCode, open, onRefresh])

  if (!device) return null

  const stationSurface = device.surface as Surface

  // Filter operators assigned to this station's surface
  const stationOperators = operators.filter(
    (o) => surfaceCaps(o, stationSurface).length > 0 && o.isActive
  )

  async function handleSaveSettings() {
    if (!device || !label.trim()) return
    setSaving(true)
    const res = await updateKioskDevice(device.id, {
      label: label.trim(),
      location: location.trim() || null,
      surface,
    })
    setSaving(false)
    if (res.success) {
      toast.success('Station settings updated')
      onRefresh()
    } else {
      toast.error(res.error || 'Failed to update settings')
    }
  }

  async function handleReissueInsideSheet() {
    if (!device) return
    setReissuing(true)
    const res = await reissueKioskCode(device.id)
    setReissuing(false)
    if (res.success && res.data) {
      setSheetRevealCode({
        deviceId: device.id,
        label: device.label,
        code: res.data.pairingCode,
        expiresAt: res.data.pairingExpiresAt,
      })
      setPairedSuccessNotice(null)
      toast.success('New pairing code generated for this station')
      onRefresh()
    } else {
      toast.error(res.error || 'Failed to generate pairing code')
    }
  }

  function handleSheetOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      if (sheetRevealCode) {
        setShowCloseCautionDialog(true)
        return
      }
      onOpenChange(false)
    } else {
      onOpenChange(true)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleSheetOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-6">
          <SheetHeader className="pb-4 border-b">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <MonitorSmartphone className="h-6 w-6" />
                </div>
                <div>
                  <SheetTitle className="text-xl font-bold">{device.label}</SheetTitle>
                  <SheetDescription className="text-xs flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[11px] font-medium">
                      {SURFACE_LABEL[stationSurface] ?? device.surface}
                    </Badge>
                    {device.location && <span>· {device.location}</span>}
                  </SheetDescription>
                </div>
              </div>
              <Badge
                variant={device.isActive ? (device.isPaired ? 'default' : 'secondary') : 'outline'}
                className={
                  device.isPaired && device.isActive
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs'
                    : 'text-xs'
                }
              >
                {!device.isActive ? 'revoked' : device.isPaired ? 'paired' : 'pending'}
              </Badge>
            </div>

            {/* Quick Actions Bar */}
            <div className="mt-4 flex flex-wrap items-center gap-2 pt-2 border-t">
              {device.isActive ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reissuing}
                    onClick={handleReissueInsideSheet}
                  >
                    <RotateCcw
                      className={`mr-1.5 h-3.5 w-3.5 ${reissuing ? 'animate-spin' : ''}`}
                    />{' '}
                    {reissuing ? 'Generating code…' : 'Re-issue pairing code'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                    onClick={() => onRevoke(device.id)}
                  >
                    <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> Revoke station
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                  onClick={() => onDelete(device.id)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete permanently
                </Button>
              )}
            </div>

            {/* Active Pairing Code Banner inside Sheet */}
            {sheetRevealCode && (
              <div className="mt-4 rounded-xl border border-[#B8873A]/40 bg-[#B8873A]/10 p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 text-left">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    Pairing code for <span className="font-semibold">{device.label}</span> — enter
                    on the device:
                  </p>
                  <CodeCountdown expiresAt={sheetRevealCode.expiresAt} />
                </div>
                <div className="mt-3 flex items-center gap-2.5">
                  <code className="rounded-lg bg-background px-3.5 py-2 font-mono text-xl font-bold tracking-widest text-primary shadow-inner">
                    {sheetRevealCode.code}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(sheetRevealCode.code)
                      toast.success('Copied pairing code')
                    }}
                  >
                    <Copy className="mr-1.5 h-4 w-4" /> Copy
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowCloseCautionDialog(true)}>
                    Cancel
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Note: Closing this panel while a pairing code is active will discard/revoke this
                  pairing session.
                </p>
              </div>
            )}

            {/* Paired Successfully Banner inside Sheet */}
            {pairedSuccessNotice && (
              <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 text-left">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                        Device Paired Successfully!
                      </p>
                      <p className="text-xs text-emerald-800 dark:text-emerald-200/90">
                        This station is now active and ready for PIN unlock.
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setPairedSuccessNotice(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </SheetHeader>

          {/* Tabs for Settings, Operators, Operations */}
          <div className="mt-6">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as 'settings' | 'operators' | 'operations')}
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="settings" className="flex items-center gap-1.5">
                  <Settings className="h-4 w-4" /> Settings
                </TabsTrigger>
                <TabsTrigger value="operators" className="flex items-center gap-1.5">
                  <UserCog className="h-4 w-4" /> Operators ({stationOperators.length})
                </TabsTrigger>
                <TabsTrigger value="operations" className="flex items-center gap-1.5">
                  <Activity className="h-4 w-4" /> Operations
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: Device Settings */}
              <TabsContent value="settings" className="mt-6 space-y-6">
                <div className="grid gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="device-label">Station Label / Name</Label>
                    <Input
                      id="device-label"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="e.g. Doctor Station 1, X-ray Room PC"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="device-location">Location / Room</Label>
                    <Input
                      id="device-location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="e.g. Room 204, Ground Floor X-ray Lab"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="device-surface">Surface Application Scope</Label>
                    <select
                      id="device-surface"
                      value={surface}
                      onChange={(e) => setSurface(e.target.value as Surface)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {SURFACES.map((s) => (
                        <option key={s} value={s}>
                          {SURFACE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Determines what UI surface loads on this device when unlocked.
                    </p>
                  </div>
                </div>

                {/* Connection Details Card */}
                <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Connection Metadata
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Pairing Status:</span>
                      <p className="font-medium mt-0.5">
                        {device.isPaired ? 'Connected & Active' : 'Pending device pairing'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Paired At:</span>
                      <p className="font-medium mt-0.5">
                        {device.pairedAt ? new Date(device.pairedAt).toLocaleString() : 'Not yet'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Last Seen:</span>
                      <p className="font-medium mt-0.5">
                        {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : 'Never'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Created:</span>
                      <p className="font-medium mt-0.5">
                        {new Date(device.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="pt-2 border-t text-[11px] text-muted-foreground flex items-center justify-between">
                    <span className="font-mono">ID: {device.id}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        navigator.clipboard?.writeText(device.id)
                        toast.success('Copied Device ID')
                      }}
                    >
                      <Copy className="h-3 w-3 mr-1" /> Copy ID
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button onClick={handleSaveSettings} disabled={saving || !label.trim()}>
                    {saving ? 'Saving changes…' : 'Save Station Settings'}
                  </Button>
                </div>
              </TabsContent>

              {/* TAB 2: Station Operators */}
              <TabsContent value="operators" className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Assigned Station Operators</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Staff members authorized to operate this{' '}
                      <span className="font-medium">{SURFACE_LABEL[stationSurface]}</span> station.
                    </p>
                  </div>
                  <Button size="sm" onClick={() => onOpenAssignOperator(stationSurface)}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Assign Operator
                  </Button>
                </div>

                {stationOperators.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center">
                    <UserCog className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
                    <p className="text-sm font-medium">No operators assigned to this station yet</p>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">
                      Assign a doctor or dental technician with PIN access to unlock this station.
                    </p>
                    <Button size="sm" onClick={() => onOpenAssignOperator(stationSurface)}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Assign Operator
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y rounded-xl border bg-card shadow-sm overflow-hidden">
                    {stationOperators.map((o) => {
                      const opStaff = staff.find((s) => s.id === o.staffId)
                      const isDoctor = opStaff?.isDoctor ?? false
                      const name = opStaff?.fullName ?? o.staffId
                      const caps = surfaceCaps(o, stationSurface)
                      return (
                        <div key={o.id} className="flex items-center justify-between gap-3 p-3.5">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm text-foreground">{name}</p>
                              <Badge
                                variant="secondary"
                                className={`text-[10px] ${
                                  isDoctor
                                    ? 'bg-primary/10 text-primary border-primary/25 dark:bg-primary/25 dark:text-primary-foreground'
                                    : 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
                                }`}
                              >
                                {isDoctor ? 'Dr. / Doctor' : 'Dental Technician'}
                              </Badge>
                              {o.lockedUntil && new Date(o.lockedUntil) > new Date() && (
                                <Badge variant="destructive" className="text-[10px]">
                                  locked
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {caps.map((cap) => (
                                <Badge
                                  key={cap}
                                  variant="outline"
                                  className="text-[10px] font-mono"
                                >
                                  {cap}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() =>
                                onResetPin({
                                  staffId: o.staffId,
                                  name,
                                  isDoctor,
                                })
                              }
                            >
                              <KeyRound className="mr-1 h-3 w-3" /> Reset PIN
                            </Button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() =>
                                    onEditOperatorCaps(o.staffId, stationSurface, caps)
                                  }
                                >
                                  <Edit3 className="mr-2 h-4 w-4" /> Edit Capabilities
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    onResetPin({
                                      staffId: o.staffId,
                                      name,
                                      isDoctor,
                                    })
                                  }
                                >
                                  <KeyRound className="mr-2 h-4 w-4" /> Reset PIN
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-amber-600 focus:text-amber-600"
                                  onClick={async () => {
                                    await deactivateKioskOperator(o.staffId)
                                    toast.success(`Disabled ${name}`)
                                    onRefresh()
                                  }}
                                >
                                  <UserX className="mr-2 h-4 w-4" /> Disable Operator
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>

              {/* TAB 3: Operations & Activity Log */}
              <TabsContent value="operations" className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Station Activity Timeline</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Real-time audit log of unlocks, captures, and actions on this device.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchOperations()}
                    disabled={loadingOps}
                  >
                    <RefreshCw
                      className={`mr-1.5 h-3.5 w-3.5 ${loadingOps ? 'animate-spin' : ''}`}
                    />
                    Refresh
                  </Button>
                </div>

                {loadingOps ? (
                  <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
                    Loading station activity…
                  </div>
                ) : operations.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center">
                    <Activity className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
                    <p className="text-sm font-medium">No operations recorded yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Activity will appear here once doctors or operators unlock the device.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {operations.map((op) => {
                      const isXray = op.module === 'xrays' || op.action === 'xray'
                      const isConsent = op.module === 'consents' || op.action === 'consent'
                      const isSession =
                        op.entityName?.toLowerCase().includes('session') ||
                        op.entityName?.toLowerCase().includes('opened')
                      const isPairing =
                        op.entityName?.toLowerCase().includes('pair') ||
                        op.entityName?.toLowerCase().includes('re-issued')

                      const Icon = isXray
                        ? Camera
                        : isConsent
                          ? FileText
                          : isSession
                            ? KeyRound
                            : isPairing
                              ? ShieldCheck
                              : Activity

                      const iconColor = isXray
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
                        : isConsent
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : isSession
                            ? 'bg-[#B8873A]/15 text-[#7C5B27] dark:bg-[#B8873A]/25 dark:text-[#E4C076]'
                            : 'bg-primary/10 text-primary'

                      return (
                        <div
                          key={op.id}
                          className="flex items-start gap-3 rounded-xl border bg-card p-3.5 shadow-sm text-xs"
                        >
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconColor} mt-0.5`}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold text-sm text-foreground truncate">
                                {op.entityName || `${op.action} on ${op.module}`}
                              </p>
                              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                                {new Date(op.createdAt).toLocaleString()}
                              </span>
                            </div>

                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-muted-foreground">
                              {op.operatorName && (
                                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                                  <UserCheck className="h-3 w-3 text-primary" />
                                  {op.operatorName}
                                </span>
                              )}
                              {op.patientName && (
                                <Badge variant="secondary" className="text-[10px]">
                                  Patient: {op.patientName}
                                </Badge>
                              )}
                              {op.ipAddress && (
                                <span className="font-mono text-[10px]">IP: {op.ipAddress}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>

      {/* Close Caution Dialog when pairing code is active */}
      <AlertDialog open={showCloseCautionDialog} onOpenChange={setShowCloseCautionDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <AlertDialogTitle>Active Pairing Code in Progress</AlertDialogTitle>
                <AlertDialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Station: <span className="font-semibold text-foreground">{device.label}</span>
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <div className="py-2 text-sm text-muted-foreground space-y-2">
            <p>
              An active pairing code (
              <code className="font-mono font-bold text-foreground">{sheetRevealCode?.code}</code>)
              is waiting to be entered on this device.
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
              If you close this sheet now, the active pairing session will be closed and this code
              will no longer be active.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowCloseCautionDialog(false)}>
              Keep Open
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                setSheetRevealCode(null)
                setShowCloseCautionDialog(false)
                onOpenChange(false)
              }}
            >
              Close & Discard Code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ── Add Device Dialog ───────────────────────────────────────────────────────

function AddDeviceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (label: string, code: string, expiresAt: string | null, deviceId: string) => void
}) {
  const [label, setLabel] = useState('')
  const [location, setLocation] = useState('')
  const [surface, setSurface] = useState<Surface>(SURFACES[0])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setLabel('')
      setLocation('')
      setSurface(SURFACES[0])
    }
  }, [open])

  async function save() {
    if (!label.trim()) return
    setBusy(true)
    const res = await createKioskDevice({
      label: label.trim(),
      location: location.trim() || null,
      surface,
    })
    setBusy(false)
    if (res.success && res.data) {
      onOpenChange(false)
      onCreated(label.trim(), res.data.pairingCode, res.data.pairingExpiresAt, res.data.id)
    } else toast.error(res.error || 'Failed to create device')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pair a kiosk device</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Doctor Station 1, X-ray Room PC"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Location (optional)</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Ground floor"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Surface Application</Label>
            <select
              value={surface}
              onChange={(e) => setSurface(e.target.value as Surface)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {SURFACES.map((s) => (
                <option key={s} value={s}>
                  {SURFACE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !label.trim()}>
            {busy ? 'Creating…' : 'Generate pairing code'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Set / Assign Operator Dialog ────────────────────────────────────────────

function SetOperatorDialog({
  open,
  onOpenChange,
  staff,
  initialStaffId,
  initialSurface,
  initialCaps,
  isEditing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  staff: StaffLite[]
  initialStaffId?: string
  initialSurface?: Surface
  initialCaps?: string[]
  isEditing?: boolean
  onSaved: () => void
}) {
  const [staffId, setStaffId] = useState(initialStaffId || '')
  const [pin, setPin] = useState('')
  const [surface, setSurface] = useState<Surface>(initialSurface || SURFACES[0])
  const [caps, setCaps] = useState<string[]>(initialCaps || CAPS_BY_SURFACE[SURFACES[0]])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setStaffId(initialStaffId || '')
      setPin('')
      const targetSurface = initialSurface || SURFACES[0]
      setSurface(targetSurface)
      setCaps(initialCaps || CAPS_BY_SURFACE[targetSurface])
    }
  }, [open, initialStaffId, initialSurface, initialCaps])

  // Live validation
  const errors: string[] = []
  if (!staffId) errors.push('Select a staff member')
  if (!isEditing && pin.length !== 6) errors.push('PIN must be exactly 6 digits')
  if (isEditing && pin.length > 0 && pin.length !== 6) errors.push('PIN must be exactly 6 digits')
  if (caps.length === 0) errors.push('Select at least one capability')

  async function save() {
    if (errors.length > 0) {
      toast.error(errors[0])
      return
    }
    setBusy(true)
    const payload: { pin?: string; capabilities: Record<string, string[]> } = {
      capabilities: { [surface]: caps },
    }
    if (pin.trim()) payload.pin = pin.trim()
    const res = await setKioskOperator(
      staffId,
      payload as { pin: string; capabilities: Record<string, string[]> }
    )
    setBusy(false)
    if (res.success) {
      toast.success(isEditing ? 'Operator capabilities updated' : 'Operator PIN assigned')
      onSaved()
    } else toast.error(res.error || 'Failed to save operator')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Operator Capabilities' : 'Assign Operator to Kiosk'}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Staff Member</Label>
            <select
              value={staffId}
              disabled={isEditing}
              onChange={(e) => setStaffId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
            >
              <option value="">Select staff…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} ({s.isDoctor ? 'Doctor' : 'Dental Technician'})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>
              6-digit PIN{' '}
              {isEditing && (
                <span className="text-muted-foreground font-normal">
                  (leave blank to keep existing)
                </span>
              )}
            </Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder={isEditing ? '•••••• (unchanged)' : '••••••'}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Surface Application Scope</Label>
            <select
              value={surface}
              onChange={(e) => {
                const next = e.target.value as Surface
                setSurface(next)
                setCaps(CAPS_BY_SURFACE[next])
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {SURFACES.map((s) => (
                <option key={s} value={s}>
                  {SURFACE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Capabilities</Label>
            <div className="flex flex-wrap gap-2">
              {(CAPS_BY_SURFACE[surface] ?? []).map((cap) => {
                const on = caps.includes(cap)
                return (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => setCaps((c) => (on ? c.filter((x) => x !== cap) : [...c, cap]))}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input hover:bg-muted'
                    }`}
                  >
                    {cap}
                  </button>
                )
              })}
            </div>
          </div>

          {errors.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              To save: {errors.join(' · ')}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || errors.length > 0}>
            {busy ? 'Saving…' : isEditing ? 'Save Changes' : 'Assign Operator'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Reset Operator PIN Dialog ───────────────────────────────────────────────

function ResetPinDialog({
  open,
  onOpenChange,
  target,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  target: { staffId: string; name: string; isDoctor: boolean } | null
  onSaved: () => void
}) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setPin('')
    }
  }, [open])

  if (!target) return null

  const valid = pin.length === 6

  async function handleReset() {
    if (!valid || !target) return
    setBusy(true)
    const res = await updateKioskOperator(target.staffId, { pin })
    setBusy(false)
    if (res.success) {
      toast.success(`PIN updated successfully for ${target.name}`)
      onSaved()
    } else {
      toast.error(res.error || 'Failed to reset PIN')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" /> Reset Operator PIN
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg border bg-muted/40 p-3 text-xs">
            <span className="text-muted-foreground">Operator:</span>
            <p className="font-semibold text-sm text-foreground mt-0.5">{target.name}</p>
            <Badge
              variant="secondary"
              className={`mt-1 text-[10px] ${
                target.isDoctor
                  ? 'bg-primary/10 text-primary border-primary/25 dark:bg-primary/25 dark:text-primary-foreground'
                  : 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
              }`}
            >
              {target.isDoctor ? 'Dr. / Doctor' : 'Dental Technician'}
            </Badge>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reset-pin-input">New 6-digit PIN</Label>
            <Input
              id="reset-pin-input"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              className="text-center font-mono text-lg tracking-widest"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Must be exactly 6 digits. Changing the PIN immediately resets any active lockouts.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleReset} disabled={busy || !valid}>
            {busy ? 'Saving…' : 'Save New PIN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
