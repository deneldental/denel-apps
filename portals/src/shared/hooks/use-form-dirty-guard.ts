import { useCallback, useEffect, useRef, useState } from 'react'

interface UseFormDirtyGuardOptions {
  /** Whether the form currently has unsaved changes. */
  isDirty: boolean
  /**
   * Downstream `onOpenChange` handler (from `<Sheet>` / `<SheetFormLayout>` / `<Dialog>`).
   * When the user confirms discard, this is called with `false` to actually close.
   */
  onClose: () => void
  /**
   * Also warn via the browser's built-in `beforeunload` prompt when the tab is
   * closed or reloaded with a dirty form. Defaults to `true`.
   */
  warnOnBrowserUnload?: boolean
}

interface UseFormDirtyGuardReturn {
  /**
   * Guarded `onOpenChange` handler — pass this to `<Sheet>` or `<SheetFormLayout>`.
   * Intercepts close attempts when the form is dirty and raises the confirm dialog.
   */
  guardedOnOpenChange: (open: boolean) => void
  /** True while the `ConfirmDiscardDialog` should be shown. */
  confirmOpen: boolean
  /** Called when the user confirms they want to discard unsaved changes. */
  confirmDiscard: () => void
  /** Called when the user cancels the discard prompt (i.e. stays on the form). */
  cancelDiscard: () => void
}

/**
 * Prevents accidental loss of unsaved form data.
 *
 * Wire this into any surface (Sheet, Dialog) that hosts a form. When the user
 * tries to close a dirty form via outside-click, ESC, or a Cancel button, the
 * guarded handler raises a confirm dialog instead of immediately closing.
 *
 * Also attaches a `beforeunload` listener so closing the tab / reloading shows
 * the browser's native prompt when the form is dirty.
 *
 * ```tsx
 * const [open, setOpen] = useState(false)
 * const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } =
 *   useFormDirtyGuard({
 *     isDirty: hasUnsavedChanges,
 *     onClose: () => setOpen(false),
 *   })
 *
 * <SheetFormLayout open={open} onOpenChange={guardedOnOpenChange} ... />
 * <ConfirmDiscardDialog
 *   open={confirmOpen}
 *   onConfirm={confirmDiscard}
 *   onCancel={cancelDiscard}
 * />
 * ```
 */
export function useFormDirtyGuard({
  isDirty,
  onClose,
  warnOnBrowserUnload = true,
}: UseFormDirtyGuardOptions): UseFormDirtyGuardReturn {
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Keep a live ref so the beforeunload listener always sees current isDirty
  // without being reattached on every render.
  const isDirtyRef = useRef(isDirty)
  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  useEffect(() => {
    if (!warnOnBrowserUnload) return
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return
      // Spec-compliant: setting returnValue triggers the native confirm.
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [warnOnBrowserUnload])

  const guardedOnOpenChange = useCallback(
    (open: boolean) => {
      if (open) return // Opening is never guarded.
      if (isDirtyRef.current) {
        setConfirmOpen(true)
        return
      }
      onClose()
    },
    [onClose]
  )

  const confirmDiscard = useCallback(() => {
    setConfirmOpen(false)
    onClose()
  }, [onClose])

  const cancelDiscard = useCallback(() => {
    setConfirmOpen(false)
  }, [])

  return {
    guardedOnOpenChange,
    confirmOpen,
    confirmDiscard,
    cancelDiscard,
  }
}
