import { type NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL
const WEBSITE_API_KEY = process.env.WEBSITE_API_KEY

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!BACKEND_URL || !WEBSITE_API_KEY) {
    console.error('/api/appointments: BACKEND_URL or WEBSITE_API_KEY not configured')
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 })
  }

  try {
    const body = (await req.json()) as Partial<Record<string, unknown>> | undefined
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 })
    }

    const { fullName, phone, service, preferredDate, message } = body as {
      fullName?: string
      phone?: string
      service?: string
      preferredDate?: string
      message?: string
    }

    if (!fullName || typeof fullName !== 'string' || !fullName.trim())
      return NextResponse.json({ error: "'fullName' is required" }, { status: 400 })
    if (!phone || typeof phone !== 'string' || !phone.trim())
      return NextResponse.json({ error: "'phone' is required" }, { status: 400 })
    if (!service || typeof service !== 'string' || !service.trim())
      return NextResponse.json({ error: "'service' is required" }, { status: 400 })
    if (!preferredDate || typeof preferredDate !== 'string' || !preferredDate.trim())
      return NextResponse.json({ error: "'preferredDate' is required" }, { status: 400 })

    const upstream = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/api/website-bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': WEBSITE_API_KEY,
      },
      body: JSON.stringify({
        name: fullName.trim(),
        phone: phone.trim(),
        service: service.trim(),
        preferredDate: preferredDate.trim(),
        message: typeof message === 'string' ? message.trim() || undefined : undefined,
      }),
    })

    if (!upstream.ok) {
      const data = (await upstream.json().catch(() => ({}))) as { error?: string }
      return NextResponse.json(
        { error: data.error || 'Failed to submit appointment' },
        { status: upstream.status >= 500 ? 500 : upstream.status }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error('/api/appointments error', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
