import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Clock,
  Cloud,
  CreditCard,
  Database,
  ExternalLink,
  Folder,
  Globe,
  ImageIcon,
  Mail,
  MessageSquare,
  Phone,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listApiKeys } from '@/lib/actions/api-keys'
import { getGoogleOAuthConfig } from '@/lib/actions/google-calendar'
import { getGoogleContactsStatus } from '@/lib/actions/google-contacts'
import {
  getAnvizStatus,
  getBackupStatus,
  getCloudinaryStatus,
  getCronEngineStatus,
  getDoSpacesStatus,
  getHubtelStatus,
  getR2Status,
  getStorageRouting,
  getUpstashStatus,
} from '@/lib/actions/integrations'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'

type StatusKind = 'connected' | 'disconnected' | 'needs_config' | 'checking'

type Integration = {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  /** Static fallback. Overridden by live fetch when a resolver is registered. */
  status: 'connected' | 'disconnected' | 'needs_config'
  docsHref?: string
  configHref?: string
}

/**
 * Per-integration live status resolver. Only integrations with a backing
 * config endpoint live here — placeholders (Paystack, WhatsApp etc.) fall
 * through to the static `status` baked into INTEGRATIONS.
 */
const STATUS_RESOLVERS: Record<string, () => Promise<StatusKind>> = {
  'google-calendar': async () => {
    const res = await getGoogleOAuthConfig()
    if (!res.success || !res.data) return 'needs_config'
    return res.data.source !== 'none' && res.data.clientId && res.data.hasClientSecret
      ? 'connected'
      : 'needs_config'
  },
  'google-contacts': async () => {
    const res = await getGoogleContactsStatus()
    if (!res.success || !res.data) return 'needs_config'
    if (!res.data.configured) return 'needs_config'
    return res.data.connected ? 'connected' : 'disconnected'
  },
  'hubtel-sms': async () => {
    const res = await getHubtelStatus()
    return res.success && res.data?.hasClientId && res.data?.hasClientSecret
      ? 'connected'
      : 'needs_config'
  },
  'cloudflare-r2': async () => {
    const res = await getR2Status()
    return res.success && res.data?.hasAccessKey && res.data?.hasSecretKey && res.data?.bucket
      ? 'connected'
      : 'needs_config'
  },
  'do-spaces': async () => {
    const res = await getDoSpacesStatus()
    return res.success && res.data?.hasAccessKey && res.data?.hasSecretKey && res.data?.bucket
      ? 'connected'
      : 'needs_config'
  },
  cloudinary: async () => {
    const res = await getCloudinaryStatus()
    return res.success && res.data?.enabled && res.data?.hasApiKey && res.data?.hasApiSecret
      ? 'connected'
      : 'needs_config'
  },
  'db-backup': async () => {
    const res = await getBackupStatus()
    return res.success && res.data?.hasConnectionString && res.data?.enabled
      ? 'connected'
      : 'needs_config'
  },
  upstash: async () => {
    const res = await getUpstashStatus()
    return res.success && res.data?.hasQstashToken && res.data?.hasRedisRestToken
      ? 'connected'
      : 'needs_config'
  },
  'cron-engine': async () => {
    const res = await getCronEngineStatus()
    if (!res.success || !res.data) return 'needs_config'
    return res.data.config.nodeCronEnabled || res.data.config.qstashEnabled
      ? 'connected'
      : 'needs_config'
  },
  'storage-routing': async () => {
    const res = await getStorageRouting()
    if (!res.success || !res.data) return 'needs_config'
    const configured = new Set(res.data.providers.filter((p) => p.configured).map((p) => p.id))
    const missing = Object.values(res.data.routing).filter((id) => !configured.has(id))
    return missing.length === 0 ? 'connected' : 'needs_config'
  },
  'website-booking': async () => {
    const res = await listApiKeys()
    const active = (res.data ?? []).some((k) => !k.revokedAt)
    return res.success && active ? 'connected' : 'needs_config'
  },
  anviz: async () => {
    const res = await getAnvizStatus()
    return res.success &&
      res.data?.hasWebhookPassword &&
      res.data?.hasApiKey &&
      res.data?.hasApiSecret
      ? 'connected'
      : 'needs_config'
  },
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description:
      'Per-user outbound sync — your assigned appointments mirror to your Google Calendar.',
    icon: <Calendar className="h-5 w-5" />,
    status: 'needs_config',
    configHref: '/integrations/google-calendar',
  },
  {
    id: 'hubtel-sms',
    name: 'Hubtel SMS',
    description: 'SMS gateway for appointment reminders, recalls, and patient confirmations.',
    icon: <Phone className="h-5 w-5" />,
    status: 'connected',
    configHref: '/integrations/hubtel',
  },
  {
    id: 'resend-email',
    name: 'Resend',
    description: 'Transactional email (receipts, reports, notifications).',
    icon: <Mail className="h-5 w-5" />,
    status: 'needs_config',
  },
  {
    id: 'cloudflare-r2',
    name: 'Cloudflare R2',
    description: 'Object storage for photos, documents, X-rays, and backups.',
    icon: <Cloud className="h-5 w-5" />,
    status: 'connected',
    configHref: '/integrations/r2',
  },
  {
    id: 'do-spaces',
    name: 'DigitalOcean Spaces',
    description: 'S3-compatible object storage hosted by DigitalOcean.',
    icon: <Cloud className="h-5 w-5" />,
    status: 'disconnected',
    configHref: '/integrations/do-spaces',
  },
  {
    id: 'cloudinary',
    name: 'Cloudinary',
    description: 'Image/video CDN with on-the-fly transformations. Routes uploads when enabled.',
    icon: <ImageIcon className="h-5 w-5" />,
    status: 'needs_config',
    configHref: '/integrations/cloudinary',
  },
  {
    id: 'db-backup',
    name: 'Database Backup',
    description: 'Scheduled pg_dump backups uploaded to your configured storage provider.',
    icon: <Database className="h-5 w-5" />,
    status: 'needs_config',
    configHref: '/integrations/backup',
  },
  {
    id: 'upstash',
    name: 'Upstash',
    description:
      'QStash powers scheduled cron jobs; Redis provides distributed locking so jobs only run once across instances.',
    icon: <Zap className="h-5 w-5" />,
    status: 'needs_config',
    configHref: '/integrations/upstash',
  },
  {
    id: 'cron-engine',
    name: 'Cron Engine',
    description:
      'Pick the scheduler (in-process node-cron, QStash, or both), see job history, trigger jobs manually.',
    icon: <Clock className="h-5 w-5" />,
    status: 'needs_config',
    configHref: '/integrations/cron-engine',
  },
  {
    id: 'storage-routing',
    name: 'Storage Routing',
    description:
      'Map each file category (patient records, staff, system, misc) to a storage provider.',
    icon: <Folder className="h-5 w-5" />,
    status: 'needs_config',
    configHref: '/integrations/storage-routing',
  },
  {
    id: 'hubtel-pay',
    name: 'Hubtel Payments',
    description: 'Online payment processing (momo, card, bank).',
    icon: <CreditCard className="h-5 w-5" />,
    status: 'disconnected',
  },
  {
    id: 'paystack',
    name: 'Paystack',
    description: 'Alternative payment processor for Ghana.',
    icon: <CreditCard className="h-5 w-5" />,
    status: 'disconnected',
  },
  {
    id: 'google-contacts',
    name: 'Google Contacts',
    description:
      'Per-user outbound sync — push patient contacts into your Google Contacts. Shares the Google Calendar OAuth credentials.',
    icon: <BookOpen className="h-5 w-5" />,
    status: 'needs_config',
    configHref: '/integrations/google-calendar',
  },
  {
    id: 'website-booking',
    name: 'Website Bookings',
    description:
      'Issue API keys the marketing website uses to submit booking requests. Generate, test, and revoke per-site keys.',
    icon: <Globe className="h-5 w-5" />,
    status: 'needs_config',
    configHref: '/integrations/website-bookings',
  },
  {
    id: 'whatsapp-business',
    name: 'WhatsApp Business API',
    description: 'Automated WhatsApp dispatch (X-ray share links, reminders).',
    icon: <MessageSquare className="h-5 w-5" />,
    status: 'disconnected',
  },
  {
    id: 'anviz',
    name: 'Anviz Attendance',
    description:
      'Biometric attendance integration. Enter your Cloud API keys and configure the webhook URL to automatically synchronize swipes with staff timesheets.',
    icon: <Clock className="h-5 w-5" />,
    status: 'needs_config',
    configHref: '/integrations/anviz',
  },
  {
    id: 'data-sync',
    name: 'Data Sync',
    description: 'Cross-environment data synchronization.',
    icon: <Database className="h-5 w-5" />,
    status: 'connected',
    configHref: '/data-sync',
  },
]

