import { PlusCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CreateYearDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          Create New Year
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Year</DialogTitle>
          <DialogDescription>Add a new fiscal year to track expenses.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="year" className="text-right">
              Year
            </Label>
            <Input id="year" placeholder="2026" className="col-span-3" />
          </div>
          <div className="grid gap-2">
            <Label>Active Months</Label>
            <p className="text-sm text-muted-foreground">
              (Implementation for selecting months would go here)
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="submit">Create Year</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
