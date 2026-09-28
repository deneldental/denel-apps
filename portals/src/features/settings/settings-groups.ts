import {
  Building2,
  Calendar,
  Coins,
  Database,
  FlaskConical,
  Layers,
  Lock,
  MessageSquare,
  Package,
  Plug,
  ScanLine,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react'

export interface SettingsGroup {
  id: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  /** Hidden from non-admins when every section in the group is admin-only. */
  adminOnly?: boolean
  /** Section ids in the order they appear as tabs (first one is the default). */
  sections: string[]
}

// Source of truth for the sidebar grouping AND the in-page tab strip. Each
// `section` id matches the slug used in `?section=...` URLs and the switch in
// `pages/detail.tsx` — keep them aligned.
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'system',
    label: 'Clinic Profile',
    description:
      'Clinic name, operating hours, contact and social; module visibility; and brand assets (logo, background images).',
    icon: Building2,
    // `clinic-profile` folds operating hours in; `brand-assets` is logos + login
    // images (no colour). `operating-hours` still has a detail.tsx case for
    // back-compat deep links but is no longer its own tab.
    sections: ['clinic-profile', 'module-visibility', 'brand-assets'],
  },
  {
    id: 'data',
    label: 'Data Management',
    description:
      'Export and import clinic configurations and lookups as JSON, plus database and CSV maintenance tools.',
    icon: Database,
    adminOnly: true,
    sections: ['data-management', 'database'],
  },
  {
    id: 'data-inject',
    label: 'Data Inject',
    description:
      'Seed and bulk-inject demo / migration data per domain — patient records, clinical, finance, reports, analytics.',
    icon: Layers,
    adminOnly: true,
    sections: ['data-inject-hub'],
  },
  {
    id: 'finance',
    label: 'Finance & Billing',
    description:
      'Taxes & statutory levies, payment methods, petty cash policies, expense categories, and ledger adjustments.',
    icon: Coins,
    adminOnly: true,
    sections: [
      'tax-config',
      'petty-cash-policy',
      'payment-methods',
      'app-payment-methods',
      'expense-categories',
      'ledger-adjustments',
    ],
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    description: 'Appointment types, reminder schedules, and alert sounds.',
    icon: Calendar,
    adminOnly: true,
    sections: ['appointment-types', 'appointment-reminders', 'alerts'],
  },
  {
    id: 'patients',
    label: 'Patients',
    description:
      'Customize tags and categorizations related to patient records and uploaded documents.',
    icon: Users,
    adminOnly: true,
    sections: ['patient-tags', 'document-tags'],
  },
  {
    id: 'clinical',
    label: 'Clinical & Charting',
    description:
      'Dental tooth notation systems, perio probing thresholds, clinical lookups, and drug presets.',
    icon: Stethoscope,
    adminOnly: true,
    sections: [
      'charting-preferences',
      'specialties',
      'examination-types',
      'presenting-complaints',
      'past-medical-history',
      'drug-history-items',
      'allergies',
      'social-history-items',
      'dental-review-items',
      'ortho-treatments',
      'drug-frequencies',
    ],
  },
  {
    id: 'imaging',
    label: 'Imaging',
    description: 'Manage imaging configurations and X-ray types.',
    icon: ScanLine,
    adminOnly: true,
    sections: ['xray-types'],
  },
  {
    id: 'lab',
    label: 'Lab',
    description: 'Configure lab workflows, prosthesis types, and external lab integrations.',
    icon: FlaskConical,
    adminOnly: true,
    sections: ['lab-workflow'],
  },
  {
    id: 'inventory',
    label: 'Inventory & Store',
    description:
      'Stock expiration alert lead times, valuation models, categories, units, locations, and low stock thresholds.',
    icon: Package,
    adminOnly: true,
    sections: [
      'inventory-policies',
      'categories',
      'units',
      'inventory-locations',
      'low-stock-alert',
      'monthly-threshold',
    ],
  },
  {
    id: 'crm',
    label: 'CRM & Messaging',
    description:
      'Automated 24h/2h appointment reminders, birthday greetings, recall schedules, SMS templates, and clinic holidays.',
    icon: MessageSquare,
    adminOnly: true,
    sections: ['crm-automations', 'sms-templates', 'crm-holidays'],
  },
  {
    id: 'security',
    label: 'Security & Kiosk',
    description: 'Patient check-in tablet idle timeout and audit log data retention.',
    icon: Lock,
    adminOnly: true,
    sections: ['security-kiosk'],
  },
  {
    id: 'compliance',
    label: 'Compliance & HR',
    description: 'Consent templates, compliance tags, and compliance categories.',
    icon: ShieldCheck,
    adminOnly: true,
    sections: ['consent-templates', 'compliance-tags', 'compliance-categories'],
  },
  {
    id: 'integrations',
    label: 'Integrations & APIs',
    description:
      'Hubtel SMS, Google Calendar sync, Cloud storage (R2/Spaces/Cloudinary), Upstash Redis, and public booking widgets.',
    icon: Plug,
    adminOnly: true,
    sections: ['integrations-hub'],
  },
]

