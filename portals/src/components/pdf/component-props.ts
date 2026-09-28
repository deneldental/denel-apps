import type { ReactNode } from 'react'
import type { Style } from '@/lib/pdf-primitives'

/**
 * Base props shared by every pdfcn component.
 *
 * Each component's own props extend this, which is why their docstrings all end
 * with `… | children | style`. `Divider` takes `Omit<PDFComponentProps, 'children'>`
 * — it renders a rule and has nothing to nest — so `children` must be a declared
 * key here rather than arriving implicitly.
 *
 * React 19 removed the implicit `children` that `React.FC` used to add, so a
 * props interface that does not declare it does not accept it.
 */
export interface PDFComponentProps {
  children?: ReactNode
  style?: Style
}
