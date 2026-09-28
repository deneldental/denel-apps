import { ComingSoon } from '@/shared/components/coming-soon'

export default function ConsentSurgicalPage() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <ComingSoon
        title="Surgical Consents"
        description="Manage consent forms for surgical extractions and other clinical procedures. Patients sign these before any surgical treatment is carried out."
      />
    </div>
  )
}
