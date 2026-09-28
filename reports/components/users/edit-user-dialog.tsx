import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { getRoles, updateUser } from '@/lib/actions/users'
import type { User } from '@/src/pages/users/columns'

interface EditUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: User | null
}

export function EditUserDialog({ open, onOpenChange, user }: EditUserDialogProps) {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  interface Role {
    id: string
    name: string
  }
  const [rolesList, setRolesList] = useState<Role[]>([])
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    roleId: '',
    password: '',
  })

  useEffect(() => {
    if (open && user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        name: user.name || '',
        phone: user.phone || '',
        roleId: user.roleId || '',
        password: '',
      })

      getRoles().then((res) => {
        if (res.success) setRolesList(res.data || [])
      })
    }
  }, [open, user])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    setIsLoading(true)

    const result = await updateUser(user.id, formData)

    setIsLoading(false)

    if (result.success) {
      onOpenChange(false)
      toast.success('User updated successfully')
      navigate(0)
    } else {
      toast.error(result.error || 'Failed to update user')
    }
  }

  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user information. Email cannot be changed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Full Name</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                required
                placeholder="Enter full name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" value={user.email} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">Email cannot be changed</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="Enter phone number"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-roleId">Role</Label>
              <Select
                value={formData.roleId}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, roleId: value }))}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {rolesList.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Change Password (Optional)</h4>
              <p className="text-xs text-muted-foreground">Leave blank to keep current password</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-password">New Password</Label>
              <PasswordInput
                id="edit-password"
                value={formData.password}
                onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="Enter new password"
              />
              <p className="text-xs text-muted-foreground">
                Enter a new password to override the old one
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update User
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
