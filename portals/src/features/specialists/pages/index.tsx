import { ACTIONS, MODULES } from '@denel/rbac'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Stethoscope } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AddSpecialistSheet } from '@/features/specialists/components/add-specialist-sheet'
import { listSpecialists } from '@/lib/actions/specialists'
import { useCan } from '@/lib/permissions-context'
import { queryKeys } from '@/lib/query-keys'
import { EmptyState } from '@/shared/components/empty-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

// Doctor / specialist management lives HERE. It briefly moved to the HR app,
// which put clinical providers behind an HR login and split intake across two
// apps; it is back in the portal so there is one place doctors are created and
// one intake path. A doctor created here is a clinical provider with an
// optional portal login — NOT an HR employee, so no staff, payroll or
// attendance record is created.

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

export default function SpecialistsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  // Same gate the backend enforces on POST /api/specialists.
  const canCreate = useCan(MODULES.SPECIALISTS, ACTIONS.CREATE)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: queryKeys.specialists.list(),
    queryFn: async () => {
      const res = await listSpecialists()
      if (res.error) toast.error(res.error)
      return res.data
    },
  })

  const internalCount = rows.filter((r) => r.specialistType === 'internal').length
  const externalCount = rows.length - internalCount

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Specialists</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every clinical provider. Internal specialists work for the clinic and can hold a portal
            login; external specialists are visiting providers paid on commission.
            {rows.length > 0 && (
              <>
                {' '}
                · {internalCount} internal · {externalCount} external
              </>
            )}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add specialist
          </Button>
        )}
      </header>

      <AddSpecialistSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.specialists.list() })
        }}
      />

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Stethoscope}
              title="No specialists yet"
              description="Specialists are the clinical providers patients book with."
              action={
                canCreate ? { label: 'Add specialist', onClick: () => setAddOpen(true) } : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className={!r.isActive ? 'opacity-50' : 'cursor-pointer hover:bg-muted/30'}
                    onClick={() => r.isActive && navigate(`/specialists/${r.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          {r.profileImage ? (
                            <AvatarImage src={r.profileImage} alt={r.name} />
                          ) : (
                            <AvatarFallback>{getInitials(r.name)}</AvatarFallback>
                          )}
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.name}</p>
                          <p className="truncate text-xs italic text-muted-foreground">
                            {r.specialty || 'Specialisation not set'}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={r.specialistType === 'internal' ? 'secondary' : 'outline'}
                        className="capitalize"
                      >
                        {r.specialistType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <p className="truncate">{r.contactEmail ?? '—'}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.contactPhone ?? '—'}
                      </p>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.defaultCommissionRate > 0 ? (
                        `${r.defaultCommissionRate}%`
                      ) : (
                        <span className="italic text-muted-foreground">none</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.isActive ? 'default' : 'secondary'}>
                        {r.isActive ? 'active' : 'inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {/* Open views the full record. */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/specialists/${r.id}`)
                          }}
                        >
                          Open
                        </Button>
                      </div>
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
