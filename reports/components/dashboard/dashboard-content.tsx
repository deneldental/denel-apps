import { format, formatDistanceToNow } from 'date-fns'
import {
  Calendar,
  DollarSign,
  FileText,
  Gift,
  Package,
  TrendingDown,
  UserPlus,
  Users,
} from 'lucide-react'
import { useTransition } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { OverduePaymentsCard } from '@/components/dashboard/overdue-payments-card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCompactNumber, formatCurrency, formatCurrencyCompact } from '@/lib/utils/currency'

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

type DashboardContentProps = {
  stats: {
    totalPatients: number
    totalRevenue: number
    totalExpenses: number
    checkedIn: number
    booked: number
  }
  upcomingAppointments: Array<{
    id: string
    date: Date
    status: string
    type: string
    patient: {
      id: string
      name: string
      phone: string | null
      profileImage: string | null
    }
    doctor: {
      id: string
      user: {
        name: string
      }
    }
  }>
  overduePayments: Array<{
    id: string
    patient: {
      id: string
      name: string
      phone: string | null
      guardianPhone: string | null
      isChild: boolean
    }
    totalAmount: number
    amountPerInstallment: number | null
    paymentFrequency: string | null
    startDate: Date
    payments: Array<{
      amount: number
      status: string
    }>
  }>
  recentReports: Array<{
    id: string
    reportDate: Date
    totalPayments: number
    totalExpenses: number
    checkedInCount: number
    newPatientsCount: number
    submittedBy: {
      name: string | null
      email: string | null
    } | null
  }>
  lowStockItems: Array<{
    id: string
    name: string
    stockQuantity: number
    reorderLevel: number | null
    unit: string | null
    type: string
  }>
  birthdaysAndFollowups: {
    birthdays: Array<{
      id: string
      name: string
      phone: string | null
      profileImage: string | null
      dob: Date
      type: 'birthday'
      date: Date
      isToday: boolean
      isTomorrow: boolean
    }>
    followups: Array<{
      id: string
      name: string
      phone: string | null
      profileImage: string | null
      type: 'followup'
      date: Date
      appointmentId: string
    }>
  }
  period?: 'day' | 'week' | 'month'
}

export function DashboardContent({
  stats,
  upcomingAppointments,
  recentReports,
  lowStockItems,
  birthdaysAndFollowups,
  overduePayments,
  period = 'month',
}: DashboardContentProps) {
  const navigate = useNavigate()
  const [searchParams, _setSearchParams] = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const handlePeriodChange = (newPeriod: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('period', newPeriod)
    startTransition(() => {
      navigate(`?${params.toString()}`)
    })
  }

  const getPeriodLabel = () => {
    switch (period) {
      case 'day':
        return 'Today'
      case 'week':
        return 'Last 7 days'
      default:
        return 'Last 30 days'
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your clinic&apos;s performance</p>
        </div>
        <Select value={period} onValueChange={handlePeriodChange} disabled={isPending}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Today</SelectItem>
            <SelectItem value="week">Last 7 Days</SelectItem>
            <SelectItem value="month">Last 30 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Patients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCompactNumber(stats.totalPatients)}</div>
            <p className="text-xs text-muted-foreground">{getPeriodLabel()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrencyCompact(stats.totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">{getPeriodLabel()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrencyCompact(stats.totalExpenses)}</div>
            <p className="text-xs text-muted-foreground">{getPeriodLabel()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Checked-in vs Booked</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.checkedIn} / {stats.booked}
            </div>
            <p className="text-xs text-muted-foreground">{getPeriodLabel()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Overdue Payments Card */}
      {overduePayments.length > 0 && <OverduePaymentsCard overduePayments={overduePayments} />}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Upcoming Appointments */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Upcoming Appointments
            </CardTitle>
            <CardDescription>
              Next {upcomingAppointments.length} scheduled appointments
            </CardDescription>
          </CardHeader>
          <CardContent>
            {upcomingAppointments.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No upcoming appointments
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingAppointments.map((appointment) => (
                  <Link
                    key={appointment.id}
                    to="/clinical"
                    className="flex items-center gap-4 rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={appointment.patient.profileImage || undefined} />
                      <AvatarFallback>{getInitials(appointment.patient.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">{appointment.patient.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Dr. {appointment.doctor.user.name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium">
                        {format(new Date(appointment.date), 'MMM dd')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(appointment.date), 'HH:mm')}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Reports */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Recent Reports
            </CardTitle>
            <CardDescription>Last {recentReports.length} daily reports submitted</CardDescription>
          </CardHeader>
          <CardContent>
            {recentReports.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No reports submitted yet
              </div>
            ) : (
              <div className="space-y-4">
                {recentReports.map((report) => (
                  <Link
                    key={report.id}
                    to={`/reports/${report.id}`}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        {format(new Date(report.reportDate), 'MMM dd, yyyy')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        By {report.submittedBy?.name || report.submittedBy?.email || 'Unknown'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-green-600">
                        {formatCurrency(report.totalPayments)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {report.checkedInCount} patients
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Low Stock Inventory */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Low Stock Alert
            </CardTitle>
            <CardDescription>Items that need restocking</CardDescription>
          </CardHeader>
          <CardContent>
            {lowStockItems.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                All items are well stocked
              </div>
            ) : (
              <div className="space-y-3">
                {lowStockItems.map((item) => (
                  <Link
                    key={item.id}
                    to={item.type === 'inventory' ? `/inventory/${item.id}` : `/products`}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{item.name}</p>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={item.stockQuantity === 0 ? 'destructive' : 'secondary'}
                          className="text-xs"
                        >
                          {item.type === 'inventory' ? 'Inventory' : 'Product'}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-sm font-semibold ${item.stockQuantity === 0 ? 'text-red-600' : 'text-orange-600'}`}
                      >
                        {item.stockQuantity} {item.unit || 'units'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Min: {item.reorderLevel ?? 'N/A'}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Birthdays and Follow-ups */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" />
              Birthdays & Follow-ups
            </CardTitle>
            <CardDescription>Upcoming birthdays and patients needing follow-up</CardDescription>
          </CardHeader>
          <CardContent>
            {birthdaysAndFollowups.birthdays.length === 0 &&
            birthdaysAndFollowups.followups.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No upcoming birthdays or follow-ups
              </div>
            ) : (
              <div className="space-y-3">
                {/* Birthdays */}
                {birthdaysAndFollowups.birthdays.slice(0, 5).map((patient) => (
                  <Link
                    key={`birthday-${patient.id}`}
                    to={`/patient-records/${patient.id}`}
                    className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={patient.profileImage || undefined} />
                      <AvatarFallback>{getInitials(patient.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">{patient.name}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          <Gift className="h-3 w-3 mr-1" />
                          Birthday
                        </Badge>
                        {patient.isToday && <Badge className="text-xs bg-pink-500">Today!</Badge>}
                        {patient.isTomorrow && (
                          <Badge className="text-xs bg-blue-500">Tomorrow</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(patient.date, 'MMM dd')}
                    </div>
                  </Link>
                ))}

                {/* Follow-ups */}
                {birthdaysAndFollowups.followups.slice(0, 5).map((patient) => (
                  <Link
                    key={`followup-${patient.appointmentId}`}
                    to={`/patient-records/${patient.id}`}
                    className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={patient.profileImage || undefined} />
                      <AvatarFallback>{getInitials(patient.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">{patient.name}</p>
                      <Badge variant="outline" className="text-xs">
                        <UserPlus className="h-3 w-3 mr-1" />
                        Follow-up
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(patient.date), { addSuffix: true })}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
