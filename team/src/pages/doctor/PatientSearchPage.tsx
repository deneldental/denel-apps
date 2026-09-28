import { Loader2, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

interface Patient {
  id: string
  patientId: string
  name: string
  phone: string | null
  createdAt: string
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export default function DoctorPatientSearchPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<Patient[]>('/api/patients')
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setPatients(res.data)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const results = useMemo<Patient[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return [...patients].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
    }
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.phone ?? '').includes(q) ||
        p.patientId.toLowerCase().includes(q)
    )
  }, [patients, query])

  const heading = query.trim() ? 'Results' : 'Recent patients'

  return (
    <div className="pb-8">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-5 py-4 space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">Find patient</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, or ID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="p-5 space-y-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {heading}
            </p>

            {results.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No patients found.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {results.map((p) => (
                  <Card
                    key={p.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => navigate(`/doctor/patients/${p.id}`)}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                          {getInitials(p.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          #{p.patientId}
                          {p.phone ? ` · ${p.phone}` : ''}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
