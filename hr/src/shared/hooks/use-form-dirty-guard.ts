import { useCallback, useEffect, useRef, useState } from 'react'

interface UseFormDirtyGuardOptions {
  /** Whether the form currently has unsaved changes. */
  isDirty: boolean
  /** Downstream close handler — called with the form actually closing. */
  onClose: () => void
  /** Also warn via the browser's `beforeunload` prompt. Defaults to `true`. */
  warnOnBrowserUnload?: boolean
}

interface UseFormDirtyGuardReturn {
  guardedOnOpenChange: (open: boolean) => void
  confirmOpen: boolean
  confirmDiscard: () => void
  cancelDiscard: () => void
}

/**
 * Prevents accidental loss of unsaved form data. Wire `guardedOnOpenChange`
 * into a Sheet/Dialog; closing a dirty form raises a confirm dialog instead of
 * closing. Also attaches a `beforeunload` listener.
 */
export function useFormDirtyGuard({
  isDirty,
  onClose,
  warnOnBrowserUnload = true,
}: UseFormDirtyGuardOptions): UseFormDirtyGuardReturn {
  const [confirmOpen, setConfirmOpen] = useState(false)

  const isDirtyRef = useRef(isDirty)
  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  useEffect(() => {
    if (!warnOnBrowserUnload) return
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return
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
