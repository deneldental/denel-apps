import { useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { tagClass, tagVariantClass } from '@/features/patients/components/tag-pills'
import { assignPatientTag, getPatientTags, unassignPatientTag } from '@/lib/actions/patient-tags'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { usePatientTagCatalog } from '@/shared/hooks/use-patient-tag-catalog'

export function PatientTags({
  patientId,
  canEdit = false,
}: {
  patientId: string
  canEdit?: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const tagsKey = queryKeys.patients.tags(patientId)
  const tagsQuery = useApiQuery(tagsKey, () => getPatientTags(patientId))
  const tags = tagsQuery.data ?? []
  const { catalog } = usePatientTagCatalog({ activeOnly: true, enabled: canEdit })

  function invalidateTags() {
    queryClient.invalidateQueries({ queryKey: tagsKey })
  }

  async function add(tagId: string) {
    const r = await assignPatientTag(patientId, tagId)
    if (r.success) {
      setOpen(false)
      invalidateTags()
    } else toast.error('Failed to add tag')
  }
  async function remove(tagId: string) {
    const r = await unassignPatientTag(patientId, tagId)
    if (r.success) invalidateTags()
    else toast.error('Failed to remove tag')
  }

  const assigned = new Set(tags.map((t) => t.id))
  const available = catalog.filter((t) => !assigned.has(t.id))

  if (tags.length === 0 && !canEdit) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span
          key={t.id}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-xs ${tagClass(t.color)}`}
        >
          {t.name}
          {canEdit && (
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="hover:opacity-70"
              aria-label={`Remove ${t.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-muted-foreground text-xs hover:bg-muted"
            >
              <Plus className="h-3 w-3" /> Tag
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            {available.length === 0 ? (
              <p className="px-2 py-1.5 text-muted-foreground text-xs">All tags applied.</p>
            ) : (
              available.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => add(t.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${tagVariantClass(t.color, false)}`}
                  >
                    {t.name}
                  </span>
                </button>
              ))
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
