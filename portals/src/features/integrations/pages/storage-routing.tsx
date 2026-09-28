import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { StorageRoutingCard } from '@/features/integrations/components/storage-routing-card'
import { Button } from '@/shared/components/ui/button'

export default function StorageRoutingConfigPage() {
  return (
    <div className="p-6 space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/integrations">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to Integrations
        </Link>
      </Button>
      <StorageRoutingCard />
    </div>
  )
}
