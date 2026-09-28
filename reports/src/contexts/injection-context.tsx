import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { api } from '@/lib/api-client'

type InjectionRow = {
  id: string
  section: string
  enabled: boolean
  config: Record<string, unknown>
  updatedAt: string
}

type InjectionContextValue = {
  sections: InjectionRow[]
  isEnabled: (section: string) => boolean
  getConfig: (section: string) => Record<string, unknown>
  isLoading: boolean
}

const InjectionContext = createContext<InjectionContextValue>({
  sections: [],
  isEnabled: () => false,
  getConfig: () => ({}),
  isLoading: true,
})

export function InjectionProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<InjectionRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    api
      .get<InjectionRow[]>('/api/reports-injection')
      .then((res) => {
        if (res.success && res.data) setSections(res.data)
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  function isEnabled(section: string): boolean {
    return sections.find((s) => s.section === section)?.enabled ?? false
  }

  function getConfig(section: string): Record<string, unknown> {
    return (sections.find((s) => s.section === section)?.config ?? {}) as Record<string, unknown>
  }

  return (
    <InjectionContext.Provider value={{ sections, isEnabled, getConfig, isLoading }}>
      {children}
    </InjectionContext.Provider>
  )
}

export function useInjection() {
  return useContext(InjectionContext)
}
