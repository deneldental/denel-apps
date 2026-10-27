import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AddPatientSheet } from '@/features/patients/components/add-patient-sheet'
import { type PatientRow, PatientTable } from '@/features/patients/components/patient-table'
import { getPatientsPage, type PatientTagCount } from '@/lib/actions/patients'
import { useLoading } from '@/lib/loading-context'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { usePermissions } from '@/shared/hooks/use-permissions'

const DEFAULT_PAGE_SIZE = 25

export default function PatientsPage() {
  const queryClient = useQueryClient()
  const { hasPermission, isAdmin, isLoading: permissionsLoading } = usePermissions()
  const isClinicalUser =
    hasPermission('medical_records', 'read') && !hasPermission('appointments', 'create')
  const canCreate = hasPermission('patients', 'create')

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const { setIsLoading } = useLoading()
  const [searchParams, setSearchParams] = useSearchParams()

  // §2.7 — selected tag filter is mirrored in the URL (`?tagIds=a,b`).
  const tagIds = useMemo(() => {
    const raw = searchParams.get('tagIds')
    return raw ? raw.split(',').filter(Boolean) : []
  }, [searchParams])
  const _tagKey = tagIds.join(',')

  // C5 — Active/Archived view, mirrored in the URL (`?view=archived`).
  const view: 'active' | 'archived' =
    searchParams.get('view') === 'archived' ? 'archived' : 'active'
  function handleViewChange(next: string) {
    const params = new URLSearchParams(searchParams)
    if (next === 'archived') params.set('view', 'archived')
    else params.delete('view')
    setSearchParams(params)
  }

  // Debounce search to avoid hammering the server while the admin types.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Reset to page 0 when filters change.
  const initialMountRef = useRef(true)
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false
      return
    }
    setPageIndex(0)
  }, [debouncedSearch, _tagKey, view])

  const filters = {
    limit: pageSize,
    offset: pageIndex * pageSize,
    q: debouncedSearch || undefined,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    archived: view === 'archived',
  }

  // Wrap `getPatientsPage`'s `{ data, total, tagCounts }` shape into a single
  // `data` object — `useApiQuery` only surfaces the `ApiResponse.data` field.
  const patientsQuery = useApiQuery(
    queryKeys.patients.list(filters),
    async () => {
      const res = await getPatientsPage<PatientRow>(filters)
      return {
        success: res.success,
        data: { rows: res.data, total: res.total, tagCounts: res.tagCounts },
        error: res.error,
      }
    },
    { enabled: !permissionsLoading }
  )
  const rows = patientsQuery.data?.rows ?? []
  const total = patientsQuery.data?.total ?? 0
  const tagCounts = patientsQuery.data?.tagCounts ?? ([] as PatientTagCount[])

  // Mirror into the shared reference-counted loading context, same as every
  // other migrated page — table-local loading still reads `isFetching` below.
  useEffect(() => {
    setIsLoading(patientsQuery.isFetching)
  }, [patientsQuery.isFetching, setIsLoading])

  function handleTagIdsChange(ids: string[]) {
    const next = new URLSearchParams(searchParams)
    if (ids.length > 0) next.set('tagIds', ids.join(','))
    else next.delete('tagIds')
    setSearchParams(next)
  }

  function handlePatientCreated() {
    // Jump back to page 1 and invalidate every cached patients page so the
    // new patient — and its tag counts — show up without a reload.
    setPageIndex(0)
    queryClient.invalidateQueries({ queryKey: queryKeys.patients.all })
  }

  // [Medium] Archiving/restoring/permanently-deleting a patient used to leave
  // them visible in the list until a manual reload — the row action called
  // the API directly, bypassing useApiMutation's cache invalidation, and this
  // page never wired a reload callback either. Every cached patients page
  // (both Active and Archived views) is invalidated so the row disappears
  // from wherever it's currently being viewed.
  function handlePatientListChanged() {
    queryClient.invalidateQueries({ queryKey: queryKeys.patients.all })
  }

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
    [total, pageSize]
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Patient Records</h1>
          <p className="text-muted-foreground">
            {isClinicalUser
              ? 'View patient records and information.'
              : 'Manage patient records and information.'}
          </p>
        </div>
        {canCreate && <AddPatientSheet onCreated={handlePatientCreated} />}
      </div>

      <Tabs value={view} onValueChange={handleViewChange}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>
      </Tabs>

      <PatientTable
        data={rows}
        onReload={handlePatientListChanged}
        manualPagination
        pageIndex={pageIndex}
        pageSize={pageSize}
        pageCount={pageCount}
        total={total}
        onPageChange={setPageIndex}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPageIndex(0)
        }}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        loading={patientsQuery.isFetching}
        tagIds={tagIds}
        onTagIdsChange={handleTagIdsChange}
        tagCounts={tagCounts}
        view={view}
        isAdmin={isAdmin}
      />
    </div>
  )
}
