import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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
    <Link to={href}>
      <Card className={cn('hover:bg-accent/50 transition-colors cursor-pointer', className)}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formattedTotal}</div>
          {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
        </CardContent>
      </Card>
    </Link>
  )
}
