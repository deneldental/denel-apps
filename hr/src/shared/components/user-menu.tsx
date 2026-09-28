import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@denel/ui'
import { cn } from '@denel/utils'
import { ChevronDown, Loader2, LogOut } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '@/lib/auth'
import { useAuth } from '@/lib/auth'
import { resetHrScopeAccess } from '@/lib/hr-scope-check'

/** "external_trainer" → "External Trainer" */
function formatRoleLabel(raw: string | null | undefined): string {
  if (!raw) return 'No role'
  return raw
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/**
 * Current-user identity chip: avatar + name over role + dropdown caret.
 *
 * The name/role stack collapses below `md` so the trigger stays a compact
 * avatar + caret on narrow screens.
 */
export function UserMenu({ user, className }: { user: User | null; className?: string }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const fullName = user?.name || 'User'
  const roleName = formatRoleLabel(user?.roleId || user?.role)

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      resetHrScopeAccess()
      await signOut()
      navigate('/auth/login', { replace: true })
    } finally {
      setIsLoggingOut(false)
    }
  }

  // Session still loading — keep the trigger's footprint so the header doesn't jump
  if (!user) {
    return (
      <div className={cn('flex items-center gap-2.5 px-2 py-1.5', className)}>
        <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="hidden md:flex flex-col gap-1.5">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
            'hover:bg-gray-100 dark:hover:bg-gray-800',
            'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'data-[state=open]:bg-gray-100 dark:data-[state=open]:bg-gray-800',
            className
          )}
        >
          <Avatar className="h-9 w-9 ring-1 ring-gray-200 dark:ring-gray-700">
            <AvatarImage src={user.image || undefined} alt={fullName} />
            <AvatarFallback className="text-xs font-medium">{initialsOf(fullName)}</AvatarFallback>
          </Avatar>

          <div className="hidden md:flex min-w-0 flex-col">
            <span className="truncate max-w-40 text-sm font-semibold leading-tight">
              {fullName}
            </span>
            <span className="truncate max-w-40 text-xs leading-tight text-muted-foreground">
              {roleName}
            </span>
          </div>

          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          <span className="sr-only">Toggle user menu</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar className="h-9 w-9 ring-1 ring-gray-200 dark:ring-gray-700">
            <AvatarImage src={user.image || undefined} alt={fullName} />
            <AvatarFallback className="text-xs font-medium">{initialsOf(fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex flex-col">
            <span className="truncate text-sm font-semibold leading-tight">{fullName}</span>
            <span className="truncate text-xs leading-tight text-muted-foreground">{roleName}</span>
            {user.email && (
              <span className="truncate text-xs leading-tight text-muted-foreground">
                {user.email}
              </span>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} disabled={isLoggingOut} className="cursor-pointer">
          {isLoggingOut ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Logging out...
            </>
          ) : (
            <>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
