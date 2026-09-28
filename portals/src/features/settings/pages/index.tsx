import { Link } from 'react-router-dom'
import { SETTINGS_GROUPS } from '@/features/settings/settings-groups'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { usePermissions } from '@/shared/hooks/use-permissions'

export default function SettingsHubPage() {
  const { isAdmin, isLoading } = usePermissions()

  if (isLoading) {
    return null
  }

  // Filter out admin-only groups for non-admins
  const visibleGroups = SETTINGS_GROUPS.filter((group) => !(group.adminOnly && !isAdmin))

  return (
    <div className="flex h-full flex-col">
      <main className="min-w-0 flex-1 overflow-y-auto bg-muted/30">
        <div className="p-6 space-y-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your clinic's general configurations, taxonomies, and operational rules.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleGroups.map((group) => {
              const Icon = group.icon
              return (
                <Card
                  key={group.id}
                  className="hover:border-primary/50 transition-colors h-full flex flex-col"
                >
                  <CardContent className="p-6 space-y-3 flex-1 flex flex-col justify-center">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm truncate">{group.label}</h3>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {group.description}
                    </p>
                    <div className="flex items-center gap-2 pt-2">
                      <Button size="sm" variant="outline" asChild className="flex-1">
                        <Link to={`/settings/${group.id}`}>Configure</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
