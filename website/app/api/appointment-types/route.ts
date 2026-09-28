import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL
const WEBSITE_API_KEY = process.env.WEBSITE_API_KEY

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public proxy for the active appointment types, so the booking form's service
 * picker uses the same canonical lookup as the clinic. Holds the API key
 * server-side (same key as the booking POST). On any failure it returns an
 * empty list so the form can fall back to a free-text field.
 */
export async function GET() {
  if (!BACKEND_URL || !WEBSITE_API_KEY) {
    return NextResponse.json({ data: [] })
  }
  try {
    const upstream = await fetch(
      `${BACKEND_URL.replace(/\/$/, '')}/api/website-bookings/appointment-types`,
      { headers: { 'x-api-key': WEBSITE_API_KEY }, cache: 'no-store' }
    )
    if (!upstream.ok) return NextResponse.json({ data: [] })
    const json = (await upstream.json().catch(() => ({}))) as { data?: unknown }
    return NextResponse.json({ data: Array.isArray(json.data) ? json.data : [] })
  } catch {
    return NextResponse.json({ data: [] })
  }
}
