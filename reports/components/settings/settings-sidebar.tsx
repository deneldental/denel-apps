import {
  Calendar,
  CreditCard,
  Database,
  LayoutDashboard,
  Package,
  PanelLeft,
  PanelLeftClose,
  Receipt,
  Ruler,
  Stethoscope,
  Tags,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SidebarItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
}

const sidebarItems: SidebarItem[] = [
  { id: 'general', label: 'General', icon: LayoutDashboard },
  { id: 'payment-plans', label: 'Payment Plan Templates', icon: CreditCard },
  { id: 'appointment-types', label: 'Appointment Types', icon: Calendar, adminOnly: true },
  { id: 'treatment-types', label: 'Service Categories', icon: Stethoscope, adminOnly: true },
  { id: 'expense-categories', label: 'Expense Categories', icon: Receipt, adminOnly: true },
  { id: 'payment-methods', label: 'Payment Methods', icon: Wallet, adminOnly: true },
  { id: 'units', label: 'Units', icon: Ruler, adminOnly: true },
  { id: 'categories', label: 'Categories', icon: Tags, adminOnly: true },
  { id: 'low-stock-alert', label: 'Low Stock Alert', icon: Package, adminOnly: true },
  { id: 'database', label: 'Database Management', icon: Database, adminOnly: true },
]

interface SettingsSidebarProps {
  isAdmin: boolean
}

export function SettingsSidebar({ isAdmin }: SettingsSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [searchParams] = useSearchParams()
  const activeSection = searchParams.get('section') || 'general'

  const visibleItems = sidebarItems.filter((item) => !item.adminOnly || isAdmin)

  return (
    <nav
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-14' : 'w-56'
      )}
    >
      <div className="flex flex-col p-2">
        <div
          className={cn(
            'mb-2 flex items-center gap-3 rounded-lg px-2',
            collapsed ? 'justify-center' : 'justify-between'
          )}
        >
          {!collapsed && (
            <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Settings
            </h2>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed((c) => !c)}
            className="h-8 w-8 shrink-0"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
        <ul className="space-y-0.5">
          {visibleItems.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.id
            return (
              <li key={item.id}>
                <Link
                  to={`/settings?section=${item.id}`}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm font-medium transition-colors',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
