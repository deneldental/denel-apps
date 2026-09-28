import { RolesSection } from '@/features/users/components/roles-section'

export default function RolesPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Roles</h1>
        <p className="mt-1 text-muted-foreground">
          Define roles and compose them from permission bundles.
        </p>
      </div>
      <RolesSection />
    </div>
  )
}
