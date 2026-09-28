import { useEffect } from 'react'
import { tagVariantClass } from '@/features/patients/components/tag-pills'
import type { PatientTag } from '@/lib/actions/patient-tags'
import { cn } from '@/lib/utils'
import { usePatientTagCatalog } from '@/shared/hooks/use-patient-tag-catalog'

// admin-v1 §2.7 — multiselect tag picker (coloured chips) for the patient
// create/edit forms. Selected chips flip to dark bg + light text for clear
// contrast; unselected chips use the light base variant.
export function TagPicker({
  value,
  onChange,
  label = 'Tags',
  onCatalogLoaded,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  label?: string
  onCatalogLoaded?: (catalog: PatientTag[]) => void
}) {
  const { catalog } = usePatientTagCatalog({ activeOnly: true })

  // Bubble the loaded catalog up to the parent form (e.g. to resolve the
  // 'insurance' system tag) once it's fetched, same contract as before.
  useEffect(() => {
    if (catalog.length > 0) onCatalogLoaded?.(catalog)
  }, [catalog, onCatalogLoaded])

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((t) => t !== id) : [...value, id])
  }

  if (catalog.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {catalog.map((tag) => {
          const active = value.includes(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggle(tag.id)}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                tagVariantClass(tag.color, active)
              )}
            >
              {tag.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
