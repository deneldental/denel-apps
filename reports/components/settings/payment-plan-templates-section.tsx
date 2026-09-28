import { formatCurrency } from '@denel/utils'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PaymentPlanTemplateDialog } from '@/components/settings/payment-plan-template-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmationDialog } from '@/components/ui/delete-confirmation-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  deletePaymentPlanTemplate,
  getPaymentPlanTemplates,
} from '@/lib/actions/payment-plan-templates'
import type { paymentPlanTemplates } from '@/lib/db/schema'

type PaymentPlanTemplate = typeof paymentPlanTemplates.$inferSelect

export function PaymentPlanTemplatesSection() {
  const [templates, setTemplates] = useState<PaymentPlanTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PaymentPlanTemplate | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [templateToDelete, setTemplateToDelete] = useState<PaymentPlanTemplate | null>(null)

  const loadTemplates = async () => {
    setIsLoading(true)
    const result = await getPaymentPlanTemplates()
    if ('success' in result && result.data) {
      setTemplates(result.data)
    } else {
      toast.error((result as { error?: string }).error || 'Failed to load payment plan templates')
    }
    setIsLoading(false)
  }

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const result = await getPaymentPlanTemplates()
      if (mounted) {
        if ('success' in result && result.data) {
          setTemplates(result.data)
        } else {
          toast.error(
            (result as { error?: string }).error || 'Failed to load payment plan templates'
          )
        }
        setIsLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const handleDelete = async () => {
    if (!templateToDelete) return

    const result = await deletePaymentPlanTemplate(templateToDelete.id)
    if (result.success) {
      toast.success('Payment plan template deleted successfully')
      loadTemplates()
      setDeleteDialogOpen(false)
      setTemplateToDelete(null)
    } else {
      toast.error(result.error || 'Failed to delete payment plan template')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Payment Plan Templates</CardTitle>
            <CardDescription>
              Create and manage payment plan templates. Set a default template to be used for new
              ortho patients.
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              setEditingTemplate(null)
              setShowDialog(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Template
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading templates...</p>
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No payment plan templates found.</p>
            <Button
              onClick={() => {
                setEditingTemplate(null)
                setShowDialog(true)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Template
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Total Amount</TableHead>
                <TableHead>Amount per Installment</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Default</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>{formatCurrency(template.totalAmount)}</TableCell>
                  <TableCell>{formatCurrency(template.amountPerInstallment)}</TableCell>
                  <TableCell className="capitalize">{template.paymentFrequency}</TableCell>
                  <TableCell>
                    <Badge variant={template.isActive ? 'default' : 'secondary'}>
                      {template.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {template.isDefault && (
                      <Badge variant="outline" className="gap-1">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        Default
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingTemplate(template)
                          setShowDialog(true)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setTemplateToDelete(template)
                          setDeleteDialogOpen(true)
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <PaymentPlanTemplateDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        template={editingTemplate}
        onSuccess={loadTemplates}
      />

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="Delete Payment Plan Template"
        description="Are you sure you want to delete this payment plan template? This action cannot be undone."
        itemName={templateToDelete?.name}
      />
    </Card>
  )
}