/** Full title shown as the H1 when a section is rendered standalone. */
export const SECTION_TITLES: Record<string, string> = {
  'clinic-profile': 'Clinic Info',
  'brand-assets': 'Brand Assets',
  'module-visibility': 'Module Visibility',
  'operating-hours': 'Operating Hours',
  'data-management': 'Data Management',
  database: 'Database Management & CSV Tools',
  'data-inject-hub': 'Data Inject',
  'tax-config': 'Taxes & Statutory Levies',
  'petty-cash-policy': 'Petty Cash & Float Policies',
  'payment-methods': 'Payment Methods',
  'app-payment-methods': 'Patient App Payment Methods',
  'appointment-types': 'Appointment Types',
  'appointment-reminders': 'Appointment Reminders',
  'examination-types': 'Examination Types',
  'presenting-complaints': 'Presenting Complaints',
  'past-medical-history': 'Past Medical History',
  'drug-history-items': 'Drug History Items',
  allergies: 'Allergies',
  'social-history-items': 'Social History Items',
  'dental-review-items': 'Dental Review Items',
  'ortho-treatments': 'Ortho Treatments',
  'drug-frequencies': 'Drug Frequencies',
  'charting-preferences': 'Dental Notation & Charting Preferences',
  'expense-categories': 'Expense Categories',
  units: 'Units of Measurement',
  categories: 'Item Categories',
  'inventory-policies': 'Inventory & Store Operational Policies',
  'low-stock-alert': 'Low Stock Alert Threshold',
  alerts: 'Appointment & System Alerts',
  'monthly-threshold': 'Monthly Stock Threshold',
  'patient-tags': 'Patient Tags',
  'document-tags': 'Document Tags',
  specialties: 'Clinical Specialties',
  'inventory-locations': 'Storage Locations',
  'ledger-adjustments': 'Ledger Adjustments',
  'lab-workflow': 'Lab Workflow',
  'crm-automations': 'Automations & Reminder Templates',
  'sms-templates': 'SMS Templates & Placeholders',
  'crm-holidays': 'Public & Clinic Holidays',
  'security-kiosk': 'Kiosk & Audit Retention Policies',
  'consent-templates': 'Consent Form Templates',
  'compliance-tags': 'Compliance Tags',
  'compliance-categories': 'Compliance Categories',
  'integrations-hub': 'Integrations & External Services Hub',
  'xray-types': 'X-ray Types',
}

/** Short labels used by the in-group tab strip. Falls back to SECTION_TITLES. */
export const SECTION_TAB_LABELS: Record<string, string> = {
  'clinic-profile': 'Clinic Info',
  'brand-assets': 'Brand Assets',
  'operating-hours': 'Operating Hours',
  'module-visibility': 'Module Visibility',
  'data-management': 'Export / Import',
  database: 'Database Tools',
  'data-inject-hub': 'Data Inject',
  'tax-config': 'Taxes & Levies',
  'petty-cash-policy': 'Petty Cash',
  'payment-methods': 'Payment Methods',
  'app-payment-methods': 'App Payments',
  'expense-categories': 'Expense Categories',
  'ledger-adjustments': 'Ledger Adjustments',
  'appointment-types': 'Appointment Types',
  'appointment-reminders': 'Reminders',
  alerts: 'Sound & Alerts',
  'patient-tags': 'Patient Tags',
  'document-tags': 'Document Tags',
  'charting-preferences': 'Charting Preferences',
  'examination-types': 'Examinations',
  'presenting-complaints': 'Presenting',
  'past-medical-history': 'Past Medical',
  'drug-history-items': 'Drug History',
  'social-history-items': 'Social History',
  'dental-review-items': 'Dental Review',
  'ortho-treatments': 'Ortho',
  'drug-frequencies': 'Drug Frequencies',
  specialties: 'Specialties',
  'inventory-policies': 'Store Policies',
  categories: 'Categories',
  units: 'Units',
  'inventory-locations': 'Locations',
  'low-stock-alert': 'Low Stock',
  'monthly-threshold': 'Thresholds',
  'crm-automations': 'Automations',
  'sms-templates': 'SMS Templates',
  'crm-holidays': 'Holidays',
  'security-kiosk': 'Kiosk & Retention',
  'consent-templates': 'Consent Templates',
  'compliance-tags': 'Compliance Tags',
  'compliance-categories': 'Compliance Categories',
  'integrations-hub': 'Integrations Hub',
  'xray-types': 'X-ray Types',
  'lab-workflow': 'Lab Workflow',
}

/**
 * Sections `pages/detail.tsx` renders for a non-admin. Every other section
 * returns null for them, so the tab strip must not offer it and `?section=`
 * must not land on it (settings-domain-audit D8).
 */
export const NON_ADMIN_SECTIONS: ReadonlySet<string> = new Set([
  'clinic-profile',
  'brand-assets',
  'operating-hours',
])

export function sectionsVisibleTo(group: SettingsGroup, isAdmin: boolean): string[] {
  return isAdmin ? group.sections : group.sections.filter((s) => NON_ADMIN_SECTIONS.has(s))
}

export function tabLabelFor(sectionId: string): string {
  return SECTION_TAB_LABELS[sectionId] ?? SECTION_TITLES[sectionId] ?? sectionId
}

export function findGroupForSection(sectionId: string): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((g) => g.sections.includes(sectionId))
}

export function defaultSection(_isAdmin: boolean): string {
  // "Clinic Info" (which now contains operating hours) is the entry tab for
  // everyone; it isn't admin-gated.
  return 'clinic-profile'
}
