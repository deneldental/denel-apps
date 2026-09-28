import { CheckCircle2, PenLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { SignaturePad } from '@/shared/components/ui/signature-pad'

interface ConsentTemplate {
  id: string
  name: string
  active: boolean
}

interface Patient {
  id: string
  name: string
}

export default function ConsentSignPage() {
  const [searchParams] = useSearchParams()
  // Pre-fill from the Pending Consents "Collect" deep-link (?patientId&templateId).
  const [templates, setTemplates] = useState<ConsentTemplate[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientId, setPatientId] = useState(searchParams.get('patientId') ?? '')
  const [templateId, setTemplateId] = useState(searchParams.get('templateId') ?? '')
  const [signatureData, setSignatureData] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    Promise.all([
      apiClient<ConsentTemplate[]>('/api/consent-forms/templates'),
      apiClient<Patient[]>('/api/patients'),
    ]).then(([tRes, pRes]) => {
      if (tRes.success && tRes.data) {
        setTemplates(tRes.data.filter((t) => t.active))
      }
      if (pRes.success && pRes.data) {
        setPatients(pRes.data)
      }
    })
  }, [])

  async function handleSubmit() {
    if (!patientId || !templateId) {
      toast.error('Select patient and template.')
      return
    }
    if (!signatureData) {
      toast.error('Please sign before submitting.')
      return
    }
    setSubmitting(true)
    try {
      const res = await apiClient('/api/consent-forms/signed', {
        method: 'POST',
        body: JSON.stringify({
          templateId,
          patientId,
          signatureData,
          signedByName: patients.find((p) => p.id === patientId)?.name ?? 'Patient',
        }),
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.success) {
        toast.error((res as { error?: string }).error ?? 'Failed to submit consent.')
        return
      }
      toast.success('Consent signed and recorded.')
      setPatientId('')
      setTemplateId('')
      setSignatureData('')
    } catch {
      toast.error('Failed to submit consent.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <PenLine className="h-7 w-7" />
          In-Clinic Sign
        </h1>
        <p className="text-muted-foreground mt-1">
          Have a patient sign a consent form directly on the touchscreen.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Capture Consent Signature</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Patient</Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger>
                <SelectValue placeholder="Select patient" />
              </SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Consent Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Patient Signature</Label>
            <SignaturePad onChange={(v) => setSignatureData(v || '')} />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting || !patientId || !templateId || !signatureData}
            className="w-full gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            {submitting ? 'Submitting…' : 'Submit Consent'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
