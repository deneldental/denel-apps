import {
  ArrowLeftRight,
  BarChart,
  BarChart2,
  BookMarked,
  Calendar,
  ClipboardList,
  CreditCard,
  DollarSign,
  FileText,
  Home,
  MessageSquare,
  Package,
  Receipt,
  ScrollText,
  Settings,
  ShoppingBag,
  Users,
  Users2,
} from 'lucide-react'
import { MODULES } from '@/lib/modules'
export type MenuItem = {
  module?: string
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  isChild?: boolean
  children?: MenuItem[]
}

export type MenuConfig = {
  [key: string]: MenuItem[]
}

// Icon name to component mapping for dynamic menu generation
export const ICON_MAP: Record<string, any> = {
  Home,
  Users,
  Users2,
  Calendar,
  ClipboardList,
  FileText,
  Package,
  ShoppingBag,
  CreditCard,
  Receipt,
  MessageSquare,
  BarChart,
  BarChart2,
  ScrollText,
  Settings,
  DollarSign,
  BookMarked,
  ArrowLeftRight,
}

// Static menu items that are always shown (Dashboard, Settings)
export const STATIC_MENU_ITEMS = {
  dashboard: { module: MODULES.DASHBOARD, label: 'Dashboard', href: '/dashboard', icon: Home },
  settings: { module: MODULES.SETTINGS, label: 'Settings', href: '/settings', icon: Settings },
  financialRecords: {
    module: MODULES.FINANCIAL_RECORDS,
    label: 'Financial Records',
    href: '/financial-records',
    icon: DollarSign,
  },
  ledgerAdjustments: {
    module: MODULES.LEDGER_ADJUSTMENTS,
    label: 'Ledger Adjustments',
    href: '/ledger-adjustments',
    icon: BookMarked,
  },
}

// Legacy static menu config (fallback when permissions API is unavailable)
export const menuConfig: Record<string, MenuItem[]> = {
  admin: [
    STATIC_MENU_ITEMS.dashboard,
    { module: MODULES.PATIENTS, label: 'Patients', href: '/patients', icon: Users },
    { module: MODULES.APPOINTMENTS, label: 'Appointments', href: '/appointments', icon: Calendar },
    {
      module: MODULES.MEDICAL_RECORDS,
      label: 'Medical Records',
      href: '/medical-records',
      icon: ClipboardList,
      isChild: true,
    },
    {
      module: MODULES.ORTHO_CONSENT,
      label: 'Ortho Consent',
      href: '/ortho-consent',
      icon: FileText,
      isChild: true,
    },
    { module: MODULES.INVENTORY, label: 'Inventory', href: '/inventory', icon: Package },
    {
      module: MODULES.PRODUCTS,
      label: 'Products',
      href: '/products',
      icon: ShoppingBag,
      isChild: true,
    },
    { module: MODULES.PAYMENTS, label: 'Payments', href: '/payments', icon: CreditCard },
    { module: MODULES.EXPENSES, label: 'Expenses', href: '/expenses', icon: Receipt },
    { module: MODULES.MESSAGING, label: 'Messaging', href: '/messaging', icon: MessageSquare },
    { module: MODULES.STAFF, label: 'Staff', href: '/staff', icon: Users2 },
    { module: MODULES.USERS, label: 'Users', href: '/users', icon: Users },
    { module: MODULES.REPORTS, label: 'Reports', href: '/reports', icon: BarChart },
    { module: MODULES.ANALYTICS, label: 'Analytics', href: '/analytics', icon: BarChart2 },
    {
      module: MODULES.FINANCIAL_RECORDS,
      label: 'Financial Records',
      href: '/financial-records',
      icon: DollarSign,
    },
    {
      module: MODULES.LEDGER_ADJUSTMENTS,
      label: 'Ledger Adjustments',
      href: '/ledger-adjustments',
      icon: BookMarked,
    },
    // NOTE: MODULES.DATA_SYNC resolves to the slug 'sync', not 'data_sync',
    // so the literal is kept here to preserve the existing module value.
    { module: 'data_sync', label: 'Data Sync', href: '/data-sync', icon: ArrowLeftRight },
    { module: MODULES.AUDIT_LOGS, label: 'Audit Logs', href: '/audit-logs', icon: ScrollText },
    STATIC_MENU_ITEMS.settings,
  ],
  doctor: [
    STATIC_MENU_ITEMS.dashboard,
    { module: MODULES.PATIENTS, label: 'Patients', href: '/patients', icon: Users },
    { module: MODULES.APPOINTMENTS, label: 'Appointments', href: '/appointments', icon: Calendar },
    {
      module: MODULES.MEDICAL_RECORDS,
      label: 'Medical Records',
      href: '/medical-records',
      icon: ClipboardList,
    },
    {
      module: MODULES.ORTHO_CONSENT,
      label: 'Ortho Consent',
      href: '/ortho-consent',
      icon: FileText,
    },
  ],
  receptionist: [
    STATIC_MENU_ITEMS.dashboard,
    { module: MODULES.PATIENTS, label: 'Patients', href: '/patients', icon: Users },
    { module: MODULES.APPOINTMENTS, label: 'Appointments', href: '/appointments', icon: Calendar },
    {
      module: MODULES.ORTHO_CONSENT,
      label: 'Ortho Consent',
      href: '/ortho-consent',
      icon: FileText,
    },
    { module: MODULES.PRODUCTS, label: 'Products', href: '/products', icon: ShoppingBag },
    { module: MODULES.INVENTORY, label: 'Inventory', href: '/inventory', icon: Package },
    { module: MODULES.EXPENSES, label: 'Expenses', href: '/expenses', icon: Receipt },
    { module: MODULES.PAYMENTS, label: 'Payments', href: '/payments', icon: CreditCard },
    { module: MODULES.MESSAGING, label: 'Messaging', href: '/messaging', icon: MessageSquare },
    { module: MODULES.REPORTS, label: 'Reports', href: '/reports', icon: BarChart },
  ],
}

