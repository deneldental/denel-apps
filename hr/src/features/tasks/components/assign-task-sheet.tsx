import {
  Button,
  Checkbox,
  Input,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
} from '@denel/ui'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getStaff } from '@/lib/actions/staff'
import { createTask, type TaskPriority, type TaskRepeat } from '@/lib/actions/tasks'
import { useAuth } from '@/lib/auth'

interface StaffOption {
  id: string
  fullName: string
}

export function AssignTaskSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}) {
  const { user } = useAuth()
  const [staff, setStaffList] = useState<StaffOption[]>([])
  const [search, setSearch] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [dueDate, setDueDate] = useState('')
  const [repeat, setRepeat] = useState<TaskRepeat>('none')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignToMe, setAssignToMe] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    ;(async () => {
      const res = await getStaff()
      if (res.success && Array.isArray(res.data)) {
        setStaffList(
          (res.data as Array<{ id: string; fullName: string; status?: string }>)
            .filter((s) => s.status !== 'inactive')
            .map((s) => ({ id: s.id, fullName: s.fullName }))
        )
      }
    })()
  }, [open])

  // Reset the form whenever the sheet opens.
  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setPriority('normal')
      setDueDate('')
      setRepeat('none')
      setSelected(new Set())
      setAssignToMe(false)
      setSearch('')
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return staff
    return staff.filter((s) => s.fullName.toLowerCase().includes(q))
  }, [staff, search])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalAssignees = selected.size + (assignToMe ? 1 : 0)

  async function handleSubmit() {
    if (!title.trim()) {
      toast.error('A task title is required')
      return
    }
    if (totalAssignees === 0) {
      toast.error('Select at least one assignee')
      return
    }
    setSaving(true)
    const res = await createTask({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      dueAt: dueDate ? new Date(dueDate).toISOString() : null,
      repeat,
      assignees: {
        staffIds: [...selected],
        userIds: assignToMe && user?.id ? [user.id] : [],
      },
    })
    setSaving(false)
    if (res.success) {
      toast.success(
        `Task assigned to ${totalAssignees} ${totalAssignees === 1 ? 'person' : 'people'}`
      )
      onOpenChange(false)
      onCreated?.()
    } else {
      toast.error(res.error || res.message || 'Failed to assign task')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Assign a task</SheetTitle>
          <SheetDescription>
            Assignees get an SMS and an in-app alert, and can mark it done.
          </SheetDescription>
        </SheetHeader>

        <div className="-mr-2 flex-1 space-y-4 overflow-y-auto py-4 pr-2">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Submit monthly report"
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Details (optional)</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Repeat</Label>
              <Select value={repeat} onValueChange={(v) => setRepeat(v as TaskRepeat)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label htmlFor="assign-me" className="cursor-pointer">
              Assign to me
            </Label>
            <Switch id="assign-me" checked={assignToMe} onCheckedChange={setAssignToMe} />
          </div>

          <div className="space-y-1.5">
            <Label>Staff ({selected.size} selected)</Label>
            <Input
              placeholder="Search staff…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ScrollArea className="h-44 rounded-md border">
              <div className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">No staff found.</p>
                ) : (
                  filtered.map((s) => (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50"
                    >
                      <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                      {s.fullName}
                    </label>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <SheetFooter className="mt-auto border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || totalAssignees === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Assign{totalAssignees > 0 ? ` (${totalAssignees})` : ''}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
