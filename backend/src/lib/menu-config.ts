import { MODULES } from '@denel/rbac'

// Backend-only: maps module IDs to their sidebar label, href, and icon name.
// This payload is sent to the frontend via /api/auth/permissions so the portal
// can render the nav without hardcoding menu structure in the SPA.
export type MenuItemConfig = {
  label: string
  href: string
  iconName: string
  isChild?: boolean
}

export const MODULE_MENU_CONFIG: Record<string, MenuItemConfig> = {
  [MODULES.DASHBOARD]: { label: 'Dashboard', href: '/dashboard', iconName: 'Home' },
  [MODULES.PATIENTS]: { label: 'Patients', href: '/patients', iconName: 'Users' },
  [MODULES.APPOINTMENTS]: { label: 'Appointments', href: '/appointments', iconName: 'Calendar' },
  [MODULES.MEDICAL_RECORDS]: {
    label: 'Medical Records',
    href: '/medical-records',
    iconName: 'ClipboardList',
    isChild: true,
  },
  [MODULES.ORTHO_CONSENT]: {
    label: 'Ortho Consent',
    href: '/ortho-consent',
    iconName: 'FileText',
    isChild: true,
  },
  [MODULES.INVENTORY]: { label: 'Inventory', href: '/inventory', iconName: 'Package' },
  [MODULES.PRODUCTS]: {
    label: 'Products',
    href: '/products',
    iconName: 'ShoppingBag',
    isChild: true,
  },
  [MODULES.PAYMENTS]: { label: 'Payments', href: '/payments', iconName: 'CreditCard' },
  [MODULES.EXPENSES]: { label: 'Expenses', href: '/expenses', iconName: 'Receipt' },
  [MODULES.FINANCIAL_RECORDS]: {
    label: 'Financial Records',
    href: '/financial-records',
    iconName: 'DollarSign',
  },
  [MODULES.LEDGER_ADJUSTMENTS]: {
    label: 'Ledger Adjustments',
    href: '/ledger-adjustments',
    iconName: 'BookMarked',
  },
  [MODULES.MESSAGING]: { label: 'Messaging', href: '/messaging', iconName: 'MessageSquare' },
  [MODULES.STAFF]: { label: 'Staff', href: '/staff', iconName: 'Users2' },
  [MODULES.STAFF_REQUESTS]: {
    label: 'Staff Requests',
    href: '/staff/requests',
    iconName: 'FileText',
    isChild: true,
  },
  [MODULES.STAFF_TRAINING]: {
    label: 'Training',
    href: '/staff/training',
    iconName: 'GraduationCap',
    isChild: true,
  },
  [MODULES.STAFF_PERFORMANCE]: {
    label: 'Performance',
    href: '/staff/performance',
    iconName: 'TrendingUp',
    isChild: true,
  },
  [MODULES.USERS]: { label: 'Users', href: '/users', iconName: 'UserCog', isChild: true },
  [MODULES.REPORTS]: { label: 'Reports', href: '/reports', iconName: 'BarChart' },
  [MODULES.SETTINGS]: { label: 'Settings', href: '/settings', iconName: 'Settings' },
  [MODULES.DATA_SYNC]: {
    label: 'Data Sync',
    href: '/data-sync',
    iconName: 'ArrowLeftRight',
    isChild: true,
  },
  [MODULES.AUDIT_LOGS]: {
    label: 'Audit Logs',
    href: '/audit-logs',
    iconName: 'ScrollText',
    isChild: true,
  },
}

export const MENU_ORDER: string[] = [
  MODULES.DASHBOARD,
  MODULES.PATIENTS,
  MODULES.APPOINTMENTS,
  MODULES.INVENTORY,
  MODULES.PAYMENTS,
  MODULES.EXPENSES,
  MODULES.FINANCIAL_RECORDS,
  MODULES.LEDGER_ADJUSTMENTS,
  MODULES.MESSAGING,
  MODULES.STAFF,
  MODULES.REPORTS,
  MODULES.SETTINGS,
]
