// Request types — the Requests staff can file, and the Types under each. Shared
// by the staff app and HR's "File request". Lives on the Requests page
// (Request types tab); moved out of HR Settings.

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
} from '@denel/ui'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  createRequestKind,
  createRequestSubtype,
  deleteRequestKind,
  deleteRequestSubtype,
  getRequestKinds,
  getRequestSubtypes,
  type RequestKind,
  type RequestSubtype,
  updateRequestKind,
  updateRequestSubtype,
} from '@/lib/actions/staff'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'

export function RequestTypesSection() {
  const [kinds, setKinds] = useState<RequestKind[]>([])
  const [rows, setRows] = useState<RequestSubtype[]>([])
  const [loading, setLoading] = useState(true)

  // "Add request" (kind) form
  const [kindName, setKindName] = useState('')
  const [kindDates, setKindDates] = useState(false)
  const [kindAmount, setKindAmount] = useState(false)
  const [addingKind, setAddingKind] = useState(false)

  // "Add type" inputs, keyed by kind slug
  const [typeInputs, setTypeInputs] = useState<Record<string, string>>({})
  const [addingType, setAddingType] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [k, s] = await Promise.all([getRequestKinds(true), getRequestSubtypes(true)])
    if (k.success && Array.isArray(k.data)) setKinds(k.data)
    if (s.success && Array.isArray(s.data)) setRows(s.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAddKind() {
    const displayName = kindName.trim()
    if (!displayName) return
    setAddingKind(true)
    const res = await createRequestKind({
      displayName,
      showsDates: kindDates,
      showsAmount: kindAmount,
    })
    setAddingKind(false)
    if (res.success) {
      setKindName('')
      setKindDates(false)
      setKindAmount(false)
      toast.success('Request added')
      void load()
    } else {
      toast.error(res.error || 'Failed to add (it may already exist)')
    }
  }

  async function toggleKindActive(k: RequestKind) {
    const res = await updateRequestKind(k.id, { isActive: !k.isActive })
    if (res.success) {
      setKinds((prev) => prev.map((x) => (x.id === k.id ? { ...x, isActive: !x.isActive } : x)))
    } else {
      toast.error(res.error || 'Failed to update')
    }
  }

  async function handleDeleteKind(k: RequestKind) {
    const res = await deleteRequestKind(k.id)
    if (res.success) {
      setKinds((prev) => prev.filter((x) => x.id !== k.id))
      toast.success('Request deleted')
    } else {
      toast.error(res.error || 'In use — deactivate it instead of deleting')
    }
  }

  async function handleAddType(kindSlug: string) {
    const displayName = (typeInputs[kindSlug] || '').trim()
    if (!displayName) return
    setAddingType(kindSlug)
    const res = await createRequestSubtype({ category: kindSlug, displayName })
    setAddingType(null)
    if (res.success) {
      setTypeInputs((prev) => ({ ...prev, [kindSlug]: '' }))
      toast.success('Type added')
      void load()
    } else {
      toast.error(res.error || 'Failed to add (it may already exist)')
    }
  }

  async function toggleTypeActive(row: RequestSubtype) {
    const res = await updateRequestSubtype(row.id, { isActive: !row.isActive })
    if (res.success) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isActive: !r.isActive } : r)))
    } else {
      toast.error(res.error || 'Failed to update')
    }
  }

  async function handleDeleteType(row: RequestSubtype) {
    const res = await deleteRequestSubtype(row.id)
    if (res.success) {
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success('Type deleted')
    } else {
      toast.error(res.error || 'In use — deactivate it instead of deleting')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Requests &amp; types</CardTitle>
        <CardDescription>
          The Requests staff can file, and the Types under each — shared by the staff app and HR's
          "File request". Add your own Requests; the four built-ins can be reordered and have Types
          added, but not deleted. Inactive items stay on existing requests but drop out of the
          forms.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Add a Request (kind) */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
          <div className="min-w-[180px] flex-1 space-y-1.5">
            <Label htmlFor="new-request" className="text-xs">
              New request
            </Label>
            <Input
              id="new-request"
              value={kindName}
              placeholder="e.g. Training request"
              onChange={(e) => setKindName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddKind()}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-xs">
            <Switch checked={kindDates} onCheckedChange={setKindDates} />
            Collects dates
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs">
            <Switch checked={kindAmount} onCheckedChange={setKindAmount} />
            Collects an amount
          </label>
          <Button onClick={handleAddKind} disabled={addingKind || !kindName.trim()}>
            {addingKind ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add request
          </Button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-4">
            {kinds.map((k) => {
              const items = rows.filter((r) => r.category === k.name)
              return (
                <div key={k.id} className="rounded-md border">
                  {/* Request (kind) header */}
                  <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          k.isActive
                            ? 'text-sm font-semibold'
                            : 'text-sm font-semibold text-muted-foreground'
                        }
                      >
                        {k.displayName}
                      </span>
                      {k.showsDates && <TagBadge className="text-[10px]">dates</TagBadge>}
                      {k.showsAmount && <TagBadge className="text-[10px]">amount</TagBadge>}
                      {k.isSystem && <TagBadge className="text-[10px]">built-in</TagBadge>}
                      {!k.isActive && (
                        <StatusBadge tone="danger" className="text-[10px]">
                          Inactive
                        </StatusBadge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={k.isActive}
                        onCheckedChange={() => toggleKindActive(k)}
                        disabled={k.isSystem}
                        aria-label={`Toggle ${k.displayName}`}
                      />
                      {!k.isSystem && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteKind(k)}
                          aria-label={`Delete ${k.displayName}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Types under this request */}
                  <div className="space-y-2 p-3">
                    {items.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No types yet.</p>
                    ) : (
                      <ul className="divide-y rounded-md border">
                        {items.map((r) => (
                          <li key={r.id} className="flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={r.isActive ? 'text-sm' : 'text-sm text-muted-foreground'}
                              >
                                {r.displayName}
                              </span>
                              {!r.isActive && (
                                <StatusBadge tone="danger" className="text-[10px]">
                                  Inactive
                                </StatusBadge>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <Switch
                                checked={r.isActive}
                                onCheckedChange={() => toggleTypeActive(r)}
                                aria-label={`Toggle ${r.displayName}`}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteType(r)}
                                aria-label={`Delete ${r.displayName}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex items-end gap-2">
                      <Input
                        value={typeInputs[k.name] || ''}
                        placeholder="Add a type…"
                        className="h-9"
                        onChange={(e) =>
                          setTypeInputs((prev) => ({ ...prev, [k.name]: e.target.value }))
                        }
                        onKeyDown={(e) => e.key === 'Enter' && handleAddType(k.name)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAddType(k.name)}
                        disabled={addingType === k.name || !(typeInputs[k.name] || '').trim()}
                      >
                        {addingType === k.name ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="mr-2 h-4 w-4" />
                        )}
                        Add type
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
