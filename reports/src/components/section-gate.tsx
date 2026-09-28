import { Outlet } from 'react-router-dom'
import { useInjection } from '@/src/contexts/injection-context'
import { NotPublishedState } from './not-published-state'

interface SectionGateProps {
  section: string
}

export function SectionGate({ section }: SectionGateProps) {
  const { isEnabled, isLoading } = useInjection()

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!isEnabled(section)) {
    return <NotPublishedState section={section} />
  }

  return <Outlet />
}
