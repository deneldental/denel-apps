import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@denel/ui'
import { cn } from '@denel/utils'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

/** Standardized width presets for `<SheetFormLayout>`. */
export type SheetSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<SheetSize, string> = {
  sm: '!w-full !max-w-[420px]',
  md: '!w-full !max-w-[600px]',
  lg: '!w-full !max-w-[800px]',
}

interface SheetFormLayoutProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  size?: SheetSize
  submitLabel?: string
  cancelLabel?: string
  submitDisabled?: boolean
  submitting?: boolean
  onSubmit: () => void
  extraFooter?: ReactNode
  statusMessage?: string
  hideFooter?: boolean
}

/**
 * Opinionated wrapper around `<Sheet>` for Add/Edit form surfaces: fixed width
 * presets, scrollable body between sticky header/footer, submission lock, and
 * an `aria-live` status region.
 */
export function SheetFormLayout({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  submitDisabled = false,
  submitting = false,
  onSubmit,
  extraFooter,
  statusMessage,
  hideFooter = false,
}: SheetFormLayoutProps) {
  // Intercept close while submitting — avoid a half-saved record.
  const handleOpenChange = (next: boolean) => {
    if (!next && submitting) return
    onOpenChange(next)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className={cn(SIZE_CLASSES[size], '!p-0 flex flex-col')}
        onEscapeKeyDown={(e) => {
          if (submitting) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (submitting) e.preventDefault()
        }}
      >
        {/* Sticky header */}
        <SheetHeader className="shrink-0 space-y-1 border-b px-6 pt-6 pb-4 text-left">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {/* Live region for server feedback */}
        {statusMessage && (
          <div
            role="status"
            aria-live="polite"
            className="shrink-0 border-t border-destructive/20 bg-destructive/5 px-6 py-2 text-sm text-destructive"
          >
            {statusMessage}
          </div>
        )}

        {/* Sticky footer */}
        {!hideFooter && (
          <div className="shrink-0 border-t bg-background px-6 py-4">
            <div className="grid grid-cols-2 gap-3 w-full">
              {extraFooter && <div className="col-span-2">{extraFooter}</div>}
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
                className="w-full"
              >
                {cancelLabel}
              </Button>
              <Button
                type="button"
                onClick={onSubmit}
                disabled={submitDisabled || submitting}
                className="w-full"
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {submitLabel}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
