import {
  AlertCircle,
  CheckCircle,
  Database,
  History,
  Loader2,
  Lock,
  Search,
  Upload,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getPatientsForSync } from '@/lib/actions/data-sync-preview'
import {
  getSyncConfig,
  getSyncHistory,
  performManualSync,
  type SyncResult,
} from '@/lib/actions/data-sync-v2'
import { useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { PatientMultiSelect } from '@/shared/components/ui/patient-multiselect'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'

interface SyncLogEntry {
  id: string
  entityType: string
  entityId: string
  syncMode: string
  destination: string | null
  success: boolean
  errorMessage: string | null
  syncedAt: Date | string
}

export default function DataSyncPage() {
  // Destination Database State
  const [connectionString, setConnectionString] = useState('')
  const [isDbLocked, setIsDbLocked] = useState(false)
  const [isDbConnected, setIsDbConnected] = useState(false)

  // Manual Sync State
  const [selectedPatients, setSelectedPatients] = useState<string[]>([])
  const [_patientsList, setPatientsList] = useState<Record<string, unknown>[]>([])

  const [isSyncing, setIsSyncing] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)

  const {
    data: syncHistory = [],
    isLoading: isLoadingHistory,
    error: syncHistoryError,
    refetch: refetchHistory,
  } = useApiQuery(['data-sync', 'history'], () => getSyncHistory(), {
    select: (rows) => rows as SyncLogEntry[],
  })

  useEffect(() => {
    if (syncHistoryError) toast.error('Failed to load sync history')
  }, [syncHistoryError])

  const handleConnectDatabase = () => {
    if (!connectionString) {
      toast.error('Please enter a connection string')
      return
    }
    setIsDbConnected(true)
    setIsDbLocked(true)
    toast.success('Database connected successfully')
  }

  const _handleUnlockDatabase = () => {
    setIsDbLocked(false)
    toast.info('Database unlocked for editing')
  }

  const _handleLockDatabase = () => {
    if (!connectionString) {
      toast.error('Please enter a connection string first')
      return
    }
    setIsDbLocked(true)
    toast.success('Database locked')
  }

  const handleManualSync = async () => {
    if (!connectionString) {
      toast.error('Please connect to a database first')
      return
    }

    if (selectedPatients.length === 0) {
      toast.error('Please select at least one patient')
      return
    }

    setIsSyncing(true)
    try {
      const syncResult = await performManualSync(connectionString, selectedPatients)
      setResult(syncResult)
      if (syncResult.success) {
        toast.success(syncResult.message)
      } else {
        toast.error(syncResult.message)
      }
    } catch (error) {
      toast.error('Failed to perform manual sync')
      console.error(error)
    } finally {
      setIsSyncing(false)
      refetchHistory()
    }
  }

  // Load data on mount. The sync-history read now lives in its own
  // `useApiQuery` above (fetches itself on mount) — this effect keeps only the
  // non-API bits: the localStorage-backed "connection" stub and the (currently
  // unused — `_patientsList`) preview patient list, both left as-is.
  useEffect(() => {
    const loadInitialData = async () => {
      const [config, patientsResult] = await Promise.all([getSyncConfig(), getPatientsForSync()])

      if (patientsResult.success && patientsResult.data) {
        setPatientsList(patientsResult.data)
      }

      if (config.destinationUrl) {
        setConnectionString(config.destinationUrl)
        setIsDbLocked(config.isLocked ?? false)
        setIsDbConnected(true)
      }
    }
    loadInitialData()
  }, [])

  return (
    <div className="container mx-auto py-8 max-w-5xl">
      <div className="mb-8 flex items-center gap-3">
        <Database className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight">Data Synchronization</h1>
      </div>

      {/* Destination Database - Above Tabs */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Destination Database</CardTitle>
              <CardDescription>
                Connect to the external database where data will be synchronized.
              </CardDescription>
            </div>
            {isDbConnected && (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="text-sm font-medium text-green-600">Connected</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="connection-string">Connection String</Label>
            <div className="flex gap-2">
              <Input
                id="connection-string"
                placeholder="postgres://user:password@endpoint.neon.tech/dbname..."
                value={connectionString}
                onChange={(e) => setConnectionString(e.target.value)}
                type="password"
                disabled={isDbLocked}
                className={isDbLocked ? 'bg-muted opacity-80' : ''}
                readOnly={isDbLocked}
              />
              {isDbLocked && (
                <div className="flex items-center px-3 text-muted-foreground bg-muted border border-l-0 rounded-r-md">
                  <Lock className="h-4 w-4" />
                </div>
              )}
            </div>
          </div>
          {!isDbConnected && (
            <Button onClick={handleConnectDatabase} disabled={!connectionString || isDbLocked}>
              <Database className="mr-2 h-4 w-4" />
              Connect Database
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="manual">
            <Search className="h-4 w-4 mr-2" />
            Manual Sync
          </TabsTrigger>
          <TabsTrigger value="records">
            <History className="h-4 w-4 mr-2" />
            Sync Records
          </TabsTrigger>
        </TabsList>

        {/* Manual Sync Tab */}
        <TabsContent value="manual" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Manual Patient Sync</CardTitle>
              <CardDescription>
                Search and select specific patients to synchronize. Their associated transactions
                (payments) will also be included.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="patient-search">Select Patients</Label>
                  <PatientMultiSelect
                    value={selectedPatients}
                    onChange={setSelectedPatients}
                    placeholder="Search and select patients..."
                  />
                </div>
              </div>

              {selectedPatients.length > 0 && (
                <div className="p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">Selected for Sync:</h4>
                  <p className="text-sm">
                    {selectedPatients.length} patient{selectedPatients.length === 1 ? '' : 's'} and
                    their associated transactions selected.
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button
                onClick={handleManualSync}
                disabled={isSyncing || !isDbConnected || selectedPatients.length === 0}
                className="w-full sm:w-auto"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Sync Selected
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* Sync Records Tab */}
        <TabsContent value="records" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Synchronization History</CardTitle>
                  <CardDescription>
                    Track all synchronization operations and their results.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchHistory()}
                  disabled={isLoadingHistory}
                >
                  <History className={`h-4 w-4 mr-2 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                  Refresh History
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Result Display if available */}
              {result && (
                <div
                  className={`mb-6 p-4 rounded-lg border ${result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {result.success ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-red-600" />
                    )}
                    <h4
                      className={`font-semibold ${result.success ? 'text-green-800' : 'text-red-800'}`}
                    >
                      Sync Result: {result.success ? 'Success' : 'Partial Failure/Error'}
                    </h4>
                  </div>
                  <p className="text-sm mb-4">{result.message}</p>
                  {result.details && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                      <div className="p-2 bg-background rounded shadow-sm">
                        <span className="text-muted-foreground block">Total Items</span>
                        <span className="font-bold text-lg">{result.details.totalRecords}</span>
                      </div>
                      <div className="p-2 bg-background rounded shadow-sm text-green-600">
                        <span className="text-muted-foreground block">Synced</span>
                        <span className="font-bold text-lg">{result.details.syncedRecords}</span>
                      </div>
                      <div className="p-2 bg-background rounded shadow-sm text-red-600">
                        <span className="text-muted-foreground block">Failed</span>
                        <span className="font-bold text-lg">{result.details.failed}</span>
                      </div>
                    </div>
                  )}
                  {result.details?.errors && result.details.errors.length > 0 && (
                    <div className="mt-4">
                      <span className="text-xs font-semibold block mb-1">Errors:</span>
                      <ul className="text-[10px] space-y-1 list-disc pl-4 text-red-700 overflow-auto max-h-32">
                        {result.details.errors.map((error, i) => (
                          <li key={i}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {isLoadingHistory ? (
                <div className="flex justify-center items-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mr-2" />
                  <span className="text-muted-foreground">Loading history...</span>
                </div>
              ) : syncHistory.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">No Sync Records Yet</p>
                  <p className="text-sm">
                    Synchronization history will appear here after you perform your first sync.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted text-muted-foreground text-xs uppercase bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 font-medium">Date & Time</th>
                        <th className="px-4 py-3 font-medium">Mode</th>
                        <th className="px-4 py-3 font-medium">Entity Type</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncHistory.map((log) => (
                        <tr key={log.id} className="border-t hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                            {new Date(log.syncedAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="bg-secondary px-2 py-1 rounded text-xs capitalize">
                              {log.syncMode}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap capitalize">
                            {log.entityType.replace('_', ' ')}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {log.success ? (
                              <div className="flex items-center text-green-600">
                                <CheckCircle className="h-4 w-4 mr-1" />
                                <span>Success</span>
                              </div>
                            ) : (
                              <div className="flex items-center text-red-600">
                                <AlertCircle className="h-4 w-4 mr-1" />
                                <span>Failed</span>
                              </div>
                            )}
                          </td>
                          <td
                            className="px-4 py-3 text-xs max-w-[200px] truncate"
                            title={log.errorMessage || `Target: ${log.destination}`}
                          >
                            {log.success ? (
                              <span className="text-muted-foreground">ID: {log.entityId}</span>
                            ) : (
                              <span className="text-red-500">{log.errorMessage}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
