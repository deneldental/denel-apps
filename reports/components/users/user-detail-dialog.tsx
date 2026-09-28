import { format } from 'date-fns'
import { Ban, Calendar, CheckCircle2, Mail, Phone, Shield, XCircle } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import type { User as UserType } from '@/src/pages/users/columns'

interface UserDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: UserType | null
}

export function UserDetailDialog({ open, onOpenChange, user }: UserDetailDialogProps) {
  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
          <DialogDescription>View complete user information</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* User Avatar and Name */}
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              {user.image ? (
                <AvatarImage src={user.image} alt={user.name} />
              ) : (
                <AvatarFallback className="text-lg">
                  {user.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              )}
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-semibold">{user.name}</h3>
                {user.banned && (
                  <Badge variant="destructive" className="gap-1">
                    <Ban className="h-3 w-3" />
                    Banned
                  </Badge>
                )}
                {user.emailVerified && (
                  <Badge variant="outline" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Verified
                  </Badge>
                )}
              </div>
              {user.role && (
                <Badge variant="secondary" className="capitalize">
                  {user.role.name}
                </Badge>
              )}
            </div>
          </div>

          <Separator />

          {/* Contact Information */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-xs text-muted-foreground">Email</div>
                <div className="text-sm font-medium">{user.email}</div>
                {!user.emailVerified && (
                  <div className="text-xs text-orange-600 flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    Email not verified
                  </div>
                )}
              </div>
            </div>

            {user.phone && (
              <div className="flex items-start gap-3">
                <Phone className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="text-xs text-muted-foreground">Phone</div>
                  <div className="text-sm font-medium">{user.phone}</div>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Role Information */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-xs text-muted-foreground">Role</div>
                <div className="text-sm font-medium capitalize">
                  {user.role?.name || 'No Role Assigned'}
                </div>
                {user.roleId && (
                  <div className="text-xs text-muted-foreground">Role ID: {user.roleId}</div>
                )}
              </div>
            </div>
          </div>

          {/* Ban Information */}
          {user.banned && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Ban className="h-5 w-5 text-destructive mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <div className="text-xs text-muted-foreground">Ban Status</div>
                    <div className="text-sm font-medium text-destructive">User is banned</div>
                    {user.banReason && (
                      <div className="text-xs text-muted-foreground">Reason: {user.banReason}</div>
                    )}
                    {user.banExpires && (
                      <div className="text-xs text-muted-foreground">
                        Expires: {format(new Date(user.banExpires), 'PPp')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Timestamps */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-xs text-muted-foreground">Account Created</div>
                <div className="text-sm font-medium">{format(new Date(user.createdAt), 'PPp')}</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-xs text-muted-foreground">Last Updated</div>
                <div className="text-sm font-medium">{format(new Date(user.updatedAt), 'PPp')}</div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
