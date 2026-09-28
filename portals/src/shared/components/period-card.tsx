import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

interface PeriodCardProps {
  title: string
  total: number
  href: string
  subtext?: string
  className?: string
}

export function PeriodCard({ title, total, href, subtext, className }: PeriodCardProps) {
  const formattedTotal = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(total)

  return (
    <Link to={href} className="block h-full">
      <Card
        className={cn(
          'hover:bg-accent/50 transition-colors cursor-pointer h-full flex flex-col justify-between overflow-hidden',
          className
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium truncate w-full" title={title}>
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold truncate" title={formattedTotal}>
            {formattedTotal}
          </div>
          {subtext && (
            <p className="text-xs text-muted-foreground truncate" title={subtext}>
              {subtext}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
