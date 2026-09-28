// FDI tooth numbering: 11-18, 21-28, 31-38, 41-48
export type ToothNumber =
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36
  | 37
  | 38
  | 41
  | 42
  | 43
  | 44
  | 45
  | 46
  | 47
  | 48

export type ToothSurface = 'O' | 'M' | 'D' | 'B' | 'L' | 'whole'

export type ToothCondition =
  | 'healthy'
  | 'caries'
  | 'filling'
  | 'crown'
  | 'root_canal'
  | 'extracted'
  | 'missing'
  | 'implant'
  | 'bridge_pontic'
  | 'bridge_abutment'
  | 'fractured'
  | 'sealant'

export interface OdontogramEntry {
  id: string
  patientId: string
  toothNumber: number
  surface: ToothSurface
  condition: ToothCondition
  notes: string | null
  recordedById: string | null
  recordedAt: string
  updatedAt: string
}

// ── FDI quadrant layout for rendering ────────────────────────────────────────
// Top row (upper jaw): Q1 (11-18) on patient's right side + Q2 (21-28) on left
// Bottom row (lower jaw): Q4 (41-48) on right + Q3 (31-38) on left
// From clinician's view, we show patient's right on the left side of the chart.
export const UPPER_TEETH: number[] = [
  18,
  17,
  16,
  15,
  14,
  13,
  12,
  11, // Q1 (patient right)
  21,
  22,
  23,
  24,
  25,
  26,
  27,
  28, // Q2 (patient left)
]
export const LOWER_TEETH: number[] = [
  48,
  47,
  46,
  45,
  44,
  43,
  42,
  41, // Q4
  31,
  32,
  33,
  34,
  35,
  36,
  37,
  38, // Q3
]

// ── Condition color map ──────────────────────────────────────────────────────
export const CONDITION_COLORS: Record<ToothCondition, string> = {
  healthy: '#e5e7eb', // gray-200
  caries: '#dc2626', // red-600
  filling: '#3b82f6', // blue-500
  crown: '#eab308', // yellow-500
  root_canal: '#a855f7', // purple-500
  extracted: '#1f2937', // gray-800
  missing: '#1f2937', // gray-800
  implant: '#10b981', // emerald-500
  bridge_pontic: '#f97316', // orange-500
  bridge_abutment: '#f97316', // orange-500
  fractured: '#dc2626', // red-600
  sealant: '#06b6d4', // cyan-500
}

export const CONDITION_LABELS: Record<ToothCondition, string> = {
  healthy: 'Healthy',
  caries: 'Caries',
  filling: 'Filling',
  crown: 'Crown',
  root_canal: 'Root Canal',
  extracted: 'Extracted',
  missing: 'Missing',
  implant: 'Implant',
  bridge_pontic: 'Bridge (Pontic)',
  bridge_abutment: 'Bridge (Abutment)',
  fractured: 'Fractured',
  sealant: 'Sealant',
}

export const SURFACE_LABELS: Record<ToothSurface, string> = {
  O: 'Occlusal',
  M: 'Mesial',
  D: 'Distal',
  B: 'Buccal / Facial',
  L: 'Lingual / Palatal',
  whole: 'Whole Tooth',
}

export const ALL_CONDITIONS: ToothCondition[] = [
  'healthy',
  'caries',
  'filling',
  'crown',
  'root_canal',
  'sealant',
  'extracted',
  'missing',
  'implant',
  'bridge_pontic',
  'bridge_abutment',
  'fractured',
]

export const ALL_SURFACES: ToothSurface[] = ['whole', 'O', 'M', 'D', 'B', 'L']

// ── Tooth classification by FDI position ─────────────────────────────────────
// Position (the second digit of an FDI number) determines anatomical type:
//   1, 2 → central / lateral incisor (narrow, flat incisal edge)
//   3    → canine (narrow, pointed cusp)
//   4, 5 → first / second premolar (two cusps)
//   6-8  → first / second / third molar (four cusps, widest crown)
export type ToothKind = 'incisor' | 'canine' | 'premolar' | 'molar'

export function classifyTooth(toothNumber: number): ToothKind {
  const position = toothNumber % 10
  if (position === 1 || position === 2) return 'incisor'
  if (position === 3) return 'canine'
  if (position === 4 || position === 5) return 'premolar'
  return 'molar'
}
