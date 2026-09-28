// Single-select patient picker — one canonical surface for "pick a patient"
// across the app. The UX mirrors the New Appointment sheet (Popover +
// Command search by name / patient ID, with the patient code rendered
// mono on the right) so every form that needs a patient feels the same.
//
// Two ways to feed it data:
//   • Pass `patients` from a caller that already loaded/filtered a list
//     (e.g. a subset from another source) — the picker filters that array
//     client-side, unchanged from before.
//   • Pass nothing and the picker searches `/api/patients?q=...` server-side
//     as the user types (debounced), the same endpoint/search the Patient
//     Records page uses. This is deliberately NOT "fetch every patient and
//     filter in the browser" — at ~3,900+ patients that meant a hardcoded
//     row cap silently hid an arbitrary, unstable subset of patients from
//     every picker in the app. Most callers should take this path.

import { Check, ChevronsUpDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getPatient, getPatientsPage } from '@/lib/actions/patients'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'

// Loose shape — the fields the picker itself renders, plus a couple of
// commonly-needed extras (insurance) so callers that read them off the
// selected patient don't need a separate fetch. When self-fetching, the
// server actually returns the full patient row, so these resolve for free;
// callers passing a trimmed `patients` projection just won't have them.
export interface PickerPatient {
  id: string
  name: string
  patientId?: string | null
  isChild?: boolean
  guardianName?: string | null
  phone?: string | null
  guardianPhone?: string | null
  insuranceProvider?: string | null
  insurancePolicyNumber?: string | null
  createdAt?: string | Date | null
}

interface PatientPickerProps {
  /** Currently-selected patient id (`''` when nothing is picked yet). */
  value: string
  /** Receives the new patient id plus the matching row so callers that need
   *  the whole record (for template substitution, phone hint, etc.) don't
   *  have to maintain their own lookup. */
  onChange: (patientId: string, patient: PickerPatient | null) => void
  /** Supply a pre-loaded/pre-filtered list to filter client-side instead of
   *  searching the server. Only use this when the parent has a genuine
   *  reason to hold the list itself; most callers should omit this. */
  patients?: PickerPatient[]
  /** Disable trigger + popover. */
  disabled?: boolean
  /** Trigger label when nothing is picked. */
  placeholder?: string
  /** Extra classes on the trigger. */
  className?: string
  /** Width of the dropdown popover. Defaults to 460px to match the appointment
   *  sheet — pass a smaller value when embedded inside a narrower sheet. */
  popoverWidthClass?: string
  /** Optional id for label association. */
  id?: string
}

export function PatientPicker({
  value,
  onChange,
  patients: patientsProp,
  disabled,
  placeholder = 'Search patient…',
  className,
  popoverWidthClass = 'w-[460px]',
  id,
}: PatientPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce so every keystroke doesn't fire a request.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Reset the search box each time the popover opens/closes so it doesn't
  // carry a stale query into the next open.
  useEffect(() => {
    if (!open) {
      setSearch('')
      setDebouncedSearch('')
    }
  }, [open])

  const serverMode = !patientsProp
  const searchQuery = useApiQuery<PickerPatient[]>(
    queryKeys.patients.list({ q: debouncedSearch || undefined, picker: true }),
    () => getPatientsPage<PickerPatient>({ q: debouncedSearch, limit: 50 }),
    { enabled: serverMode && open, staleTime: 30_000 }
  )

  // The selected patient may not be in the current (possibly search-
  // narrowed) result set, so its display info is tracked independently —
  // otherwise the trigger button would blank out as soon as the user typed
  // a new search after picking someone.
  const [selectedPatient, setSelectedPatient] = useState<PickerPatient | null>(null)
  useEffect(() => {
    if (!value) {
      setSelectedPatient(null)
      return
    }
    if (selectedPatient?.id === value) return
    // Already have it from the current list (covers the client-list mode
    // and the common case of just having picked someone).
    const fromList = (patientsProp ?? searchQuery.data ?? []).find((p) => p.id === value)
    if (fromList) {
      setSelectedPatient(fromList)
      return
    }
    // Externally-set/prefilled value (e.g. editing a record that already
    // has a patient) with no matching row loaded yet — resolve it directly.
    let cancelled = false
    getPatient(value).then((res) => {
      if (!cancelled && res.success && res.data) setSelectedPatient(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [value, patientsProp, searchQuery.data, selectedPatient?.id])

  const patients = patientsProp ?? searchQuery.data ?? []
  const loading = serverMode && searchQuery.isLoading

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', className)}
        >
          {selectedPatient ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="truncate">{selectedPatient.name}</span>
              {selectedPatient.patientId && (
                <span className="text-xs text-muted-foreground font-mono shrink-0">
                  {selectedPatient.patientId}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-0', popoverWidthClass)} align="start">
        <Command shouldFilter={!serverMode}>
          <CommandInput
            placeholder="Search by name, phone, or Patient ID…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{loading ? 'Loading patients…' : 'No patient found.'}</CommandEmpty>
            <CommandGroup>
              {patients.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.name} ${p.patientId || ''}`}
                  onSelect={() => {
                    setSelectedPatient(p)
                    onChange(p.id, p)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', value === p.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.isChild && p.guardianName && (
                    <span className="text-xs text-muted-foreground mr-2">
                      (Guardian: {p.guardianName})
                    </span>
                  )}
                  {p.patientId && (
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      {p.patientId}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
