import { useCallback, useRef, useState } from 'react'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'

export interface ConfirmOptions {
  title: string
  description: string
  /** Rendered in a "You are about to delete: X" block (destructive tone only). */
  itemName?: string
  /** Confirm button label. Defaults to "Delete" (destructive) / "Confirm" (default). */
  confirmLabel?: string
  /** Visual tone. Defaults to "destructive". Use "default" for non-destructive prompts. */
  tone?: 'destructive' | 'default'
}

/**
 * Promise-based confirmation, replacing the native `window.confirm()`. Renders a
 * single shared `DeleteConfirmationDialog` and resolves `true`/`false` when the
 * user confirms or dismisses — so call sites stay one-liners:
 *
 *   const { confirm, confirmDialog } = useConfirm()
 *   if (!(await confirm({ title: 'Delete X', description: '…' }))) return
 *   // …proceed…
 *   return (<>…{confirmDialog}</>)
 *
 * The dialog closes immediately on confirm; the caller owns any async work and
 * its own busy state afterwards (mirroring the prior `confirm()` call flow).
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
  }, [])

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        settle(false)
        setOptions(null)
      }
    },
    [settle]
  )

  const handleConfirm = useCallback(() => {
    settle(true)
  }, [settle])

  const confirmDialog = options ? (
    <DeleteConfirmationDialog
      open
      onOpenChange={handleOpenChange}
      onConfirm={handleConfirm}
      title={options.title}
      description={options.description}
      itemName={options.itemName}
      confirmLabel={options.confirmLabel}
      tone={options.tone}
    />
  ) : null

  return { confirm, confirmDialog }
}
