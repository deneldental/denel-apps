import { API_BASE_URL } from '@/lib/api-client'

/**
 * Trigger the server-side PDF export and stream the response into a browser
 * download. The backend renders /analytics/print with headless Chromium and
 * returns application/pdf — see backend/src/routes/analytics-export.ts.
 */
export async function exportAnalyticsPdf(query: string, label: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/analytics/export-pdf?${query}`, {
    method: 'GET',
    credentials: 'include',
    headers: { 'X-App-Id': 'portal' },
  })

  if (!res.ok) {
    let detail = `Export failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) detail = body.error
    } catch {}
    throw new Error(detail)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Analytics-${label.replace(/\s+/g, '-')}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
