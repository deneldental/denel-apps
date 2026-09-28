import { useState } from 'react'
import { DataTable } from '@/components/data-table/data-table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type AppointmentData, columns } from '@/src/pages/appointments/columns'
import { AppointmentDetailDialog } from './appointment-detail-dialog'

export function AppointmentList({ data }: { data: AppointmentData[] }) {
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentData | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const handleRowClick = (appointment: AppointmentData) => {
    setSelectedAppointment(appointment)
    setIsDialogOpen(true)
  }

  const prepareData = (appointments: AppointmentData[]) => {
    return appointments.map((a) => ({
      ...a,
      onRowClick: () => handleRowClick(a),
    }))
  }

  const pending = data.filter((a) => a.status === 'scheduled')
  const rescheduled = data.filter((a) => a.status === 'rescheduled')
  const cancelled = data.filter((a) => a.status === 'cancelled')
  const completed = data.filter((a) => a.status === 'completed')

  return (
    <>
      <Tabs defaultValue="pending" className="w-full">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="rescheduled">Rescheduled ({rescheduled.length})</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled ({cancelled.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completed.length})</TabsTrigger>
          <TabsTrigger value="all">All ({data.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4">
          <DataTable columns={columns} data={prepareData(pending)} />
        </TabsContent>
        <TabsContent value="rescheduled" className="mt-4">
          <DataTable columns={columns} data={prepareData(rescheduled)} />
        </TabsContent>
        <TabsContent value="cancelled" className="mt-4">
          <DataTable columns={columns} data={prepareData(cancelled)} />
        </TabsContent>
        <TabsContent value="completed" className="mt-4">
          <DataTable columns={columns} data={prepareData(completed)} />
        </TabsContent>
        <TabsContent value="all" className="mt-4">
          <DataTable columns={columns} data={prepareData(data)} />
        </TabsContent>
      </Tabs>
      <AppointmentDetailDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        appointment={selectedAppointment}
      />
    </>
  )
}
