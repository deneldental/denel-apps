/**
 * attendance-pdf.ts — render a printable per-staff attendance record.
 *
 * Produces an A4 portrait PDF. Each week is its own block with a header
 * (label + summary chips) and a 6-column day table. Pages overflow naturally;
 * when a week won't fit on the current page we start a fresh page.
 */

import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib'

export interface AttendanceDayRow {
  date: string // YYYY-MM-DD
  dayOfWeek: number
  clockIn: string | null // HH:MM
  clockOut: string | null
  status: string // 'present' | 'late' | 'absent' | 'excused' | 'off' | 'holiday'
  dailyScore: number
  isScoringDay: boolean
}

export interface AttendanceWeek {
  weekStart: string
  weekEnd: string
  label: string
  totalPoints: number
  maxPoints: number
  daysPresent: number
  daysLate: number
  daysAbsent: number
  days: AttendanceDayRow[]
}

export interface AttendancePdfInput {
  clinicName: string
  staffName: string
  staffIdDisplay: string
  periodLabel: string // e.g. "Last 8 weeks ending May 7, 2026"
  weeks: AttendanceWeek[]
  generatedAt: Date
  generatedByName: string
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN_X = 40
const MARGIN_Y_TOP = 50
const MARGIN_Y_BOTTOM = 55
const ROW_H = 14
const WEEK_HEADER_H = 38
const TABLE_HEADER_H = 18
const WEEK_GAP = 14

const COLS = {
  date: { x: MARGIN_X, w: 80 },
  day: { x: MARGIN_X + 80, w: 50 },
  clockIn: { x: MARGIN_X + 130, w: 80 },
  clockOut: { x: MARGIN_X + 210, w: 80 },
  status: { x: MARGIN_X + 290, w: 100 },
  points: { x: MARGIN_X + 390, w: 60 }, // right-aligned
} as const

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtDate(ymd: string): string {
  // Returns "DD MMM" (e.g. "07 May") — date is already YYYY-MM-DD UTC.
  const [, m, d] = ymd.split('-').map(Number)
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${String(d).padStart(2, '0')} ${months[m - 1]}`
}

function drawRight(
  page: PDFPage,
  text: string,
  rightEdge: number,
  y: number,
  font: PDFFont,
  size: number
) {
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: rightEdge - w, y, size, font })
}

export async function generateAttendancePdf(input: AttendancePdfInput): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Attendance — ${input.staffName}`)
  pdf.setAuthor(input.clinicName)
  pdf.setCreator(input.clinicName)

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN_Y_TOP

  // ── First-page header ────────────────────────────────────────────────────
  page.drawText(input.clinicName, { x: MARGIN_X, y, size: 16, font: bold })
  y -= 20
  page.drawText('Attendance Record', { x: MARGIN_X, y, size: 12, font })
  y -= 22

  page.drawText(`Staff: ${input.staffName}  (${input.staffIdDisplay})`, {
    x: MARGIN_X,
    y,
    size: 10,
    font: bold,
  })
  y -= 14
  page.drawText(`Period: ${input.periodLabel}`, { x: MARGIN_X, y, size: 9, font })
  y -= 12
  page.drawText(
    `Generated ${input.generatedAt.toISOString().slice(0, 10)} by ${input.generatedByName}`,
    { x: MARGIN_X, y, size: 9, font, color: rgb(0.45, 0.45, 0.45) }
  )
  y -= 18

  const startNewPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN_Y_TOP
  }

  for (const week of input.weeks) {
    const blockH = WEEK_HEADER_H + TABLE_HEADER_H + week.days.length * ROW_H + WEEK_GAP
    if (y - blockH < MARGIN_Y_BOTTOM) startNewPage()

    // Week header bar
    page.drawRectangle({
      x: MARGIN_X - 4,
      y: y - 22,
      width: PAGE_W - MARGIN_X * 2 + 8,
      height: 22,
      color: rgb(0.95, 0.96, 0.98),
    })
    page.drawText(week.label, { x: MARGIN_X, y: y - 16, size: 11, font: bold })
    drawRight(
      page,
      `${week.totalPoints} / ${week.maxPoints} pts  ·  ${week.daysPresent + week.daysLate} present  ·  ${week.daysAbsent} absent`,
      PAGE_W - MARGIN_X,
      y - 16,
      font,
      9
    )
    y -= 32

    // Table header
    page.drawText('Date', { x: COLS.date.x, y, size: 8, font: bold })
    page.drawText('Day', { x: COLS.day.x, y, size: 8, font: bold })
    page.drawText('Clock In', { x: COLS.clockIn.x, y, size: 8, font: bold })
    page.drawText('Clock Out', { x: COLS.clockOut.x, y, size: 8, font: bold })
    page.drawText('Status', { x: COLS.status.x, y, size: 8, font: bold })
    drawRight(page, 'Points', COLS.points.x + COLS.points.w, y, bold, 8)
    y -= 4
    page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: PAGE_W - MARGIN_X, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    })
    y -= 12

    for (const d of week.days) {
      if (y - ROW_H < MARGIN_Y_BOTTOM) {
        startNewPage()
      }
      page.drawText(fmtDate(d.date), { x: COLS.date.x, y, size: 9, font })
      page.drawText(DAY_NAMES[d.dayOfWeek] ?? '', { x: COLS.day.x, y, size: 9, font })
      page.drawText(d.clockIn ?? '—', { x: COLS.clockIn.x, y, size: 9, font })
      page.drawText(d.clockOut ?? '—', { x: COLS.clockOut.x, y, size: 9, font })
      page.drawText(d.status, { x: COLS.status.x, y, size: 9, font })
      drawRight(
        page,
        d.isScoringDay ? String(d.dailyScore) : '—',
        COLS.points.x + COLS.points.w,
        y,
        font,
        9
      )
      y -= ROW_H
    }

    y -= WEEK_GAP
  }

  // Footer on last page
  page.drawLine({
    start: { x: MARGIN_X, y: MARGIN_Y_BOTTOM - 15 },
    end: { x: PAGE_W - MARGIN_X, y: MARGIN_Y_BOTTOM - 15 },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  })
  page.drawText(
    'Points = base 10/day, penalised for late arrival or early departure. Off-days and holidays are non-scoring.',
    { x: MARGIN_X, y: MARGIN_Y_BOTTOM - 28, size: 7, font, color: rgb(0.5, 0.5, 0.5) }
  )

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}
