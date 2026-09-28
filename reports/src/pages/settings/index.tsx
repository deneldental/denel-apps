import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppointmentTypesSection } from '@/components/settings/appointment-types-section'
import { CategoriesSection } from '@/components/settings/categories-section'
import { DatabaseManagementSection } from '@/components/settings/database-management-section'
import { ExpenseCategoriesSection } from '@/components/settings/expense-categories-section'
import { GeneralSection } from '@/components/settings/general-section'
import { LowStockAlertSection } from '@/components/settings/low-stock-alert-section'
import { PaymentMethodsSection } from '@/components/settings/payment-methods-section'
import { PaymentPlanTemplatesSection } from '@/components/settings/payment-plan-templates-section'
import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { TreatmentTypesSection } from '@/components/settings/treatment-types-section'
import { UnitsSection } from '@/components/settings/units-section'
import { getUserRole } from '@/lib/actions/users'
import { getCurrentUser } from '@/lib/rbac'

const SECTION_TITLES: Record<string, string> = {
  general: 'General',
  'payment-plans': 'Payment Plan Templates',
  'appointment-types': 'Appointment Types',
  'treatment-types': 'Service Categories',
  'expense-categories': 'Expense Categories',
  'payment-methods': 'Payment Methods',
  units: 'Units',
  categories: 'Categories',
  'low-stock-alert': 'Low Stock Alert',
  database: 'Database Management',
}

export default function SettingsPage() {
  const [searchParams] = useSearchParams()
  const section = searchParams.get('section') || 'general'
  const title = SECTION_TITLES[section] ?? 'Settings'

  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadRole() {
      try {
        const currentUser = await getCurrentUser()
        if (currentUser) {
          const userRoleResult = await getUserRole(currentUser.id)
          const userRole =
            userRoleResult.success && 'data' in userRoleResult ? userRoleResult.data : null
          setIsAdmin(userRole === 'admin')
        }
      } catch (error) {
        console.error('Failed to load user role:', error)
      } finally {
        setLoading(false)
      }
    }
    loadRole()
  }, [])

  const renderContent = () => {
    switch (section) {
      case 'general':
        return <GeneralSection />
      case 'payment-plans':
        return <PaymentPlanTemplatesSection />
      case 'appointment-types':
        return isAdmin ? <AppointmentTypesSection /> : null
      case 'treatment-types':
        return isAdmin ? <TreatmentTypesSection /> : null
      case 'expense-categories':
        return isAdmin ? <ExpenseCategoriesSection /> : null
      case 'payment-methods':
        return isAdmin ? <PaymentMethodsSection /> : null
      case 'units':
        return isAdmin ? <UnitsSection /> : null
      case 'categories':
        return isAdmin ? <CategoriesSection /> : null
      case 'low-stock-alert':
        return isAdmin ? <LowStockAlertSection /> : null
      case 'database':
        return isAdmin ? <DatabaseManagementSection /> : null
      default:
        return <GeneralSection />
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 gap-0 overflow-hidden">
        <SettingsSidebar isAdmin={!!isAdmin} />
        <main className="min-w-0 flex-1 overflow-auto bg-muted/30">
          <div className="p-6">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {section === 'general'
                ? 'Manage your clinic profile and general preferences.'
                : `Manage ${title.toLowerCase()}.`}
            </p>
            <div className="mt-6">{renderContent()}</div>
          </div>
        </main>
      </div>
    </div>
  )
}
