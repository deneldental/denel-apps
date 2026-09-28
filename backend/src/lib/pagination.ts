const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 200

/**
 * Parse page/pageSize query params with safe bounds.
 * Returns page (1-based), pageSize (capped at PAGE_SIZE_MAX), and offset.
 */
export function parsePagination(query: Record<string, string | undefined>) {
  const page = Math.max(1, parseInt(query.page || '1', 10) || 1)
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(query.pageSize || String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT)
  )
  return { page, pageSize, offset: (page - 1) * pageSize }
}
