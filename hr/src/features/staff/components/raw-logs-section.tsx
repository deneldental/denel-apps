import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { Database } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { StaffOption } from '@/features/staff/components/attendance-config-sections'
import {
  getRawAttendanceEvents,
  getStaff,
  type RawAttendanceEvent,
  updateStaff,
} from '@/lib/actions/staff'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'

/**
 * Raw device logs + the device-ID → staff mapping tool. Moved out of the global
 * Attendance page into HR Settings (Phase 5) — it's an administrative/debug
 * surface, not part of the day-to-day attendance workflow.
 */
export function RawLogsSection() {
  const [rawEvents, setRawEvents] = useState<RawAttendanceEvent[]>([])
  const [rawLoading, setRawLoading] = useState(false)
  const [rawFilter, setRawFilter] = useState<'all' | 'mapped' | 'unmapped'>('all')
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])

  const [mapModalOpen, setMapModalOpen] = useState(false)
  const [mapDeviceUserId, setMapDeviceUserId] = useState('')
  const [mapDeviceUserName, setMapDeviceUserName] = useState('')
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [mappingLoading, setMappingLoading] = useState(false)

  const loadRawEvents = useCallback(async () => {
    setRawLoading(true)
    const res = await getRawAttendanceEvents()
    if (res.success) setRawEvents(res.data)
    else {
      toast.error(res.error || 'Failed to load raw events')
      setRawEvents([])
    }
    setRawLoading(false)
  }, [])

  useEffect(() => {
    void loadRawEvents()
    void getStaff().then((res) => {
      if (res.success) {
        const opts: StaffOption[] = (res.data as Array<{ id: string; fullName: string }>).map(
          (s) => ({ id: s.id, fullName: s.fullName })
        )
        opts.sort((a, b) => a.fullName.localeCompare(b.fullName))
        setStaffOptions(opts)
      }
    })
  }, [loadRawEvents])

  const handleOpenMapModal = useCallback((deviceUserId: string, deviceUserName: string) => {
    setMapDeviceUserId(deviceUserId)
    setMapDeviceUserName(deviceUserName)
    setSelectedStaffId('')
    setMapModalOpen(true)
  }, [])

  async function handleSaveMapping() {
    if (!selectedStaffId) {
      toast.error('Please select a staff member')
      return
    }
    setMappingLoading(true)
    const res = await updateStaff(selectedStaffId, { deviceUserId: mapDeviceUserId })
    if (res.success) {
      toast.success(`Successfully mapped Device ID ${mapDeviceUserId} to staff member`)
      setMapModalOpen(false)
      void loadRawEvents()
    } else {
      toast.error(res.error || 'Failed to map device ID')
    }
    setMappingLoading(false)
  }

  const filteredRawEvents = useMemo(() => {
    if (rawFilter === 'unmapped') return rawEvents.filter((e) => !e.staffId)
    if (rawFilter === 'mapped') return rawEvents.filter((e) => !!e.staffId)
    return rawEvents
  }, [rawEvents, rawFilter])

  const rawColumns = useMemo<ColumnDef<RawAttendanceEvent>[]>(
    () => [
      {
        accessorKey: 'effectiveTimestamp',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Clock Time" />,
        cell: ({ row }) => {
          const effective = row.original.effectiveTimestamp
          // Surface the raw device time when it drifted from the used (ingested)
          // time, so the correction is visible in the raw log.
          const drifted =
            new Date(effective).getTime() !== new Date(row.original.eventTimestamp).getTime()
          return (
            <div className="flex flex-col">
              <span className="font-medium tabular-nums">
                {new Date(effective).toLocaleString()}
              </span>
              {drifted && (
                <span className="text-xs tabular-nums text-muted-foreground line-through">
                  device: {new Date(row.original.eventTimestamp).toLocaleString()}
                </span>
              )}
            </div>
          )
        },
      },
      {
        id: 'employee',
        accessorFn: (e) => e.staffName ?? e.deviceUserName ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Employee" />,
        cell: ({ row }) => {
          const e = row.original
          if (e.staffId) return <span className="font-medium">{e.staffName}</span>
          return (
            <div className="flex items-center gap-2">
              <StatusBadge tone="warning" className="normal-case">
                Unmapped{e.deviceUserName ? ` (${e.deviceUserName})` : ''}
              </StatusBadge>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-primary"
                onClick={() => handleOpenMapModal(e.deviceUserId, e.deviceUserName || 'No Name')}
              >
                Map to Staff
              </Button>
            </div>
          )
        },
      },
      {
        accessorKey: 'deviceUserId',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Device ID" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums">{row.original.deviceUserId}</span>
        ),
      },
      {
        id: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        // Clock In / Clock Out is derived from the AM/PM of the effective time
        // (UTC, matching the backend scorer), not the device's raw status flag.
        cell: ({ row }) => {
          const isAm = new Date(row.original.effectiveTimestamp).getUTCHours() < 12
          return isAm ? <TagBadge>Clock In</TagBadge> : <TagBadge>Clock Out</TagBadge>
        },
      },
      {
        accessorKey: 'sourceFile',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
        cell: ({ row }) => (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {row.original.sourceFile || 'unknown'}
          </code>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ingested" />,
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleString()}
          </span>
        ),
      },
    ],
    [handleOpenMapModal]
  )

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-end justify-between gap-4 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5 text-primary" />
              Raw Device Logs
            </CardTitle>
            <CardDescription>
              The most recent raw swipe events ingested from Anviz Webhook, Cloud API, or CSV
              uploads.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadRawEvents} disabled={rawLoading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Show</Label>
            <Select
              value={rawFilter}
              onValueChange={(v) => setRawFilter(v as 'all' | 'mapped' | 'unmapped')}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                <SelectItem value="mapped">Mapped only</SelectItem>
                <SelectItem value="unmapped">Unmapped only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {rawLoading ? (
            <div className="py-12 text-center text-muted-foreground">Loading raw logs…</div>
          ) : rawEvents.length > 0 ? (
            <DataTable columns={rawColumns} data={filteredRawEvents} />
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              No raw device events found. Try triggering a device check-in or test the Webhook
              connection.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={mapModalOpen} onOpenChange={setMapModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Map Biometric ID to Staff</DialogTitle>
            <DialogDescription>
              Assign the Device User ID <strong>{mapDeviceUserId}</strong> ({mapDeviceUserName}) to
              an existing staff member. This will also link all past and future swipe events with
              this ID to the selected employee.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="staff-select">Select Staff Member</Label>
              <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                <SelectTrigger id="staff-select">
                  <SelectValue placeholder="Choose staff member..." />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((staffOpt) => (
                    <SelectItem key={staffOpt.id} value={staffOpt.id}>
                      {staffOpt.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={mappingLoading}
              onClick={() => setMapModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={mappingLoading} onClick={handleSaveMapping}>
              {mappingLoading ? 'Saving...' : 'Save Mapping'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
