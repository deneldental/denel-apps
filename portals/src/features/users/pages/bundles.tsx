import { BundlesSection } from '@/features/users/components/bundles-section'

export default function BundlesPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Permission Bundles</h1>
        <p className="mt-1 text-muted-foreground">
          Bundles group related permissions. Compose roles from one or more bundles.
        </p>
      </div>
      <BundlesSection />
    </div>
  )
}
