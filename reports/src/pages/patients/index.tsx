import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PatientList } from '@/components/patients/patient-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getPatients } from '@/lib/actions/patients'

export default function PatientsPage() {
  const [loading, setLoading] = useState(true)
  const [patients, setPatients] = useState<any[]>([])

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const result = await getPatients()
        if (result.success) {
          setPatients(result.data)
        } else {
          console.error(result.error)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const generalPatients = patients.filter((p) => p.type === 'general' && !p.isOrtho)
  const legacyPatients = patients.filter((p) => p.type === 'legacy')
  const orthoPatients = patients.filter((p) => p.isOrtho === true)
  const externalPatients = patients.filter((p) => p.type === 'external')

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Patients</h1>
          <p className="text-muted-foreground">View patient records and information.</p>
        </div>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="ortho">Ortho</TabsTrigger>
          <TabsTrigger value="legacy">Legacy Import</TabsTrigger>
          <TabsTrigger value="external">External</TabsTrigger>
          <TabsTrigger value="all">All Patients</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <PatientList data={generalPatients} />
        </TabsContent>
        <TabsContent value="ortho">
          <PatientList data={orthoPatients} />
        </TabsContent>
        <TabsContent value="legacy">
          <PatientList data={legacyPatients} />
        </TabsContent>
        <TabsContent value="external">
          <PatientList data={externalPatients} />
        </TabsContent>
        <TabsContent value="all">
          <PatientList data={patients} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
