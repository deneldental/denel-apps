import { Loader2, LogOut, Menu, Search, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { authClient } from '@/lib/auth-client'
import { NAV_ITEMS } from '@/lib/menu'
import { useInjection } from '@/src/contexts/injection-context'

interface User {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
  roleId?: string | null
  role?: {
    name: string
  } | null
}

export function Header({ user, toggleSidebar }: { user: User | null; toggleSidebar: () => void }) {
  const { pathname } = useLocation()
  const _navigate = useNavigate()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const { isEnabled, isLoading: injectionLoading } = useInjection()

  // Extract first name from user name
  const firstName = user?.name ? user.name.split(' ')[0] : 'User'
  const fullName = user?.name || 'User'
  const roleName = user?.role?.name || 'No Role'

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true)
      toast.loading('Logging out...', { id: 'logout' })

      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            toast.success('Logged out successfully', { id: 'logout' })
            // navigate(0) // Refresh to clear any cached data
            // navigate('/auth/login') // redirect to login page
            // Use window.location.href to force a hard reload and clear all client-side state/cache
            // This also prevents race conditions with Next.js router where RSC payloads might be displayed as text
            window.location.href = '/auth/login'
          },
          onError: (error) => {
            console.error('Logout error:', error)
            toast.error('Failed to logout. Please try again.', { id: 'logout' })
            setIsLoggingOut(false)
          },
        },
      })
    } catch (error) {
      console.error('Logout error:', error)
      toast.error('An error occurred during logout', { id: 'logout' })
      setIsLoggingOut(false)
    }
  }

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-gray-100/40 px-6 lg:h-[60px] dark:bg-gray-800/40">
      <Sheet>
        <SheetTrigger asChild>
          <Button className="shrink-0 lg:hidden" size="icon" variant="outline">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          </SheetHeader>
          <nav className="grid gap-2 text-lg font-medium">
            <Link className="flex items-center gap-2 text-lg font-semibold mb-4" to="#">
              <Wallet className="h-6 w-6" />
              <span>Denel</span>
            </Link>
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
              const enabled = isEnabled(item.section)
              return (
                <Link
                  key={item.section}
                  to={item.href}
                  className={[
                    'mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground',
                    isActive ? 'bg-muted text-foreground' : '',
                    !injectionLoading && !enabled ? 'opacity-50' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </SheetContent>
      </Sheet>
      <div className="w-full flex-1 flex items-center gap-4">
        <Button className="hidden lg:flex" size="icon" variant="outline" onClick={toggleSidebar}>
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle sidebar</span>
        </Button>
        <form className="flex-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
            <Input
              className="w-full bg-white shadow-none appearance-none pl-8 md:w-2/3 lg:w-1/3 dark:bg-gray-950"
              placeholder="Search..."
              type="search"
            />
          </div>
        </form>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="rounded-full flex items-center gap-2 px-3" variant="secondary">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.image || undefined} alt={fullName} />
              <AvatarFallback>
                {fullName
                  .split(' ')
                  .map((n: string) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden md:block text-sm font-medium">{firstName}</span>
            <span className="sr-only">Toggle user menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col">
            <span className="font-semibold">{fullName}</span>
            <span className="text-xs text-muted-foreground font-normal">{roleName}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="cursor-pointer"
          >
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
    </header>
  )
}
