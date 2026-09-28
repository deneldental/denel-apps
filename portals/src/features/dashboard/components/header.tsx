import { Lock, Menu, Search } from 'lucide-react'
import { useState } from 'react'
import { MobileNav } from '@/features/dashboard/components/mobile-nav'
import { lockKiosk } from '@/lib/actions/kiosk'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet'
import { UserMenu, type UserMenuUser } from '@/shared/components/user-menu'

export function Header({
  user,
  toggleSidebar,
}: {
  user: UserMenuUser | null
  toggleSidebar: () => void
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // sessionStorage is synchronous, so this reads correctly on first render —
  // no effect needed, and `handleLockStation` full-page-navigates away
  // whenever it changes, so there's nothing to resync later.
  const [isKioskMode] = useState(() => sessionStorage.getItem('kiosk_mode') === 'true')

  const handleLockStation = async () => {
    try {
      await lockKiosk()
    } catch {}
    sessionStorage.removeItem('kiosk_mode')
    sessionStorage.removeItem('kiosk_operator')
    window.location.href = '/kiosk'
  }

  return (
    <header className="flex h-14 items-center gap-4 border-b border-b-gray-200/60 dark:border-b-gray-700/40 bg-background px-6 lg:h-[60px]">
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetTrigger asChild>
          <Button
            className="shrink-0 lg:hidden"
            size="icon"
            variant="outline"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[85%] max-w-xs overflow-y-auto p-4">
          <SheetHeader>
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          </SheetHeader>
          <MobileNav onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="w-full flex-1 flex items-center gap-4">
        <Button
          className="hidden lg:flex"
          size="icon"
          variant="outline"
          onClick={toggleSidebar}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle sidebar</span>
        </Button>
        <form className="flex-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
            <Input
              className="w-full bg-background shadow-none appearance-none pl-8 md:w-2/3 lg:w-1/3 "
              placeholder="Search..."
              type="search"
            />
          </div>
        </form>
      </div>
      {isKioskMode && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleLockStation}
          className="shrink-0 rounded-lg border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 gap-1.5 font-medium"
        >
          <Lock className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Lock Station</span>
        </Button>
      )}
      <UserMenu user={user} className="shrink-0" />
    </header>
  )
}
