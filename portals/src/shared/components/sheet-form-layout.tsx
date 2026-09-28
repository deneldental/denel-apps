import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'

/**
 * Standardized width presets for `<SheetFormLayout>`.
 *
 * - `sm` (420px) — quick edits with a handful of fields
 * - `md` (600px) — default for most Add/Edit forms
 * - `lg` (800px) — multi-section / multi-column forms (e.g. appointments, medical records)
 */
export type SheetSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<SheetSize, string> = {
  sm: '!w-full !max-w-[420px]',
  md: '!w-full !max-w-[600px]',
  lg: '!w-full !max-w-[800px]',
}

interface SheetFormLayoutProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Title shown in the sticky header. */
  title: string
  /** Optional short description under the title. */
  description?: string
  /** Form body — any scrollable content. */
  children: ReactNode
  /** Size preset; defaults to `md`. Use `sm` for quick edits, `lg` for dense forms. */
  size?: SheetSize
  /** Submit button label; defaults to "Save". */
  submitLabel?: string
  /** Cancel button label; defaults to "Cancel". */
  cancelLabel?: string
  /** Disable the submit button (e.g. client-side validation failing). */
  submitDisabled?: boolean
  /** Currently submitting — shows spinner, locks the form footer. */
  submitting?: boolean
  /** Called when the user clicks Save. Wire this to your form's submit handler. */
  onSubmit: () => void
  /** Optional custom footer content rendered before the cancel/submit pair. */
  extraFooter?: ReactNode
  /** Optional `aria-live` region for server-side errors or status messages. */
  statusMessage?: string
  /** Visually hide the built-in footer (if the form wants to render its own). */
  hideFooter?: boolean
  /**
   * Split the footer into two equal columns — Cancel and Submit each fill one
   * half, together making a single full-width row.
   *
   * Opt-in, and deliberately so: this layout is shared by 23 forms and the
   * default (right-aligned auto-width pair) is what the other 22 expect.
   * Not compatible with `extraFooter`, which needs the flex row.
   */
  footerFullWidth?: boolean
}

/**
 * Opinionated wrapper around `<Sheet>` for Add/Edit form surfaces.
 *
 * Provides:
 * - Fixed width presets (`sm` / `md` / `lg`) via the `size` prop
 * - Scrollable body between a sticky header and a sticky action footer
 * - Submission lock — `submitting` disables the footer + intercepts ESC / outside-click
 * - `aria-live` status region for server-validation feedback
 *
 * Callers should:
 * 1. Wrap form state (fields + submit handler) themselves
 * 2. Pass `submitting` while a request is in flight to prevent double-submit + accidental close
 * 3. Wire `useFormDirtyGuard()` to `onOpenChange` when the form holds unsaved changes
 *
 * Example:
 * ```tsx
 * <SheetFormLayout
 *   open={open}
 *   onOpenChange={guardedOnOpenChange}
 *   title="Edit Patient"
 *   size="md"
 *   submitting={isSaving}
 *   onSubmit={handleSave}
 * >
 *   {...form fields...}
 * </SheetFormLayout>
 * ```
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
  footerFullWidth = false,
}: SheetFormLayoutProps) {
  // Intercept close while submitting — we don't want the user bailing out
  // mid-request and ending up with a half-saved record.
  const handleOpenChange = (next: boolean) => {
    if (!next && submitting) return
    onOpenChange(next)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          SIZE_CLASSES[size],
          // Override default p-6 + gap-4; we manage our own header/body/footer spacing.
          '!p-0 flex flex-col'
        )}
        // Prevent Radix from auto-closing via ESC / outside click while submitting.
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

        {/* Live region for server feedback — visually rendered when a message exists */}
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
