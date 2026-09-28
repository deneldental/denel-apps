// Pure helpers for generating safe object keys/filenames. No storage I/O.

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ]
  const month = months[date.getMonth()]
  const year = date.getFullYear()
  return `${day}${month}${year}`
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .trim()
}

/**
 * Build a deterministic, slug-friendly file name from a display name + date.
 * Example: `(name="John Doe", date=2025-05-07, ext="pdf")` → `john_doe_07may2025.pdf`.
 */
export async function generateFileName(
  name: string,
  date: Date,
  extension: string,
  index?: number
): Promise<string> {
  const sanitized = sanitizeName(name)
  const formattedDate = formatDate(date)
  const ext = extension.startsWith('.') ? extension : `.${extension}`

  if (index !== undefined) {
    const indexStr = String(index).padStart(3, '0')
    return `${sanitized}_${formattedDate}_${indexStr}${ext}`
  }

  return `${sanitized}_${formattedDate}${ext}`
}
