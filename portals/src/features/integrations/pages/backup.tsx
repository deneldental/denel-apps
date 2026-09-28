import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BackupConfigCard } from '@/features/integrations/components/backup-config-card'
import { Button } from '@/shared/components/ui/button'

export default function BackupConfigPage() {
  return (
    <div className="p-6 space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/integrations">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to Integrations
        </Link>
      </Button>
      <BackupConfigCard />
    </div>
  )
}
