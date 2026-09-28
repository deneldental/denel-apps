import { Inbox, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { staffApi } from '@/lib/api'
import { RequestList, RequestStats, RequestsNav, type StaffRequest } from './request-shared'
import { SuggestionSheet } from './SuggestionSheet'

export default function SuggestionsPage() {
  const [requests, setRequests] = useState<StaffRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    staffApi
      .getRequests()
      .then((res) => {
        if (res.success && res.data) setRequests(res.data as StaffRequest[])
        else setRequests([])
        setLoading(false)
      })
      .catch(() => {
        setRequests([])
        setLoading(false)
      })
  }, [])

  const suggestions = useMemo(
    () => requests.filter((r) => r.requestType === 'suggestion'),
    [requests]
  )

  if (loading) {
    return (
      <div className="page-enter p-5 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-20 rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="page-enter p-5 space-y-5 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff Suggestions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Submit feedback, suggestions, or ideas for the clinic.
          </p>
        </div>
        <Button size="sm" className="rounded-xl shadow-xs" onClick={() => setSheetOpen(true)}>
          <Plus size={16} />
          Suggest
        </Button>
      </div>

      <RequestsNav />

      <RequestStats requests={suggestions} />

      <RequestList
        requests={suggestions}
        heading={suggestions.length > 0 ? 'My Suggestions History' : undefined}
        empty={
          <div className="flex flex-col items-center justify-center pt-12 text-muted-foreground">
            <Inbox size={48} className="opacity-40 mb-3" />
            <p className="text-sm">No suggestions submitted yet</p>
            <Button size="sm" className="mt-4" onClick={() => setSheetOpen(true)}>
              Submit a Suggestion
            </Button>
          </div>
        }
      />

      <SuggestionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSubmitted={(created) => setRequests((prev) => [created, ...prev])}
      />
    </div>
  )
}
