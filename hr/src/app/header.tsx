import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@denel/ui'
import { Menu } from 'lucide-react'
import { useState } from 'react'
import type { User } from '@/lib/auth'
import { UserMenu } from '@/shared/components/user-menu'
import { MobileNav } from './mobile-nav'

export function Header({ user, toggleSidebar }: { user: User | null; toggleSidebar: () => void }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <header className="flex h-14 items-center gap-4 border-b border-b-gray-200/60 dark:border-b-gray-700/40 bg-white dark:bg-gray-950 px-6 lg:h-[60px]">
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

      <Button
        className="hidden lg:flex"
        size="icon"
        variant="outline"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle sidebar</span>
      </Button>

      <div className="flex-1" />

      <UserMenu user={user} className="shrink-0" />
    </header>
  )
}
