import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Conditional className helper. Combines clsx (boolean/array logic) with
 * tailwind-merge (deduplicates conflicting Tailwind utilities so the last one
 * wins, e.g. `cn('p-2', 'p-4')` → `'p-4'`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
