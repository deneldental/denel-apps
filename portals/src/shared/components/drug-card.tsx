import { type DrugFrequency, getDrugFrequencies } from '@/lib/actions/drug-frequencies'
import { useApiQuery } from '@/lib/query'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip'

// ─── Types ──────────────────────────────────────────────────────────────────

export type Drug = {
  medication: string
  dosage?: string
  frequency?: string
  duration?: string
  /** Optional dispensed quantity (present on inventory-linked prescriptions). */
  quantity?: number
  notes?: string
}

// ─── Shared frequency lookup (§2.4) ───────────────────────────────────────────
// The seeded drug_frequencies lookup is small and rarely changes, so resolve it
// once per session and share across every DrugCard — the TanStack Query cache
// dedupes concurrent mounts under this key, the module-level cache this used
// to hand-roll.

const DRUG_FREQUENCIES_KEY = ['lookups', 'drug-frequencies'] as const

/** Resolve a stored frequency value to its full meaning, if it is a known abbreviation. */
function findMeaning(frequency: string, frequencies: DrugFrequency[]): string | null {
  const needle = frequency.trim().toLowerCase()
  const match = frequencies.find((f) => f.name.trim().toLowerCase() === needle)
  return match?.displayName ?? null
}

// ─── Labelled chip ────────────────────────────────────────────────────────────

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white/60 px-2 py-0.5 text-xs dark:border-rose-900/40 dark:bg-rose-950/20">
      <span className="font-medium text-rose-700/80 dark:text-rose-300/80">{label}</span>
      <span className="text-foreground">{children}</span>
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Shared prescription drug card (admin-v1 §5.2). Rose-bordered (prescription =
 * rose per §2.1/§2.4); shows the drug name prominently with dosage / frequency /
 * duration as labelled chips. Frequency renders the seeded abbreviation (OD/BD/…)
 * with its full meaning on hover (§2.6). Used by both the Module 2 Prescriptions tab
 * and the Clinical Prescription sheet so the UX is defined once.
 */
export function DrugCard({ drug, className }: { drug: Drug; className?: string }) {
  const frequenciesQuery = useApiQuery(DRUG_FREQUENCIES_KEY, () => getDrugFrequencies(), {
    staleTime: Infinity, // seeded lookup, rarely changes — once per session
  })
  const frequencies = frequenciesQuery.data ?? []

  const meaning = drug.frequency ? findMeaning(drug.frequency, frequencies) : null

  return (
    <div
      className={cn(
        'rounded-md border border-rose-200 bg-rose-50/40 px-3 py-2.5 space-y-1.5',
        'dark:border-rose-900/40 dark:bg-rose-950/10',
        className
      )}
    >
      <p className="text-sm font-semibold">{drug.medication}</p>
      <div className="flex flex-wrap gap-1.5">
        {drug.dosage && <Chip label="Dosage">{drug.dosage}</Chip>}
        {drug.frequency &&
          (meaning ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white/60 px-2 py-0.5 text-xs dark:border-rose-900/40 dark:bg-rose-950/20">
                    <span className="font-medium text-rose-700/80 dark:text-rose-300/80">
                      Frequency
                    </span>
                    <span className="cursor-help text-foreground underline decoration-dotted underline-offset-2">
                      {drug.frequency}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{meaning}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Chip label="Frequency">{drug.frequency}</Chip>
          ))}
        {drug.duration && (
          <Chip label="Duration">
            {drug.duration} {Number.isFinite(Number(drug.duration)) ? 'days' : ''}
          </Chip>
        )}
        {typeof drug.quantity === 'number' && drug.quantity > 0 && (
          <Chip label="Qty">{drug.quantity}</Chip>
        )}
      </div>
      {drug.notes && (
        <div className="mt-2 text-xs italic text-muted-foreground bg-background/40 p-1.5 rounded border border-border/50">
          <span className="font-semibold not-italic">Notes: </span>
          {drug.notes}
        </div>
      )}
    </div>
  )
}
