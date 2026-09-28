import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PendingRecordsList } from '@/features/medical-records/components/pending-records-list'
import { DataTable } from '@/shared/components/data-table/data-table'
import { Badge } from '@/shared/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { getColumns, type MedicalRecordData as MedicalRecord } from './columns'

interface PendingRecord {
  id: string
  patientId: string
  doctorId: string
  checkedInAt: Date | string
  status: string
  [key: string]: unknown
}

interface MedicalRecordsClientProps {
  records: MedicalRecord[]
  pendingRecords: PendingRecord[]
  currentDoctorId?: string
  currentDoctorName?: string
  userRole?: string | null
  isDoctor?: boolean
  onReload: () => void
}

export function MedicalRecordsClient({
  records,
  pendingRecords,
  currentDoctorId,
  currentDoctorName,
  userRole,
  isDoctor,
  onReload,
}: MedicalRecordsClientProps) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(isDoctor ? 'pending' : 'all')

  const handleRowClick = (record: MedicalRecord) => {
    navigate(`/medical-records/${record.id}`)
  }

  // Add onRowClick handler to each record for row click functionality
  const recordsWithClick = records.map((record) => ({
    ...record,
    onRowClick: () => handleRowClick(record),
  }))

  // If not a doctor, show the original layout without tabs
  if (!isDoctor) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Medical Records</h1>
            <p className="text-muted-foreground">View and manage patient medical history.</p>
          </div>
        </div>

        <DataTable
          columns={getColumns(onReload)}
          data={recordsWithClick}
          meta={{
            onRowClick: handleRowClick,
            userRole: userRole,
          }}
        />
      </div>
    )
  }

  // Doctor view with tabs
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Medical Records</h1>
          <p className="text-muted-foreground">View and manage patient medical history.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="pending" className="relative">
            Pending Records
            {pendingRecords.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {pendingRecords.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All Records</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-6">
          <PendingRecordsList
            pendingRecords={pendingRecords}
            currentDoctorId={currentDoctorId}
            currentDoctorName={currentDoctorName}
          />
        </TabsContent>

        <TabsContent value="all" className="mt-6">
          <DataTable
            columns={getColumns(onReload)}
            data={recordsWithClick}
            meta={{
              onRowClick: handleRowClick,
              userRole: userRole,
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
