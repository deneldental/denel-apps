import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { createFixedAsset } from '@/lib/actions/fixed-assets'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { inputToCents } from '@/shared/utils/currency'

interface CreateAssetSheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
  onCreated?: () => void
}

const today = () => new Date().toISOString().slice(0, 10)

export function CreateAssetSheet({
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  trigger,
  onCreated,
}: CreateAssetSheetProps) {
  const isControlled = controlledOpen !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? controlledOpen : internalOpen

  const { isSubmitting, submit } = useSubmitGuard()

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [acquisitionCost, setAcquisitionCost] = useState('')
  const [acquisitionDate, setAcquisitionDate] = useState(today())
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('')
  const [salvageValue, setSalvageValue] = useState('')

  const isDirty =
    name !== '' ||
    category !== '' ||
    acquisitionCost !== '' ||
    usefulLifeMonths !== '' ||
    salvageValue !== ''

  function resetForm() {
    setName('')
    setCategory('')
    setAcquisitionCost('')
    setAcquisitionDate(today())
    setUsefulLifeMonths('')
    setSalvageValue('')
  }

  function closeAndReset() {
    if (isControlled) setControlledOpen?.(false)
    else setInternalOpen(false)
    resetForm()
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: closeAndReset,
  })

  const setOpen = (next: boolean) => {
    if (next) {
      if (isControlled) setControlledOpen?.(true)
      else setInternalOpen(true)
    } else {
      guardedOnOpenChange(false)
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const cost = inputToCents(acquisitionCost)
    const months = Number(usefulLifeMonths)
    const salvage = salvageValue === '' ? 0 : inputToCents(salvageValue)

    if (!name.trim()) return toast.error('Please enter an asset name')
    if (cost <= 0) return toast.error('Enter a valid acquisition cost')
    if (!acquisitionDate) return toast.error('Please pick an acquisition date')
    if (!Number.isInteger(months) || months <= 0)
      return toast.error('Useful life must be a positive whole number of months')
    if (salvage < 0) return toast.error('Salvage value cannot be negative')
    if (salvage > cost) return toast.error('Salvage value cannot exceed the acquisition cost')

    void submit(async () => {
      const res = await createFixedAsset({
        name: name.trim(),
        category: category.trim() || null,
        acquisitionCost: cost,
        acquisitionDate,
        usefulLifeMonths: months,
        salvageValue: salvage,
      })
      if (!res.success) {
        surfaceApiError(res, 'Failed to create asset')
        return
      }
      toast.success('Fixed asset created.')
      closeAndReset()
      onCreated?.()
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent className="!w-full !max-w-[480px] overflow-y-auto">
        <form onSubmit={onSubmit}>
          <SheetHeader className="mb-6">
            <SheetTitle>New fixed asset</SheetTitle>
            <SheetDescription>
              Capitalize an asset and define its straight-line depreciation. After creating it,
              generate the schedule and post each period to the GL.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 pb-6">
            <div className="space-y-1.5">
              <Label htmlFor="asset-name">Name</Label>
              <Input
                id="asset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dental Chair Unit 3"
                maxLength={200}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="asset-category">Category (optional)</Label>
              <Input
                id="asset-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Equipment"
                maxLength={100}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="asset-cost">Acquisition cost (GHS)</Label>
                <Input
                  id="asset-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={acquisitionCost}
                  onChange={(e) => setAcquisitionCost(e.target.value)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault()
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asset-date">Acquisition date</Label>
                <Input
                  id="asset-date"
                  type="date"
                  value={acquisitionDate}
                  onChange={(e) => setAcquisitionDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="asset-life">Useful life (months)</Label>
                <Input
                  id="asset-life"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 60"
                  value={usefulLifeMonths}
                  onChange={(e) => setUsefulLifeMonths(e.target.value)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault()
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asset-salvage">Salvage value (GHS)</Label>
                <Input
                  id="asset-salvage"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={salvageValue}
                  onChange={(e) => setSalvageValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault()
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Depreciation uses the straight-line method: (cost − salvage) spread evenly across the
              useful life, with the final month absorbing any rounding remainder.
            </p>
          </div>

          <SheetFooter>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create asset
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </Sheet>
  )
}
