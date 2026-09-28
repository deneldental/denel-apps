import { FileText } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface StaffMember {
  id: string
  fullName: string
  role: string
  employmentType: string
  createdAt: Date
  documents?: Array<{
    id: string
    title: string
    description: string | null
    fileUrl: string
    uploadedAt: Date
  }>
}

interface StaffCardProps {
  staff: StaffMember
}

export function StaffCard({ staff }: StaffCardProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="truncate">{staff.fullName}</CardTitle>
            <CardDescription className="truncate">{staff.role}</CardDescription>
          </div>
          <Badge
            variant={staff.employmentType === 'permanent' ? 'default' : 'secondary'}
            className="shrink-0"
          >
            {staff.employmentType.charAt(0).toUpperCase() + staff.employmentType.slice(1)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link to={`/staff/${staff.id}/documents`}>
            <FileText className="mr-2 h-4 w-4" />
            Manage Documents ({staff.documents?.length || 0})
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
