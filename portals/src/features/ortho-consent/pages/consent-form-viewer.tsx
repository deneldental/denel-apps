import { format } from 'date-fns'
import { ArrowLeft, Calendar, Download, FileText, Upload, User } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadConsentDialog } from '@/features/ortho-consent/components/upload-consent-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { useStableFileUrl } from '@/shared/hooks/use-stable-file-url'

type ConsentForm = {
  id: string
  patientId: string | null
  name: string
  phone: string | null
  email: string | null
  profileImage: string | null
  consentFormId: string | null
  consentFormUrl: string | null
  status: string
  uploadedAt: Date | null
  notes: string | null
  createdAt: Date
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function ConsentFormViewer({
  consentForm,
  onReload,
}: {
  consentForm: ConsentForm
  onReload: () => void
}) {
  const navigate = useNavigate()
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  // The preview keeps its first link while the same PDF is re-signed, so it does
  // not reload (back to page 1) on a refetch; "View" opens the freshest link.
  const previewUrl = useStableFileUrl(consentForm.consentFormUrl)

  const handleBack = () => {
    navigate('/ortho-consent')
  }

  const handleUpload = () => {
    setUploadDialogOpen(true)
  }

  const handleSuccess = () => {
    onReload()
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={handleBack} aria-label="Go back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Ortho Consent Form</h1>
          <p className="text-muted-foreground">View and manage patient consent form</p>
        </div>
      </div>

      {/* Patient Information Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Patient Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-6">
            <Avatar className="h-20 w-20">
              <AvatarImage src={consentForm.profileImage || undefined} />
              <AvatarFallback className="text-2xl">{getInitials(consentForm.name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="text-2xl font-semibold">{consentForm.name}</h3>
                <p className="text-sm text-muted-foreground font-mono">
                  {consentForm.patientId || 'No ID'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {consentForm.phone && (
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="text-sm font-medium">{consentForm.phone}</p>
                  </div>
                )}
                {consentForm.email && (
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm font-medium">{consentForm.email}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Consent Form Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Consent Form Status
            </CardTitle>
            <Badge
              variant={consentForm.status === 'signed' ? 'default' : 'secondary'}
              className={consentForm.status === 'signed' ? 'bg-green-500' : ''}
            >
              {consentForm.status === 'signed' ? 'Signed' : 'Unsigned'}
            </Badge>
          </div>
          {consentForm.uploadedAt && (
            <CardDescription className="flex items-center gap-2 mt-2">
              <Calendar className="h-4 w-4" />
              Uploaded on {format(new Date(consentForm.uploadedAt), "MMMM dd, yyyy 'at' HH:mm")}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {consentForm.notes && (
            <div className="rounded-lg bg-muted p-4">
              <p className="text-sm font-medium mb-2">Notes:</p>
              <p className="text-sm text-muted-foreground">{consentForm.notes}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            {consentForm.status === 'signed' && consentForm.consentFormUrl ? (
              <Button
                onClick={() => window.open(consentForm.consentFormUrl!, '_blank')}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                View/Download Consent Form
              </Button>
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center w-full">
                <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Consent Form Uploaded</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This patient has not submitted their ortho consent form yet. Download the
                  template, have pages 1 and 5 filled and signed, then scan and upload both pages as
                  a 2-page PDF.
                </p>
                <div className="flex gap-2 justify-center">
                  <Button onClick={handleUpload} className="gap-2">
                    <Upload className="h-4 w-4" />
                    Upload Consent Form
                  </Button>
                </div>
              </div>
            )}
            {consentForm.status === 'signed' && (
              <Button variant="outline" onClick={handleUpload} className="gap-2">
                <Upload className="h-4 w-4" />
                Replace Form
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PDF Viewer (if form exists) */}
      {consentForm.status === 'signed' && consentForm.consentFormUrl && (
        <Card>
          <CardHeader>
            <CardTitle>Consent Form Preview</CardTitle>
            <CardDescription>
              View the uploaded consent form directly in your browser
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="w-full h-[800px] border rounded-lg overflow-hidden bg-gray-50">
              <iframe
                src={previewUrl ?? undefined}
                className="w-full h-full"
                title="Consent Form"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <UploadConsentDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        patient={{
          id: consentForm.id,
          name: consentForm.name,
          patientId: consentForm.patientId,
        }}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