// Dynamic menu item type from API
export type DynamicMenuItem = {
  module: string
  label: string
  href: string
  iconName: string
  isChild?: boolean
  children?: DynamicMenuItem[]
}

// Convert hierarchical dynamic menu items from API to MenuItem format with icons (preserves children)
export function buildDynamicMenu(
  dynamicItems: DynamicMenuItem[],
  isAdmin: boolean = false
): MenuItem[] {
  // Convert dynamic items into flat top-level menu items. Any child
  // modules are surfaced as separate top-level entries (no nested rendering).
  const toMenuItem = (it: DynamicMenuItem): MenuItem => {
    const icon = ICON_MAP[it.iconName] || FileText
    return {
      module: it.module,
      label: it.label,
      href: it.href,
      icon,
      isChild: false,
    }
  }

  const items: MenuItem[] = [STATIC_MENU_ITEMS.dashboard]

  for (const it of dynamicItems) {
    // Add the parent/module itself as a top-level item if not already present
    if (!items.some((existing) => existing.module === it.module)) {
      items.push(toMenuItem(it))
    }

    // If the API returned children, add them as separate top-level items
    if (it.children && it.children.length > 0) {
      for (const child of it.children) {
        if (!items.some((existing) => existing.module === child.module)) {
          items.push(toMenuItem(child))
        }
      }
    }
  }

  if (isAdmin) {
    if (!items.some((i) => i.module === STATIC_MENU_ITEMS.financialRecords.module)) {
      items.push(STATIC_MENU_ITEMS.financialRecords)
    }
    if (!items.some((i) => i.module === STATIC_MENU_ITEMS.ledgerAdjustments.module)) {
      items.push(STATIC_MENU_ITEMS.ledgerAdjustments)
    }
    // Settings is admin-only in the dynamic menu
    if (!items.some((i) => i.module === STATIC_MENU_ITEMS.settings.module)) {
      items.push(STATIC_MENU_ITEMS.settings)
    }
  }

  return items
}

export function getMenuItemsForRole(roleId: string | null | undefined): MenuItem[] {
  if (!roleId) return menuConfig.receptionist
  return menuConfig[roleId] || menuConfig.receptionist
}
