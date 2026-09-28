/**
 * smoke-test-sms.ts
 *
 * Drives every SMS surface in the codebase by rendering the template/message
 * each route would produce, then calling sendSMS() directly. Bypasses HTTP
 * auth/RBAC — the goal is to prove the Hubtel connection works and every
 * template renders correctly. End-to-end UI flows (clicking "Remind" on the
 * dashboard, granting PWA access, etc.) need to be tested manually after this.
 *
 * Sends real SMS via Hubtel. Run AFTER seed-test-phones.ts so the recipient
 * resolution paths route everything to the test number anyway.
 *
 * Usage:
 *   doppler run --config stg -- pnpm tsx backend/scripts/smoke-test-sms.ts
 *   doppler run --config stg -- pnpm tsx backend/scripts/smoke-test-sms.ts --only=welcome,birthday
 *
 * Flags:
 *   --only=a,b,c   Run just the named scenarios (csv of scenario names)
 *   --dry          Print the messages without sending
 *   --delay=1500   Override default 2000ms delay between sends
 */

import { validateBackendEnv } from '../src/config/env'
import { DEFAULT_SMS_TEMPLATES } from '../src/lib/constants'
import { sendSMS } from '../src/lib/sms'

validateBackendEnv()

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true'] as const
  })
)

const DRY = args.get('dry') === 'true'
const DELAY_MS = Number(args.get('delay') ?? 2000)
const ONLY = (args.get('only') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const TEST_PHONE = '0553424972'
const CLINIC = 'Framada'
const PATIENT_NAME = 'Smoke Test Patient'
const PATIENT_ID = 'FDM999'

// Templates — substitute the same tokens the runtime substitutes.
const fill = (t: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
    t
  )

type Scenario = {
  name: string
  type: 'bulk' | 'birthday' | 'followup' | 'appointment'
  category: string
  message: string
}

const scenarios: Scenario[] = [
  // ── Patient lifecycle ────────────────────────────────────────────────────
  {
    name: 'welcome',
    type: 'bulk',
    category: 'Patient onboarding (portal activation)',
    message: fill(DEFAULT_SMS_TEMPLATES.welcome, {
      ClinicName: CLINIC,
      Patientname: PATIENT_NAME,
      PatientID: PATIENT_ID,
    }),
  },

  // ── Appointment flows ────────────────────────────────────────────────────
  {
    name: 'appointment_created',
    type: 'appointment',
    category: 'Appointment created',
    message: fill(DEFAULT_SMS_TEMPLATES.appointment, {
      Patientname: PATIENT_NAME,
      date: 'Mon 02 Jun 2026',
      time: '10:30 AM',
    }),
  },
  {
    name: 'appointment_rescheduled',
    type: 'appointment',
    category: 'Appointment rescheduled',
    message: `Dear ${PATIENT_NAME}, your appointment has been rescheduled to Tue 03 Jun 2026 at 2:00 PM. Please arrive 30 minutes before time.`,
  },
  {
    name: 'appointment_workflow',
    type: 'appointment',
    category: 'Appointment workflow callback (e.g. completed)',
    message: `Dear ${PATIENT_NAME}, your appointment has been marked complete. Thank you for choosing ${CLINIC}.`,
  },
  {
    name: 'pre_appointment_reminder',
    type: 'appointment',
    category: 'Pre-appointment cron reminder (24h before)',
    message: `Reminder: ${PATIENT_NAME}, your appointment at ${CLINIC} is tomorrow at 10:30 AM. See you soon.`,
  },

  // ── Payment flows ────────────────────────────────────────────────────────
  {
    name: 'payment_received',
    type: 'bulk',
    category: 'Payment received confirmation',
    message: fill(DEFAULT_SMS_TEMPLATES.payment, {
      Patientname: PATIENT_NAME,
      amount: '450.00',
      treatmenttypes: 'Scaling and Polishing',
    }),
  },
  {
    name: 'payment_plan_installment',
    type: 'bulk',
    category: 'Payment plan installment payment',
    message: fill(DEFAULT_SMS_TEMPLATES.paymentPlan, {
      Patientname: PATIENT_NAME,
      amount: '200.00',
      treatmenttypes: 'Orthodontic Treatment',
      balance: '1800.00',
    }),
  },
  {
    name: 'payment_plan_created',
    type: 'bulk',
    category: 'Payment plan created',
    message: fill(DEFAULT_SMS_TEMPLATES.paymentPlanCreated, {
      Patientname: PATIENT_NAME,
      ClinicName: CLINIC,
      total: '2000.00',
      installments: '5',
      perInstallment: '400.00',
      treatmenttypes: 'Orthodontic Treatment',
    }),
  },
  {
    name: 'payment_overdue',
    type: 'bulk',
    category: 'Payment overdue dunning (dashboard Remind button)',
    message: `Dear ${PATIENT_NAME}, this is a gentle reminder about your outstanding payment of GHS 450.00. Please contact Framada Dental Clinic to arrange payment. Thank you!`,
  },

  // ── CRM / lifecycle (cron) ───────────────────────────────────────────────
  {
    name: 'birthday',
    type: 'birthday',
    category: 'Birthday SMS (cron)',
    message: `Happy birthday, ${PATIENT_NAME}! Wishing you a fantastic year ahead from all of us at ${CLINIC}.`,
  },
  {
    name: 'recare_recall',
    type: 'followup',
    category: 'Recare / recall plan due',
    message: `Hi ${PATIENT_NAME}, it's been a while since your last visit. Time for a check-up? Reply to book at ${CLINIC}.`,
  },
  {
    name: 'follow_up',
    type: 'followup',
    category: 'Treatment follow-up',
    message: `Hi ${PATIENT_NAME}, just checking in after your recent visit. Let us know if you have any concerns. - ${CLINIC}`,
  },

  // ── Bulk campaign ────────────────────────────────────────────────────────
  {
    name: 'bulk_campaign',
    type: 'bulk',
    category: 'CRM bulk campaign (free text)',
    message: `${CLINIC}: We're offering 20% off scaling this month. Reply to book. Smoke test send.`,
  },

  // ── OTP / auth ───────────────────────────────────────────────────────────
  {
    name: 'patient_otp',
    type: 'bulk',
    category: 'Patient PWA login OTP',
    message: `Your ${CLINIC} verification code is 123456. Expires in 5 minutes.`,
  },
  {
    name: 'staff_otp',
    type: 'bulk',
    category: 'Staff password reset OTP',
    message: `${CLINIC} staff password reset code: 654321. Expires in 10 minutes.`,
  },
]

async function main() {
  const filtered = ONLY.length > 0 ? scenarios.filter((s) => ONLY.includes(s.name)) : scenarios

  if (filtered.length === 0) {
    console.log(`No scenarios match --only=${ONLY.join(',')}. Available:`)
    for (const s of scenarios) console.log(`  - ${s.name}`)
    process.exit(1)
  }

  console.log(`\nMode: ${DRY ? 'DRY (no SMS)' : 'LIVE (sending to ' + TEST_PHONE + ')'}`)
  console.log(`Delay between sends: ${DELAY_MS}ms`)
  console.log(`Scenarios queued: ${filtered.length}\n`)

  const results: Array<{ name: string; success: boolean; note: string }> = []

  for (const [i, s] of filtered.entries()) {
    const header = `[${String(i + 1).padStart(2, '0')}/${filtered.length}] ${s.name.padEnd(28)} ${s.category}`
    console.log(`\n${header}`)
    console.log(`  → ${s.message}`)

    if (DRY) {
      results.push({ name: s.name, success: true, note: 'dry-run' })
      continue
    }

    try {
      const res = await sendSMS([{ phone: TEST_PHONE, message: s.message }], undefined, s.type)
      const ok = !!res.success
      const note = ok
        ? res.data && typeof res.data === 'object' && 'simulated' in res.data
          ? 'simulated (no Hubtel creds)'
          : res.data && typeof res.data === 'object' && 'stubbed' in res.data
            ? 'stubbed (SMS_STUB_FILE)'
            : 'sent'
        : ('error' in res ? (res as { error: string }).error : 'failed')
      console.log(`  ${ok ? '✓' : '✖'} ${note}`)
      results.push({ name: s.name, success: ok, note })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ✖ exception: ${msg}`)
      results.push({ name: s.name, success: false, note: `exception: ${msg}` })
    }

    if (i < filtered.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS))
  }

  // Summary
  console.log('\n────────────── Summary ──────────────')
  const ok = results.filter((r) => r.success).length
  const fail = results.length - ok
  for (const r of results) {
    console.log(`  ${r.success ? '✓' : '✖'} ${r.name.padEnd(28)} ${r.note}`)
  }
  console.log(`\n  ${ok}/${results.length} sent  ·  ${fail} failed`)
  console.log('\nNote: cron-based reminders, OTP flows, and route-level guards')
  console.log('(child→guardianPhone fallback, cooldown gating) are NOT exercised')
  console.log('by this script. Verify those manually through the UI.\n')

  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
