import { format } from 'date-fns'
import { ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { getSentSMSMessages, getSMSStatus } from '@/lib/actions/sms'
import type { smsMessages } from '@/lib/db/schema'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

type SMSMessage = typeof smsMessages.$inferSelect & {
  patient?: { id: string; name: string } | null
}

interface HubtelStatusData {
  status?: string
  batchId?: string
  messageId?: string
  recipient?: string
  from?: string
  content?: string
  createdAt?: string
  sentAt?: string
  deliveredAt?: string
  messages?: Array<{
    recipient?: string
    To?: string
    status?: string
    messageId?: string
    sentAt?: string
  }>
}

const MESSAGES_KEY = ['messaging', 'sms', 'sent'] as const

export function SMSStatusTab() {
  const [messageId, setMessageId] = useState('')
  const [isBatch, setIsBatch] = useState(false)
  const [statusData, setStatusData] = useState<HubtelStatusData | null>(null)
  const [checkingStatusFor, setCheckingStatusFor] = useState<string | null>(null)

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  const messagesQuery = useApiQuery<SMSMessage[]>(MESSAGES_KEY, getSentSMSMessages)
  const messages = messagesQuery.data ?? []
  const loadingMessages = messagesQuery.isLoading

  const loadMessages = () => {
    setCurrentPage(1)
    messagesQuery.refetch()
  }

  const checkStatusMutation = useApiMutation(
    (vars: { id: string; isBatch: boolean }) => getSMSStatus(vars.id, vars.isBatch),
    { invalidates: [MESSAGES_KEY] }
  )
  const isLoading = checkStatusMutation.isPending

  const handleCheckStatus = async (smsMessage?: SMSMessage) => {
    const idToCheck = smsMessage
      ? smsMessage.batchId || smsMessage.messageId || ''
      : messageId.trim()

    if (!idToCheck) {
      toast.error('Please enter a Message ID or Batch ID, or select a message')
      return
    }

    const isBatchId = smsMessage ? !!smsMessage.batchId : isBatch
    setCheckingStatusFor(smsMessage?.id || null)

    try {
      const data = await checkStatusMutation.mutateAsync({ id: idToCheck, isBatch: isBatchId })
      setStatusData(data)
      toast.success('Status retrieved successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to retrieve status')
      setStatusData(null)
    } finally {
      setCheckingStatusFor(null)
    }
  }

  const formatStatus = (status?: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (!status) return 'outline'
    const statusColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      sent: 'default',
      delivered: 'default',
      failed: 'destructive',
      pending: 'secondary',
      queued: 'secondary',
    }
    return statusColors[status.toLowerCase()] || 'outline'
  }

  const getTypeBadgeVariant = (type?: string): 'default' | 'secondary' | 'outline' => {
    if (!type) return 'outline'
    const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
      bulk: 'default',
      birthday: 'secondary',
      followup: 'outline',
    }
    return variants[type] || 'outline'
  }

  const totalPages = Math.ceil(messages.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedMessages = messages.slice(startIndex, startIndex + itemsPerPage)

  return (
    <div className="space-y-6">
      {/* Prepaid balance — Hubtel publishes no balance API, so point to Hubtel */}
      <Card>
        <CardHeader>
          <CardTitle>Prepaid Balance</CardTitle>
          <CardDescription>
            Hubtel doesn't make your SMS balance available to this system.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            To check or top up your balance, sign in to Hubtel and open{' '}
            <span className="font-medium text-foreground">Messaging → Programmable SMS</span>.
          </p>
          <Button asChild variant="outline" size="sm">
            <a href="https://hubtel.com" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Hubtel
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Manual Status Check Card - MOVED UNDER BALANCE */}
      <Card>
        <CardHeader>
          <CardTitle>Manual Status Check</CardTitle>
          <CardDescription>
            Check status by entering a Message ID or Batch ID directly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="message-id">Message ID / Batch ID</Label>
              <Input
                id="message-id"
                value={messageId}
                onChange={(e) => setMessageId(e.target.value)}
                placeholder="Enter message ID or batch ID"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-batch"
                checked={isBatch}
                onCheckedChange={(checked) => setIsBatch(checked === true)}
              />
              <Label htmlFor="is-batch" className="cursor-pointer">
                This is a Batch ID
              </Label>
            </div>

            <Button
              onClick={() => handleCheckStatus()}
              disabled={isLoading || !messageId.trim()}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Checking Status...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Check Status
                </>
              )}
            </Button>
          </div>

          {statusData && (
            <div className="space-y-4 mt-6">
              <div className="border rounded-lg p-4 space-y-3">
                <h3 className="font-semibold text-lg">Status Information</h3>

                {statusData.status && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Status:</span>
                      <Badge variant={formatStatus(statusData.status)}>
                        {statusData.status || '-'}
                      </Badge>
                    </div>
                  </div>
                )}

                {statusData.batchId && (
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium">Batch ID:</span>
                      <span className="ml-2 text-sm font-mono">{statusData.batchId}</span>
                    </div>
                  </div>
                )}

                {statusData.messageId && (
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium">Message ID:</span>
                      <span className="ml-2 text-sm font-mono">{statusData.messageId}</span>
                    </div>
                  </div>
                )}

                {statusData.recipient && (
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium">Recipient:</span>
                      <span className="ml-2 text-sm font-mono">{statusData.recipient}</span>
                    </div>
                  </div>
                )}

                {statusData.from && (
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium">From:</span>
                      <span className="ml-2 text-sm">{statusData.from}</span>
                    </div>
                  </div>
                )}

                {statusData.content && (
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium">Message:</span>
                      <p className="mt-1 text-sm text-muted-foreground">{statusData.content}</p>
                    </div>
                  </div>
                )}

                {statusData.createdAt && (
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium">Created At:</span>
                      <span className="ml-2 text-sm">
                        {new Date(statusData.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                {statusData.sentAt && (
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium">Sent At:</span>
                      <span className="ml-2 text-sm">
                        {new Date(statusData.sentAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                {statusData.deliveredAt && (
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium">Delivered At:</span>
                      <span className="ml-2 text-sm">
                        {new Date(statusData.deliveredAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                {statusData.messages &&
                  Array.isArray(statusData.messages) &&
                  statusData.messages.length > 0 && (
                    <div className="space-y-2 mt-4">
                      <span className="text-sm font-medium">Batch Messages:</span>
                      <div className="border rounded-lg mt-2">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Recipient</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Message ID</TableHead>
                              <TableHead>Sent At</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {statusData.messages.map((msg, index: number) => (
                              <TableRow key={index}>
                                <TableCell className="font-mono text-xs">
                                  {msg.recipient || msg.To || '-'}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={formatStatus(msg.status)}>
                                    {msg.status || '-'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {msg.messageId || '-'}
                                </TableCell>
                                <TableCell>
                                  {msg.sentAt ? new Date(msg.sentAt).toLocaleString() : '-'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                <details className="mt-4">
                  <summary className="text-sm text-muted-foreground cursor-pointer">
                    View Raw Response
                  </summary>
                  <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-auto max-h-64">
                    {JSON.stringify(statusData, null, 2)}
                  </pre>
                </details>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>SMS Status History</CardTitle>
              <CardDescription>View and check the status of sent SMS messages.</CardDescription>
            </div>
            <Button onClick={loadMessages} variant="outline" size="sm" disabled={loadingMessages}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loadingMessages ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingMessages ? (
            <div className="text-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p className="text-muted-foreground">Loading sent SMS messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 border rounded-lg">
              <p className="text-muted-foreground">No SMS messages sent yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Sent At</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedMessages.map((sms) => (
                      <TableRow key={sms.id}>
                        <TableCell>
                          <Badge variant={getTypeBadgeVariant(sms.type)} className="capitalize">
                            {sms.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{sms.recipient}</TableCell>
                        <TableCell>{sms.patient?.name || '-'}</TableCell>
                        <TableCell className="max-w-[200px]">
                          <p className="truncate text-sm">{sms.content}</p>
                        </TableCell>
                        <TableCell>
                          {format(new Date(sms.sentAt), "MMM d, yyyy 'at' h:mm a")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={formatStatus(sms.status)}>{sms.status}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                          {sms.batchId || sms.messageId || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCheckStatus(sms)}
                            disabled={isLoading && checkingStatusFor === sms.id}
                          >
                            {isLoading && checkingStatusFor === sms.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Search className="h-4 w-4 mr-2" />
                                Check
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between py-4">
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(
                          (page) =>
                            page === 1 ||
                            page === totalPages ||
                            (page >= currentPage - 2 && page <= currentPage + 2)
                        )
                        .map((page, index, array) => {
                          const prevPage = array[index - 1]
                          return (
                            <div key={page} className="flex items-center gap-1">
                              {prevPage && page - prevPage > 1 && (
                                <span className="text-muted-foreground">...</span>
                              )}
                              <Button
                                variant={currentPage === page ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setCurrentPage(page)}
                                className="w-8 h-8 p-0"
                              >
                                {page}
                              </Button>
                            </div>
                          )
                        })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
