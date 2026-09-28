import { AlertCircle, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'

/**
 * Shown by a settings section when its `useKvSetting` load failed. Renders
 * nothing when there is no error, so sections can place it unconditionally.
 * Says explicitly that saving is disabled: the form below still shows the
 * defaults, and an admin must not mistake them for the stored values.
 */
export function SettingsLoadError({
  error,
  onRetry,
}: {
  error: string | null
  onRetry?: () => void
}) {
  if (!error) return null
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Couldn't load these settings</AlertTitle>
      <AlertDescription>
        <p>
          {error}. The values shown are the defaults, not what is saved — saving is disabled until
          the settings load.
        </p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
