import { FileText, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { staffApi } from '@/lib/api'
import { RequestList, RequestStats, RequestsNav, type StaffRequest } from './request-shared'

export default function RequestsListPage() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<StaffRequest[]>([])
  const [loading, setLoading] = useState(true)

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

  // Everything except suggestions — those live on their own page now.
  const myRequests = useMemo(
    () => requests.filter((r) => r.requestType !== 'suggestion'),
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
          <h1 className="text-2xl font-bold tracking-tight">My Requests</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Submit and track leave, permit, or support requests.
          </p>
        </div>
        <Button
          size="sm"
          className="rounded-xl shadow-xs"
          onClick={() => navigate('/requests/new')}
        >
          <Plus size={16} />
          New
        </Button>
      </div>

      <RequestsNav />

      <RequestStats requests={myRequests} />

      <RequestList
        requests={myRequests}
        empty={
          <div className="flex flex-col items-center justify-center pt-12 text-muted-foreground">
            <FileText size={48} className="opacity-40 mb-3" />
            <p className="text-sm">No requests found</p>
            <Button size="sm" className="mt-4" onClick={() => navigate('/requests/new')}>
              Submit a Request
            </Button>
          </div>
        }
      />
    </div>
  )
}
