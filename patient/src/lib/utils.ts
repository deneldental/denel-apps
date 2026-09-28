// Re-export shared utilities from @denel/utils to avoid duplication.
// Keep this barrel so existing `@/lib/utils` imports throughout the PWA
// continue to resolve without touching call-sites.
export { cn, formatAmount, formatCurrency, formatDate, formatDateTime } from '@denel/utils'
