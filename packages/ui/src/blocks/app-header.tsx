import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar, AvatarFallback, AvatarImage } from '../avatar'

/**
 * AppHeader — the persistent top app bar: brand logo (left) + an optional
 * notifications bell (with unread badge) and a profile avatar (right). Batteries
 * included but data-driven — the consuming layout passes the logo, the unread
 * count + notifications route, and the avatar (name/image + profile route). Uses
 * react-router `Link` (peer dep) for the two destinations.
 */

function initials(name?: string): string {
  return (name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export interface AppHeaderProps {
  logoUrl: string
  logoAlt?: string
  notifications?: { count: number; to: string }
  avatar?: { name?: string; imageUrl?: string | null; to: string }
}

export function AppHeader({ logoUrl, logoAlt = '', notifications, avatar }: AppHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 bg-card px-6 py-3">
      <img src={logoUrl} alt={logoAlt} className="h-9 w-auto" />
      <div className="flex items-center gap-1">
        {notifications && (
          <Link
            to={notifications.to}
            aria-label={
              notifications.count > 0
                ? `Notifications (${notifications.count} new)`
                : 'Notifications'
            }
            className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Bell className="h-5 w-5" />
            {notifications.count > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
                {notifications.count > 9 ? '9+' : notifications.count}
              </span>
            )}
          </Link>
        )}
        {avatar && (
          <Link to={avatar.to} aria-label="Profile" className="rounded-full">
            <Avatar className="h-9 w-9">
              {avatar.imageUrl && <AvatarImage src={avatar.imageUrl} alt={avatar.name ?? ''} />}
              <AvatarFallback className="bg-brand/15 text-xs font-semibold text-brand">
                {initials(avatar.name)}
              </AvatarFallback>
            </Avatar>
          </Link>
        )}
      </div>
    </header>
  )
}
