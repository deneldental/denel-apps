import { Loader2, RefreshCw } from 'lucide-react'
import { getEmailStatus } from '@/lib/actions/email'
import { useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

function StatusBadge({ status }: { status: string }) {
  if (status === 'sent')
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Sent</Badge>
  if (status.startsWith('failed')) return <Badge variant="destructive">Failed</Badge>
  return (
    <Badge variant="outline" className="capitalize">
      {status}
    </Badge>
  )
}

const EMAIL_STATUS_KEY = ['messaging', 'email', 'status'] as const

export function EmailStatusTab() {
  const emailStatusQuery = useApiQuery<any[]>(EMAIL_STATUS_KEY, getEmailStatus)
  const rows = emailStatusQuery.data ?? []
  const loading = emailStatusQuery.isLoading

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Email History</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => emailStatusQuery.refetch()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">No emails sent yet.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{row.recipient}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{row.subject}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-xs">
                        {row.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.sentAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
