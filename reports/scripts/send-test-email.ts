/**
 * One-off script to test Resend. Loads .env.local and sends one email.
 * Run: npx tsx scripts/send-test-email.ts
 */
import { config } from 'dotenv'

// Load .env.local before importing lib/email (it reads RESEND_API_KEY at load time)
config({ path: '.env.local' })

const to = process.env.TEST_EMAIL_TO ?? 'framadadentalclinic@gmail.com'

async function main() {
  const { sendEmail } = await import('../lib/email')
  console.log('Sending test email to', to, '...')
  const result = await sendEmail({
    to,
    subject: 'Hello World',
    html: '<p>Congrats on sending your <strong>first email</strong> with Resend!</p>',
  })
  if (result.success) {
    console.log('✅ Email sent successfully. Check the inbox for', to)
  } else {
    console.error('❌ Failed:', result.error?.message)
    process.exit(1)
  }
}

main()
