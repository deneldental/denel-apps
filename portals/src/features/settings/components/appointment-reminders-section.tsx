import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  getAppointmentTypeReminders,
  updateAppointmentTypeReminders,
} from '@/lib/actions/appointment-type-reminders'
import { api } from '@/lib/api-client'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'
import { useLookup } from '@/shared/hooks/use-lookup'

type ReminderTemplate = { id: string; name: string; content: string }
type ReminderRule = {
  triggerType: 'on_booking' | 'before_appointment'
  offsetHours: number | null
  templateId: string
  isActive: boolean
  template?: ReminderTemplate
}

export function AppointmentRemindersSection() {
  const { rows: types } = useLookup('appointment-types', { includeInactive: true })
  const [selectedTypeId, setSelectedTypeId] = useState<string>('default')

  // Rule Dialog
  const [showRuleDialog, setShowRuleDialog] = useState(false)
  const [editingRuleIndex, setEditingRuleIndex] = useState<number | null>(null)
  const [ruleForm, setRuleForm] = useState<{
    triggerType: 'on_booking' | 'before_appointment'
    offsetHours: string
    templateId: string
  }>({
    triggerType: 'before_appointment',
    offsetHours: '24',
    templateId: '',
  })

  // Template Preview/Edit Dialog
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ReminderTemplate | null>(null)
  const [templateForm, setTemplateForm] = useState({ name: '', content: '' })

  const remindersKey = (typeId: string) => ['appointment-type-reminders', typeId] as const

  const templatesQuery = useApiQuery<ReminderTemplate[]>(queryKeys.reminderTemplates.list(), () =>
    api.get<ReminderTemplate[]>('/api/reminder-templates')
  )
  const templates = templatesQuery.data ?? []

  const rulesQuery = useApiQuery<ReminderRule[]>(remindersKey(selectedTypeId), () =>
    getAppointmentTypeReminders(selectedTypeId)
  )
  const rules = rulesQuery.data ?? []
  const isLoading = rulesQuery.isLoading

  const updateRemindersMutation = useApiMutation(
    (reminders: ReminderRule[]) => updateAppointmentTypeReminders(selectedTypeId, { reminders }),
    { invalidates: [remindersKey(selectedTypeId)] }
  )
  const updateTemplateMutation = useApiMutation(
    (vars: { id: string; data: { name: string; content: string } }) =>
      api.patch<any>(`/api/reminder-templates/${vars.id}`, vars.data),
    { invalidates: [queryKeys.reminderTemplates.list(), remindersKey(selectedTypeId)] }
  )

  const handleSaveRules = async (updatedRules: ReminderRule[]) => {
    try {
      await updateRemindersMutation.mutateAsync(updatedRules)
      toast.success('Reminders updated successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update reminders')
    }
  }

  const openAddRule = () => {
    setRuleForm({
      triggerType: 'before_appointment',
      offsetHours: '24',
      templateId: templates[0]?.id || '',
    })
    setEditingRuleIndex(null)
    setShowRuleDialog(true)
  }

  const openEditRule = (index: number) => {
    const r = rules[index]
    setRuleForm({
      triggerType: r.triggerType,
      offsetHours: r.offsetHours?.toString() || '0',
      templateId: r.templateId,
    })
    setEditingRuleIndex(index)
    setShowRuleDialog(true)
  }

  const saveRuleDialog = () => {
    if (!ruleForm.templateId) {
      toast.error('Please select an SMS template')
      return
    }

    const newRule: ReminderRule = {
      triggerType: ruleForm.triggerType,
      offsetHours:
        ruleForm.triggerType === 'before_appointment' ? parseInt(ruleForm.offsetHours, 10) : null,
      templateId: ruleForm.templateId,
      isActive: true,
    }

    const nextRules = [...rules]
    if (editingRuleIndex !== null) {
      nextRules[editingRuleIndex] = newRule
    } else {
      nextRules.push(newRule)
    }

    setShowRuleDialog(false)
    handleSaveRules(nextRules)
  }

  const deleteRule = (index: number) => {
    const nextRules = rules.filter((_, i) => i !== index)
    handleSaveRules(nextRules)
  }

  // Quick edit template feature
  const openEditTemplate = (template: ReminderTemplate) => {
    setEditingTemplate(template)
    setTemplateForm({ name: template.name, content: template.content })
    setShowTemplateDialog(true)
  }

  const saveTemplateDialog = async () => {
    if (!editingTemplate) return
    try {
      await updateTemplateMutation.mutateAsync({ id: editingTemplate.id, data: templateForm })
      toast.success('Template updated')
      setShowTemplateDialog(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'An error occurred saving the template')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-slate-900">Appointment Reminders</h3>
        <p className="text-sm text-slate-500">
          Configure automated SMS reminders for specific appointment types.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-[300px]">
          <Label className="mb-2 block">Appointment Type</Label>
          <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
            <SelectTrigger>
              <SelectValue placeholder="Select type..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default" className="font-medium">
                Default Policies (All Types)
              </SelectItem>
              {types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.displayName || t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Reminder Stages</CardTitle>
            <CardDescription>
              {selectedTypeId === 'default'
                ? 'These rules apply to any appointment type that has no specific overrides.'
                : 'These rules override the default policies for this specific appointment type.'}
            </CardDescription>
          </div>
          <Button onClick={openAddRule} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Stage
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-slate-500">Loading...</div>
          ) : rules.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              No reminder stages configured.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Interval</TableHead>
                  <TableHead>SMS Template</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Badge variant="outline">
                        {rule.triggerType === 'on_booking' ? 'On Booking' : 'Before Appointment'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {rule.triggerType === 'before_appointment'
                        ? `${rule.offsetHours} hours before`
                        : 'Immediate'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {rule.template?.name || 'Unknown Template'}
                        </span>
                        {rule.template && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => openEditTemplate(rule.template!)}
                            title="Edit Template text"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEditRule(idx)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => deleteRule(idx)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Rule Dialog */}
      <Dialog open={showRuleDialog} onOpenChange={setShowRuleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRuleIndex !== null ? 'Edit' : 'Add'} Reminder Stage</DialogTitle>
            <DialogDescription>
              Configure when to send this reminder and what template to use.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Trigger Type</Label>
              <Select
                value={ruleForm.triggerType}
                onValueChange={(val: any) => setRuleForm({ ...ruleForm, triggerType: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on_booking">On Booking (Immediate)</SelectItem>
                  <SelectItem value="before_appointment">Before Appointment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {ruleForm.triggerType === 'before_appointment' && (
              <div className="grid gap-2">
                <Label>Hours Before</Label>
                <Input
                  type="number"
                  min="1"
                  value={ruleForm.offsetHours}
                  onChange={(e) => setRuleForm({ ...ruleForm, offsetHours: e.target.value })}
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label>SMS Template</Label>
              <Select
                value={ruleForm.templateId}
                onValueChange={(val) => setRuleForm({ ...ruleForm, templateId: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRuleDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveRuleDialog}>Save Stage</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Template Inline Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit SMS Template</DialogTitle>
            <DialogDescription>
              Changes here will affect ALL reminders (across all appointment types) that use this
              template.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Template Name</Label>
              <Input
                value={templateForm.name}
                onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Message Content</Label>
              <Textarea
                className="h-32"
                value={templateForm.content}
                onChange={(e) => setTemplateForm({ ...templateForm, content: e.target.value })}
              />
              <p className="text-xs text-slate-500">
                Available placeholders: {'{Patientname}'}, {'{date}'}, {'{time}'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveTemplateDialog}>Save Template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