const STATUS_STYLES: Record<StatusKind, string> = {
  connected:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
  disconnected:
    'bg-muted text-foreground border-border dark:bg-gray-800/50 dark:text-muted-foreground',
  needs_config:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300',
  checking:
    'bg-muted text-muted-foreground border-border dark:bg-gray-800/30 dark:text-muted-foreground dark:border-gray-700',
}

const STATUS_LABEL: Record<StatusKind, string> = {
  connected: 'Connected',
  disconnected: 'Not Connected',
  needs_config: 'Needs Config',
  checking: 'Checking…',
}

export default function IntegrationsHubPage() {
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [liveStatuses, setLiveStatuses] = useState<Record<string, StatusKind>>(() => {
    const initial: Record<string, StatusKind> = {}
    for (const id of Object.keys(STATUS_RESOLVERS)) initial[id] = 'checking'
    return initial
  })

  useEffect(() => {
    // Storage routing — keep the warning banner separate from the badge logic.
    getStorageRouting().then((res) => {
      if (!res.success || !res.data) {
        setStorageWarning('Could not load storage routing. Configure storage providers below.')
        return
      }
      const { routing, providers } = res.data
      const configuredIds = new Set(providers.filter((p) => p.configured).map((p) => p.id))
      const usedProviders = new Set(Object.values(routing))
      const missing = [...usedProviders].filter((id) => !configuredIds.has(id))
      if (missing.length > 0) {
        setStorageWarning(
          `Storage routing references unconfigured provider(s): ${missing.join(', ')}. Uploads to those categories will fail until you configure them.`
        )
      } else {
        setStorageWarning(null)
      }
    })

    // Per-integration live status — all fetched in parallel so the page
    // doesn't wait on the slowest one. Failures resolve to needs_config so
    // a flaky endpoint never leaves a card stuck on "Checking…".
    const entries = Object.entries(STATUS_RESOLVERS)
    for (const [id, resolve] of entries) {
      resolve()
        .catch(() => 'needs_config' as StatusKind)
        .then((status) => {
          setLiveStatuses((prev) => ({ ...prev, [id]: status }))
        })
    }
  }, [])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage connections to third-party services powering the clinic.
        </p>
      </div>

      {storageWarning && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="font-semibold">Storage not fully configured</p>
            <p className="text-xs leading-relaxed">{storageWarning}</p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to="/integrations/storage-routing">Fix</Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {INTEGRATIONS.map((intg) => {
          const status: StatusKind = liveStatuses[intg.id] ?? intg.status
          return (
            <Card
              key={intg.id}
              className="hover:border-primary/50 transition-colors h-full flex flex-col"
            >
              <CardContent className="p-6 space-y-3 flex-1 flex flex-col justify-center">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      {intg.icon}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm truncate">{intg.name}</h3>
                      <Badge
                        variant="outline"
                        className={`text-[10px] mt-0.5 ${STATUS_STYLES[status]}`}
                      >
                        {STATUS_LABEL[status]}
                      </Badge>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{intg.description}</p>
                <div className="flex items-center gap-2">
                  {intg.configHref ? (
                    <Button size="sm" variant="outline" asChild className="flex-1">
                      <Link to={intg.configHref}>Configure</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="flex-1" disabled>
                      Configure
                    </Button>
                  )}
                  {intg.docsHref && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={intg.docsHref} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
