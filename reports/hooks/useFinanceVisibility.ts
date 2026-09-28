import type { FinanceVisibilityConfig } from '@denel/types'
import { useEffect, useState } from 'react'
import { DEFAULT_FINANCE_VISIBILITY, getFinanceVisibility } from '@/lib/actions/finance-visibility'

/**
 * Loads the `finance_visibility` config the portal controls. Charts and
 * finance-sensitive sections in the report pages gate on these flags.
 *
 * Starts from the all-visible default so the first render never hides a
 * section that should be shown; swaps in the real config once it arrives.
 */
export function useFinanceVisibility(): FinanceVisibilityConfig {
  const [config, setConfig] = useState<FinanceVisibilityConfig>(DEFAULT_FINANCE_VISIBILITY)

  useEffect(() => {
    let active = true
    void getFinanceVisibility().then((cfg) => {
      if (active) setConfig(cfg)
    })
    return () => {
      active = false
    }
  }, [])

  return config
}
