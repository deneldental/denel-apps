/**
 * UI-only mock data for the Insurance Summary page (M6 redesign).
 *
 * These figures are NOT persisted — they exist purely so the new summary page
 * has realistic content to render while the backend aggregate endpoints are
 * still being designed. Replace each `MOCK_*` import with a real fetch when
 * the API is ready (see project-docs/ui-refinement-IP.md M6).
 */

export interface MockMonthlyPoint {
  /** Short month label, e.g. 'Nov', 'Dec', 'Jan'. */
  month: string
  /** Amount the clinic billed the insurer that month (GHS). */
  claimed: number
  /** Amount the insurer settled that month (GHS). */
  received: number
}

export interface MockInsuranceCompanySummary {
  companyId: string
  companyName: string
  /** Distinct patients with at least one claim in the trailing 6 months. */
  patientCount: number
  /** Trailing 6-month total billed (GHS). */
  totalClaimed: number
  /** Trailing 6-month total settled (GHS). */
  totalReceived: number
  /** Outstanding (claimed minus received) — sticks across reporting periods. */
  totalPending: number
  /** Last 6 months ordered oldest -> newest. */
  monthly: MockMonthlyPoint[]
}

export const MOCK_INSURANCE_SUMMARY: MockInsuranceCompanySummary[] = [
  {
    companyId: 'mock-co-nationwide',
    companyName: 'Nationwide Medical',
    patientCount: 184,
    totalClaimed: 412_500,
    totalReceived: 318_700,
    totalPending: 93_800,
    monthly: [
      { month: 'Nov', claimed: 58_200, received: 47_300 },
      { month: 'Dec', claimed: 71_400, received: 55_900 },
      { month: 'Jan', claimed: 64_100, received: 51_200 },
      { month: 'Feb', claimed: 69_800, received: 58_400 },
      { month: 'Mar', claimed: 76_500, received: 60_100 },
      { month: 'Apr', claimed: 72_500, received: 45_800 },
    ],
  },
  {
    companyId: 'mock-co-acacia',
    companyName: 'Acacia Health',
    patientCount: 96,
    totalClaimed: 218_400,
    totalReceived: 196_300,
    totalPending: 22_100,
    monthly: [
      { month: 'Nov', claimed: 31_200, received: 29_400 },
      { month: 'Dec', claimed: 36_800, received: 35_100 },
      { month: 'Jan', claimed: 33_400, received: 32_800 },
      { month: 'Feb', claimed: 38_100, received: 36_700 },
      { month: 'Mar', claimed: 41_500, received: 37_200 },
      { month: 'Apr', claimed: 37_400, received: 25_100 },
    ],
  },
  {
    companyId: 'mock-co-glico',
    companyName: 'Glico Healthcare',
    patientCount: 247,
    totalClaimed: 538_900,
    totalReceived: 401_600,
    totalPending: 137_300,
    monthly: [
      { month: 'Nov', claimed: 78_400, received: 64_500 },
      { month: 'Dec', claimed: 92_700, received: 71_300 },
      { month: 'Jan', claimed: 84_300, received: 65_900 },
      { month: 'Feb', claimed: 89_800, received: 70_400 },
      { month: 'Mar', claimed: 96_200, received: 74_500 },
      { month: 'Apr', claimed: 97_500, received: 55_000 },
    ],
  },
  {
    companyId: 'mock-co-vitality',
    companyName: 'Vitality Insurance',
    patientCount: 41,
    totalClaimed: 87_300,
    totalReceived: 71_200,
    totalPending: 16_100,
    monthly: [
      { month: 'Nov', claimed: 12_400, received: 11_300 },
      { month: 'Dec', claimed: 14_900, received: 12_800 },
      { month: 'Jan', claimed: 13_200, received: 11_900 },
      { month: 'Feb', claimed: 15_400, received: 13_400 },
      { month: 'Mar', claimed: 16_100, received: 13_500 },
      { month: 'Apr', claimed: 15_300, received: 8_300 },
    ],
  },
]

/**
 * Lightweight mock company list — used by the M5.4 payment-acceptance flow's
 * insurance sub-section and any UI surface that needs a company picker without
 * waiting on `/api/insurance/companies`.
 *
 * Keep IDs aligned with `MOCK_INSURANCE_SUMMARY[].companyId` so cross-references
 * (e.g. picker -> summary card) work without an extra lookup table.
 */
export interface MockInsuranceCompanyOption {
  id: string
  name: string
}

export const MOCK_INSURANCE_COMPANY_OPTIONS: MockInsuranceCompanyOption[] =
  MOCK_INSURANCE_SUMMARY.map((s) => ({ id: s.companyId, name: s.companyName }))
