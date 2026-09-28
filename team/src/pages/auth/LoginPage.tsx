import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LoginForm } from '@/components/auth/login-form'
import { useAuth } from '@/lib/auth'
import { BrandLoader } from '@/shared/components/BrandLoader'
import { getHomeForRole } from '@/shared/lib/role-routing'

export default function LoginPage() {
  const { user, loading: staffLoading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    // Prefer roleId (our RBAC slug — 'doctor', 'lab_technician', ...) over
    // user.role (Better Auth admin plugin which is just 'admin' / 'user' /
    // 'external_trainer'). Without the fallback, every non-admin staff
    // would hit getHomeForRole('user') → default → '/login' → infinite loop.
    if (!staffLoading && user) {
      navigate(getHomeForRole(user.roleId ?? user.role), { replace: true })
    }
  }, [user, staffLoading, navigate])

  if (staffLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <BrandLoader />
      </div>
    )
  }

  // The shared auth shell is full-screen (background + brand scrim + card).
  return <LoginForm />
}
