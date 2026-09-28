import { Folder } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  getStorageRouting,
  type StorageProviderId,
  type StorageRoutingResponse,
  saveStorageRouting,
} from '@/lib/actions/integrations'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'

const CATEGORIES: Array<{
  id: keyof StorageRoutingResponse['routing']
  label: string
  description: string
}> = [
  {
    id: 'patient_records',
    label: 'Patient Records',
    description: 'X-rays, consents, medical record attachments, patient documents, statements',
  },
  {
    id: 'staff',
    label: 'Staff Files',
    description: 'Avatars, HR documents, training materials, staff request attachments',
  },
  {
    id: 'system_docs',
    label: 'System Documents',
    description:
      'Branding, product/inventory images, expense receipts, DB backups, exports — under SYS/',
  },
  {
    id: 'misc',
    label: 'Miscellaneous',
    description: "Anything the upload code can't categorize — falls into MISC/",
  },
]

export const STORAGE_ROUTING_KEY = ['integrations', 'storage-routing'] as const

export function StorageRoutingCard() {
  const query = useApiQuery(STORAGE_ROUTING_KEY, getStorageRouting)
  const loading = query.isLoading

  const saveMutation = useApiMutation(saveStorageRouting, { invalidates: [STORAGE_ROUTING_KEY] })

  const [data, setData] = useState<StorageRoutingResponse | null>(null)

  useEffect(() => {
    if (query.data) setData(query.data)
  }, [query.data])

  const setCategory = (
    categoryId: keyof StorageRoutingResponse['routing'],
    providerId: StorageProviderId
  ) => {
    if (!data) return
    setData({ ...data, routing: { ...data.routing, [categoryId]: providerId } })
  }

  const handleSave = async () => {
    if (!data) return
    try {
      await saveMutation.mutateAsync(data.routing)
      toast.success('Storage routing saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const saving = saveMutation.isPending
  const configuredProviders = data?.providers.filter((p) => p.configured) ?? []
  const noneConfigured = configuredProviders.length === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Folder className="h-5 w-5" />
          Storage Routing
        </CardTitle>
        <CardDescription>
          Choose which storage provider handles each file category. Every category stores private
          files, so Cloudinary — public delivery only — can't be picked here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {noneConfigured && !loading && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            Configure at least one storage provider above before assigning categories.
          </div>
        )}

        <div className="space-y-3">
          {CATEGORIES.map((cat) => (
            <div
              key={cat.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0 max-w-md">
                <Label className="font-medium">{cat.label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{cat.description}</p>
                {data?.routing[cat.id] === 'cloudinary' && (
                  <p className="text-xs text-destructive mt-1">
                    {cat.label} is routed to Cloudinary, which can't store private files — uploads
                    here fail until it is moved to Cloudflare R2 or DigitalOcean Spaces.
                  </p>
                )}
              </div>
              <Select
                value={data?.routing[cat.id]}
                onValueChange={(v) => setCategory(cat.id, v as StorageProviderId)}
                disabled={loading || noneConfigured}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {data?.providers.map((p) => {
                    // Every category stores private files, and Cloudinary
                    // can't keep files private — the backend refuses such
                    // uploads, so the choice is closed off here too.
                    const cannotStorePrivate = p.id === 'cloudinary'
                    return (
                      <SelectItem
                        key={p.id}
                        value={p.id}
                        disabled={!p.configured || cannotStorePrivate}
                      >
                        {p.label}
                        {cannotStorePrivate
                          ? " — can't store private files"
                          : !p.configured
                            ? ' (not configured)'
                            : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        <Button onClick={handleSave} disabled={loading || saving || noneConfigured}>
          {saving ? 'Saving…' : 'Save routing'}
        </Button>
      </CardContent>
    </Card>
  )
}
