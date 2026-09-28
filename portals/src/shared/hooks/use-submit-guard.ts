import { useCallback, useRef, useState } from 'react'

/**
 * Standard form-submit guard. Fixes two audit-wide issues at once:
 *  - double-submit: a synchronous `useRef` lock rejects re-entrant calls before
 *    React state has even flushed (a `disabled` button alone is not enough).
 *  - stuck buttons: `try/finally` always clears the loading flag, so a thrown
 *    error can never leave the submit button permanently disabled.
 *
 * Usage:
 *   const { isSubmitting, submit } = useSubmitGuard()
 *   const onSubmit = () => submit(async () => { ...await api... })
 *   <Button disabled={isSubmitting}>Save</Button>
 */
export function useSubmitGuard() {
  const inFlight = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = useCallback(async (fn: () => Promise<void>): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setIsSubmitting(true)
    try {
      await fn()
    } finally {
      inFlight.current = false
      setIsSubmitting(false)
    }
  }, [])

  return { isSubmitting, submit }
}
