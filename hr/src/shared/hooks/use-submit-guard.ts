import { useCallback, useRef, useState } from 'react'

/**
 * Standard form-submit guard. Fixes double-submit (a synchronous `useRef` lock
 * rejects re-entrant calls before React state flushes) and stuck buttons
 * (`try/finally` always clears the loading flag).
 *
 * Usage:
 *   const { isSubmitting, submit } = useSubmitGuard()
 *   const onSubmit = () => submit(async () => { ...await api... })
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
