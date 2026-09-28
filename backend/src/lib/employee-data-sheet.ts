/**
 * Employee Data Sheet — a printable A4 summary of a staff member's record,
 * rendered to HTML then to PDF via `renderHtmlToPdf`. Consumed by both HR
 * (any staff) and the Team app (a staff member's own copy).
 *
 * The HTML is fully self-contained (inline CSS, embedded/remote <img>) so it
 * prints without network access beyond the optional logo/photo URLs.
 */

import { signPrivateRefsInText } from './private-file-links'

// biome-ignore lint/suspicious/noExplicitAny: accepts the raw staff row
type StaffLike = Record<string, any>

export interface DataSheetOptions {
  clinicName: string
  clinicPhone?: string | null
  clinicAddress?: string | null
  logoUrl?: string | null
  generatedByName?: string | null
}

const esc = (v: unknown): string =>
  v === undefined || v === null || v === ''
    ? '—'
    : String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

const titleCase = (v: unknown): string =>
  v === undefined || v === null || v === ''
    ? '—'
    : esc(String(v).replace(/_/g, ' ')).replace(/\b\w/g, (c) => c.toUpperCase())

function fmtDate(v: unknown): string {
  if (!v) return '—'
  const d = new Date(v as string)
  if (Number.isNaN(d.getTime())) return esc(v)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const DEPT_LABELS: Record<string, string> = {
  dental: 'Dental',
  front_desk: 'Front Desk',
  both: 'Both',
}

function row(label: string, value: string): string {
  return `<tr><td class="lbl">${label}</td><td class="val">${value}</td></tr>`
}

function paymentSummary(s: StaffLike): string {
  if (s.bankName || s.bankAccountNumber) {
    return `Bank — ${esc(s.bankName)} · ${esc(s.bankAccountName)} · ${esc(s.bankAccountNumber)}`
  }
  if (s.momoNumber) {
    return `Mobile money — ${titleCase(s.momoNetwork)} · ${esc(s.momoNumber)}`
  }
  return '—'
}

function capabilities(s: StaffLike): string {
  const flags: Array<[boolean, string]> = [
    [!!s.tracksAttendance, 'Tracks attendance'],
    [!!s.hasPayslip, 'Has payslip'],
    [!!s.requiresLicense, 'Requires licence'],
    [!!s.isClinicalPractitioner, 'Clinical practitioner'],
    [!!s.receivesCommission, 'Receives commission'],
  ]
  const on = flags.filter(([v]) => v).map(([, l]) => l)
  return on.length ? on.join(', ') : '—'
}

/**
 * The sheet's HTML, ready for the PDF renderer. A private staff photo is stored
 * as a reference; Puppeteer renders outside the API edge, so it is swapped for
 * a short-lived signed link here.
 */
export async function buildEmployeeDataSheetHtml(
  staff: StaffLike,
  opts: DataSheetOptions
): Promise<string> {
  return signPrivateRefsInText(dataSheetHtml(staff, opts))
}

function dataSheetHtml(staff: StaffLike, opts: DataSheetOptions): string {
  const generatedAt = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const photo = staff.profileImage
    ? `<img class="photo" src="${esc(staff.profileImage)}" alt="Photo" />`
    : `<div class="photo placeholder">No photo</div>`

  const logo = opts.logoUrl
    ? `<img class="logo" src="${esc(opts.logoUrl)}" alt="${esc(opts.clinicName)}" />`
    : `<div class="brandname">${esc(opts.clinicName)}</div>`

  const nextOfKin = `${esc(staff.nextOfKinName)} (${titleCase(staff.nextOfKinRelationship)}) · ${esc(staff.nextOfKinPhone)}`
  const emergency = `${esc(staff.emergencyContactName)} (${titleCase(staff.emergencyContactRelationship)}) · ${esc(staff.emergencyContactPhone)}`

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 28px 32px; font-size: 12px; }
  .head { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #16a34a; padding-bottom: 14px; margin-bottom: 18px; }
  .logo { height: 40px; object-fit: contain; }
  .brandname { font-size: 18px; font-weight: 800; color: #16a34a; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 16px; margin: 0; letter-spacing: .3px; }
  .doc-title p { margin: 2px 0 0; color: #666; font-size: 10px; }
  .idbar { display: flex; align-items: center; gap: 18px; margin-bottom: 18px; }
  .photo { width: 84px; height: 84px; border-radius: 10px; object-fit: cover; border: 1px solid #e2e2e2; }
  .photo.placeholder { display: flex; align-items: center; justify-content: center; background: #f3f4f6; color: #9ca3af; font-size: 10px; }
  .idbar h2 { margin: 0; font-size: 20px; }
  .idbar .sub { color: #555; margin-top: 3px; }
  .idbar .pill { display: inline-block; background: #ecfdf5; color: #047857; border-radius: 999px; padding: 2px 10px; font-size: 10px; font-weight: 600; margin-top: 6px; }
  section { margin-bottom: 14px; break-inside: avoid; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: #16a34a; border-bottom: 1px solid #eee; padding-bottom: 4px; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; }
  td.lbl { color: #666; width: 38%; }
  td.val { font-weight: 600; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
  .consent { background: #f9fafb; border: 1px solid #eee; border-radius: 8px; padding: 8px 10px; font-size: 10px; color: #555; }
  .foot { margin-top: 20px; border-top: 1px solid #eee; padding-top: 8px; color: #9ca3af; font-size: 9px; display: flex; justify-content: space-between; }
</style></head>
<body>
  <div class="head">
    ${logo}
    <div class="doc-title">
      <h1>Employee Data Sheet</h1>
      <p>${esc(opts.clinicName)}${opts.clinicPhone ? ` · ${esc(opts.clinicPhone)}` : ''}</p>
    </div>
  </div>

  <div class="idbar">
    ${photo}
    <div>
      <h2>${esc(staff.fullName)}</h2>
      <div class="sub">${esc(staff.position || '—')}${staff.department ? ` · ${esc(DEPT_LABELS[String(staff.department)] ?? staff.department)}` : ''}</div>
      <span class="pill">Staff ID: ${esc(staff.staffId)}</span>
    </div>
  </div>

  <div class="two">
    <section>
      <h3>Personal</h3>
      <table>
        ${row('Date of birth', fmtDate(staff.dateOfBirth))}
        ${row('Gender', titleCase(staff.gender))}
        ${row('Nationality', esc(staff.nationality))}
        ${row('Marital status', titleCase(staff.maritalStatus))}
        ${row('Ghana Card PIN', esc(staff.ghanaCardPin))}
        ${row('Phone', esc(staff.phone))}
        ${row('Email', esc(staff.email))}
        ${row('Residential address', esc(staff.residentialAddress))}
        ${row('Digital address', esc(staff.digitalAddress))}
        ${row('Next of kin', nextOfKin)}
      </table>
    </section>

    <section>
      <h3>Employment</h3>
      <table>
        ${row('Title', esc(staff.position))}
        ${row('Department', esc(DEPT_LABELS[String(staff.department)] ?? staff.department))}
        ${row('Staff type', titleCase(staff.staffType))}
        ${row('Date of joining', fmtDate(staff.dateOfJoining))}
        ${row('SSNIT number', esc(staff.ssnitId))}
        ${row('Payment', paymentSummary(staff))}
        ${row('Salary band', esc(staff.salaryBand))}
        ${row('Capabilities', capabilities(staff))}
        ${row('Status', titleCase(staff.status))}
      </table>
    </section>

    <section>
      <h3>Education</h3>
      <table>
        ${row('Highest qualification', esc(staff.highestQualification))}
        ${row('Institution', esc(staff.institution))}
        ${row('Year', esc(staff.qualificationYear))}
      </table>
    </section>

    <section>
      <h3>Emergency contact</h3>
      <table>
        ${row('Contact', emergency)}
      </table>
    </section>
  </div>

  <section>
    <h3>Data-processing consent</h3>
    <div class="consent">
      ${staff.consentGiven ? '✓ Consent given' : 'Consent not recorded'}${staff.consentAt ? ` on ${fmtDate(staff.consentAt)}` : ''} —
      collection &amp; processing of personal information for employment and payroll purposes, in
      line with the Data Protection Act, 2012 (Act 843).
    </div>
  </section>

  <div class="foot">
    <span>Confidential — Denel Dental Clinic personnel record.</span>
    <span>Generated ${generatedAt}${opts.generatedByName ? ` by ${esc(opts.generatedByName)}` : ''}</span>
  </div>
</body></html>`
}
