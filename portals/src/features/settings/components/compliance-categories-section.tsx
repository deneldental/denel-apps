import * as Icons from 'lucide-react'
import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  type ComplianceCategory,
  createComplianceCategory,
  deleteComplianceCategory,
  updateComplianceCategory,
} from '@/lib/actions/compliance-categories'
import { useApiMutation } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'
import {
  COMPLIANCE_CATEGORIES_KEY,
  useComplianceCategories,
} from '@/shared/hooks/use-compliance-categories'

type CategoryColor = 'slate' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'pink' | 'cyan'

const CATEGORY_COLORS: Array<{
  value: CategoryColor
  label: string
  badge: string
  swatch: string
  icon: string
}> = [
  {
    value: 'slate',
    label: 'Slate',
    badge: 'bg-slate-100 text-foreground',
    swatch: 'bg-slate-400',
    icon: 'text-foreground',
  },
  {
    value: 'blue',
    label: 'Blue',
    badge: 'bg-blue-100 text-blue-700',
    swatch: 'bg-blue-500',
    icon: 'text-blue-600',
  },
  {
    value: 'green',
    label: 'Green',
    badge: 'bg-green-100 text-green-700',
    swatch: 'bg-green-500',
    icon: 'text-green-600',
  },
  {
    value: 'yellow',
    label: 'Yellow',
    badge: 'bg-yellow-100 text-yellow-700',
    swatch: 'bg-yellow-500',
    icon: 'text-yellow-600',
  },
  {
    value: 'red',
    label: 'Red',
    badge: 'bg-red-100 text-red-700',
    swatch: 'bg-red-500',
    icon: 'text-red-600',
  },
  {
    value: 'purple',
    label: 'Purple',
    badge: 'bg-purple-100 text-purple-700',
    swatch: 'bg-purple-500',
    icon: 'text-purple-600',
  },
  {
    value: 'pink',
    label: 'Pink',
    badge: 'bg-pink-100 text-pink-700',
    swatch: 'bg-pink-500',
    icon: 'text-pink-600',
  },
  {
    value: 'cyan',
    label: 'Cyan',
    badge: 'bg-cyan-100 text-cyan-700',
    swatch: 'bg-cyan-500',
    icon: 'text-cyan-600',
  },
]

type LucideIcon = React.ComponentType<{ className?: string }>

function resolveIcon(name: string | null): LucideIcon {
  if (!name) return FolderTree
  const lib = Icons as unknown as Record<string, LucideIcon | undefined>
  return lib[name] ?? FolderTree
}

const colorMeta = (color: string) =>
  CATEGORY_COLORS.find((c) => c.value === color) ?? CATEGORY_COLORS[0]

interface CategoryForm {
  name: string
  description: string
  color: CategoryColor
  iconName: string
}

const EMPTY_FORM: CategoryForm = {
  name: '',
  description: '',
  color: 'slate',
  iconName: 'FolderTree',
}

export function ComplianceCategoriesSection() {
  const { categories, isLoading: loading } = useComplianceCategories()
  const invalidates = [COMPLIANCE_CATEGORIES_KEY]
  const createMutation = useApiMutation(createComplianceCategory, { invalidates })
  const updateMutation = useApiMutation(
    (vars: { id: string; data: Parameters<typeof updateComplianceCategory>[1] }) =>
      updateComplianceCategory(vars.id, vars.data),
    { invalidates }
  )
  const deleteMutation = useApiMutation((id: string) => deleteComplianceCategory(id), {
    invalidates,
  })
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<ComplianceCategory | null>(null)
  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<ComplianceCategory | null>(null)

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowDialog(true)
  }

  function openEdit(c: ComplianceCategory) {
    setEditing(c)
    setForm({
      name: c.name,
      description: c.description ?? '',
      color: (c.color as CategoryColor) ?? 'slate',
      iconName: c.iconName ?? 'FolderTree',
    })
    setShowDialog(true)
  }

  async function handleSave() {
    const name = form.name.trim()
    const description = form.description.trim() || null
    const iconName = form.iconName.trim() || 'FolderTree'

    if (!name) {
      toast.error('Category name is required')
      return
    }

    try {
      if (editing) {
        await updateMutation.mutateAsync({
          id: editing.id,
          data: { name, description, color: form.color, iconName },
        })
        toast.success('Category updated')
      } else {
        await createMutation.mutateAsync({ name, description, color: form.color, iconName })
        toast.success('Category created')
      }
      setShowDialog(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save category')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success('Category deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete category')
    }
    setDeleteTarget(null)
  }

  async function toggleActive(c: ComplianceCategory) {
    try {
      await updateMutation.mutateAsync({ id: c.id, data: { isActive: !c.isActive } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update category')
    }
  }

  const FormIcon = resolveIcon(form.iconName)
  const formColor = colorMeta(form.color)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <CardTitle>Compliance Categories</CardTitle>
            <CardDescription>
              Categories used to group compliance documents (regulatory, HIPAA, training, equipment,
              etc.).
            </CardDescription>
          </div>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Category
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : categories.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No compliance categories yet. Add one to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => {
                const Icon = resolveIcon(c.iconName)
                const meta = colorMeta(c.color)
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.badge}`}
                        >
                          <Icon className={`h-4 w-4 ${meta.icon}`} />
                        </span>
                        <div>
                          <div className="font-medium">{c.name}</div>
                          {c.description && (
                            <div className="text-xs text-muted-foreground">{c.description}</div>
                          )}
                          {c.iconName && (
                            <code className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {c.iconName}
                            </code>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.badge}`}
                      >
                        <span className={`h-2 w-2 rounded-full ${meta.swatch}`} />
                        {meta.label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <button type="button" onClick={() => toggleActive(c)}>
                        <Badge variant={c.isActive ? 'default' : 'secondary'}>
                          {c.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(c)}
                          title="Delete category"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Category' : 'Add Category'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cc-name">Name</Label>
              <Input
                id="cc-name"
                placeholder="e.g. Regulatory Compliance"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-desc">Description (optional)</Label>
              <Textarea
                id="cc-desc"
                placeholder="What kinds of documents live in this category?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c.value }))}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${c.badge} ${
                      form.color === c.value
                        ? 'ring-2 ring-offset-1 ring-foreground/40'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${c.swatch}`} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-icon">Icon (lucide-react name)</Label>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${formColor.badge}`}
                >
                  <FormIcon className={`h-5 w-5 ${formColor.icon}`} />
                </span>
                <Input
                  id="cc-icon"
                  placeholder="e.g. ShieldCheck, Lock, Stethoscope"
                  value={form.iconName}
                  onChange={(e) => setForm((f) => ({ ...f, iconName: e.target.value }))}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Any{' '}
                <a
                  href="https://lucide.dev/icons/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  lucide-react
                </a>{' '}
                icon name (PascalCase). Falls back to FolderTree if unknown.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Compliance Category"
        description="This will remove the category from the picker. Existing documents tagged with it will keep the historical label."
        itemName={deleteTarget?.name}
      />
    </Card>
  )
}
