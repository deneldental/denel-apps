import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { authClient } from '@/lib/auth-client'
import { InjectionProvider } from '@/src/contexts/injection-context'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const [userWithRole, setUserWithRole] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadSession() {
      try {
        const { data: sessionData, error } = await authClient.getSession()
        if (error || !sessionData) {
          navigate('/auth/login')
          return
        }
        setUserWithRole(sessionData.user)
      } catch {
        navigate('/auth/login')
      } finally {
        setIsLoading(false)
      }
    }
    loadSession()
  }, [navigate])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
          role="status"
          aria-label="Loading"
        />
      </div>
    )
  }

  if (!userWithRole) return null

  return (
    <InjectionProvider>
      <DashboardShell user={userWithRole}>{children}</DashboardShell>
    </InjectionProvider>
  )
}
