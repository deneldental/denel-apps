import { CheckCircle2, Loader2, RefreshCw, Users, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { getPatients } from '@/lib/actions/patients'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

// Google People API scope required for contact write access
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/contacts'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

interface SyncResult {
  name: string
  phone: string
  status: 'synced' | 'skipped' | 'failed'
  reason?: string
}

// ── Google OAuth token via browser popup ─────────────────────────────────────

function getGoogleToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) {
      reject(new Error('VITE_GOOGLE_CLIENT_ID is not set'))
      return
    }

    // @ts-expect-error — google identity services loaded via CDN
    const client = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPE,
      callback: (resp: any) => {
        if (resp.error) reject(new Error(resp.error))
        else resolve(resp.access_token)
      },
    })

    if (!client) {
      reject(new Error('Google Identity Services not loaded. Add the GSI script to your HTML.'))
      return
    }

    client.requestAccessToken()
  })
}

// ── Create or update a Google Contact ────────────────────────────────────────

async function upsertContact(
  token: string,
  name: string,
  phone: string
): Promise<'synced' | 'failed'> {
  // Search for existing contact by phone number
  const searchRes = await fetch(
    `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(phone)}&readMask=names,phoneNumbers`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const searchData = (await searchRes.json()) as any
  const existing = searchData.results?.[0]?.person

  if (existing) {
    // Update in place — just return synced (avoid duplicate writes)
    return 'synced'
  }

  // Create new contact
  const body = {
    names: [{ givenName: name }],
    phoneNumbers: [{ value: phone, type: 'mobile' }],
  }
  const createRes = await fetch('https://people.googleapis.com/v1/people:createContact', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  return createRes.ok ? 'synced' : 'failed'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GoogleContactsSyncTab() {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SyncResult[]>([])
  const [summary, setSummary] = useState<{
    synced: number
    skipped: number
    failed: number
  } | null>(null)

  async function handleSync() {
    setLoading(true)
    setResults([])
    setSummary(null)

    try {
      // 1. Get OAuth token from Google
      let token: string
      try {
        token = await getGoogleToken()
      } catch (err: any) {
        toast.error(`Google auth failed: ${err.message}`)
        setLoading(false)
        return
      }

      // 2. Load all patients
      const patientsResult = await getPatients()
      if (!patientsResult.success || !patientsResult.data) {
        toast.error('Failed to load patients')
        setLoading(false)
        return
      }

      const patients = patientsResult.data

      // 3. Sync each patient with a phone number
      const syncResults: SyncResult[] = []
      let synced = 0,
        skipped = 0,
        failed = 0

      for (const patient of patients) {
        const phone =
          patient.isChild && patient.guardianPhone ? patient.guardianPhone : patient.phone

        if (!phone) {
          syncResults.push({
            name: patient.name,
            phone: '—',
            status: 'skipped',
            reason: 'No phone number',
          })
          skipped++
          continue
        }

        try {
          const status = await upsertContact(token, patient.name, phone)
          syncResults.push({ name: patient.name, phone, status })
          if (status === 'synced') synced++
          else failed++
        } catch {
          syncResults.push({ name: patient.name, phone, status: 'failed', reason: 'API error' })
          failed++
        }
      }

      setResults(syncResults)
      setSummary({ synced, skipped, failed })
      toast.success(`Sync complete — ${synced} synced, ${skipped} skipped, ${failed} failed`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Google Contacts Sync
          </CardTitle>
          <CardDescription>
            Back up patient names and phone numbers to your Google Contacts. This keeps your
            contacts available on all devices and is separate from the messaging system.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!GOOGLE_CLIENT_ID && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <strong>Setup required:</strong> Add{' '}
              <code className="bg-amber-100 px-1 rounded">VITE_GOOGLE_CLIENT_ID</code> to your{' '}
              <code className="bg-amber-100 px-1 rounded">.env</code> file and ensure the Google
              Identity Services script is loaded in{' '}
              <code className="bg-amber-100 px-1 rounded">index.html</code>.
            </div>
          )}

          <div className="text-sm text-muted-foreground space-y-1">
            <p>• Signs in with your Google account via a popup</p>
            <p>• Creates a contact for every patient that has a phone number</p>
            <p>• Skips patients that already exist (matched by phone)</p>
            <p>• Does not modify or delete existing contacts</p>
          </div>

          <Button onClick={handleSync} disabled={loading || !GOOGLE_CLIENT_ID} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing…
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Patients to Google Contacts
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-green-700">
                <CheckCircle2 className="h-4 w-4" /> {summary.synced} synced
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-4 w-4 text-center">—</span> {summary.skipped} skipped
              </span>
              {summary.failed > 0 && (
                <span className="flex items-center gap-1.5 text-destructive">
                  <XCircle className="h-4 w-4" /> {summary.failed} failed
                </span>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border divide-y text-sm">
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.phone}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {r.status === 'synced' && (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                        Synced
                      </Badge>
                    )}
                    {r.status === 'skipped' && (
                      <Badge variant="outline">{r.reason ?? 'Skipped'}</Badge>
                    )}
                    {r.status === 'failed' && <Badge variant="destructive">Failed</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
