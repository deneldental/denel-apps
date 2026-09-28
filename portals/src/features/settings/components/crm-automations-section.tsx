import {
  type CrmAutomationPolicies,
  DEFAULT_CRM_POLICIES,
  normalizeCrmPolicies,
} from '@denel/utils'
import { Bell, Cake, Clock, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { SettingsLoadError } from '@/features/settings/components/settings-load-error'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'
import { useKvSetting } from '@/shared/hooks/use-kv-setting'

const KV_CRM_KEY = 'crm:automation_policies'
const COOLDOWN_KEY = 'reminder_payment_cooldown_hours'

/**
 * Settings → CRM → Automations. Every field is read somewhere
 * (settings-domain-audit S5-B): the two reminder switches + template become
 * global-default stages in Scheduling → Appointment Reminders (synced by the
 * backend on save); birthday fields drive the daily CRM auto-queue; recall
 * months are the presets in CRM → Recare; quiet hours hold queued sends in
 * the scheduler; the cooldown is read by the payment-reminder route.
 */
export function CrmAutomationsSection() {
  const crmSetting = useKvSetting<CrmAutomationPolicies>(KV_CRM_KEY, DEFAULT_CRM_POLICIES, {
    fromStored: normalizeCrmPolicies,
  })
  // This form stores the cooldown as a numeric string; the registry accepts a
  // number too, so whatever is stored is shown as text.
  const cooldownSetting = useKvSetting<string>(COOLDOWN_KEY, '24', {
    fromStored: (stored) => (stored == null ? '24' : String(stored)),
  })
  const { value: policies, setValue: setPolicies } = crmSetting
  const { value: cooldownHours, setValue: setCooldownHours } = cooldownSetting
  const loading = crmSetting.loading || cooldownSetting.loading
  const loadError = crmSetting.loadError ?? cooldownSetting.loadError
  // One key failing to load blocks the whole save — saving would write that
  // key's defaults over its stored value.
  const canSave = crmSetting.canSave && cooldownSetting.canSave
  const saving = crmSetting.saving || cooldownSetting.saving
  const refetch = () => {
    crmSetting.refetch()
    cooldownSetting.refetch()
  }

  async function handleSave() {
    try {
      await Promise.all([crmSetting.save(), cooldownSetting.save(String(cooldownHours))])
      toast.success('CRM communication policies saved')
    } catch {
      toast.error('Failed to save CRM policies')
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <SettingsLoadError error={loadError} onRetry={refetch} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Quick Appointment Reminders (SMS)
          </CardTitle>
          <CardDescription>
            Each switch keeps a global-default reminder stage in Scheduling → Appointment Reminders
            (24 h or 2 h before, using the template below). Stages configured there for a specific
            appointment type take precedence; a global stage set up there with its own template is
            left alone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="flex items-center justify-between sm:justify-start gap-3 rounded-lg border p-3 flex-1">
              <div>
                <div className="text-sm font-medium">24 Hours Prior</div>
                <div className="text-xs text-muted-foreground">Global stage, 24 h before</div>
              </div>
              <Switch
                checked={policies.reminder24h}
                onCheckedChange={(checked) => setPolicies({ ...policies, reminder24h: checked })}
                disabled={loading}
              />
            </div>

            <div className="flex items-center justify-between sm:justify-start gap-3 rounded-lg border p-3 flex-1">
              <div>
                <div className="text-sm font-medium">2 Hours Prior</div>
                <div className="text-xs text-muted-foreground">Global stage, 2 h before</div>
              </div>
              <Switch
                checked={policies.reminder2h}
                onCheckedChange={(checked) => setPolicies({ ...policies, reminder2h: checked })}
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="reminder-template">Reminder Message Template</Label>
              <span className="text-[11px] text-muted-foreground">
                Tags: <code>{'{patientName}'}</code>, <code>{'{appointmentDate}'}</code>,{' '}
                <code>{'{appointmentTime}'}</code>
              </span>
            </div>
            <Textarea
              id="reminder-template"
              rows={3}
              value={policies.reminderTemplate}
              onChange={(e) => setPolicies({ ...policies, reminderTemplate: e.target.value })}
              disabled={loading}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cake className="h-5 w-5 text-primary" />
            Birthday Greetings Automation
          </CardTitle>
          <CardDescription>
            Each morning the CRM queue lists today's birthdays for staff confirmation; a confirmed
            greeting goes out at the dispatch time below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Queue Birthday SMS</div>
              <div className="text-xs text-muted-foreground">
                Off means birthdays are never queued.
              </div>
            </div>
            <Switch
              checked={policies.birthdayGreetings}
              onCheckedChange={(checked) =>
                setPolicies({ ...policies, birthdayGreetings: checked })
              }
              disabled={loading}
            />
          </div>

          {policies.birthdayGreetings && (
            <div className="space-y-4">
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="birthday-time">Dispatch Time</Label>
                <Input
                  id="birthday-time"
                  type="time"
                  value={policies.birthdaySendTime}
                  onChange={(e) => setPolicies({ ...policies, birthdaySendTime: e.target.value })}
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  Sends already confirmed by then go out at this time; later confirmations go out on
                  the next run.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="birthday-template">Greeting Template</Label>
                  <span className="text-[11px] text-muted-foreground">
                    Tags: <code>{'{firstName}'}</code>, <code>{'{patientName}'}</code>,{' '}
                    <code>{'{clinicName}'}</code>
                  </span>
                </div>
                <Textarea
                  id="birthday-template"
                  rows={2}
                  value={policies.birthdayTemplate}
                  onChange={(e) => setPolicies({ ...policies, birthdayTemplate: e.target.value })}
                  disabled={loading}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Recall & Recare Presets
          </CardTitle>
          <CardDescription>
            Offered as presets when a recare plan is created in CRM → Recare (routine checkup is the
            default). Each plan's interval stays editable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Routine Dental Checkup</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={policies.recallCheckupMonths}
                  onChange={(e) =>
                    setPolicies({ ...policies, recallCheckupMonths: Number(e.target.value) || 6 })
                  }
                  disabled={loading}
                />
                <span className="text-xs text-muted-foreground shrink-0">months</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Scaling & Polishing</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={policies.recallScalingMonths}
                  onChange={(e) =>
                    setPolicies({ ...policies, recallScalingMonths: Number(e.target.value) || 6 })
                  }
                  disabled={loading}
                />
                <span className="text-xs text-muted-foreground shrink-0">months</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Perio Maintenance</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={policies.recallPerioMonths}
                  onChange={(e) =>
                    setPolicies({ ...policies, recallPerioMonths: Number(e.target.value) || 3 })
                  }
                  disabled={loading}
                />
                <span className="text-xs text-muted-foreground shrink-0">months</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Messaging Guardrails & Quiet Hours
          </CardTitle>
          <CardDescription>
            The cooldown is enforced by the payment-reminder route. Quiet hours hold every queued
            send (birthday, follow-up, recare, custom) until the first scheduler run after the
            window; appointment reminders are never held.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cooldown-hours">Payment Reminder Cooldown (Hours)</Label>
              <Input
                id="cooldown-hours"
                type="number"
                min={1}
                value={cooldownHours}
                onChange={(e) => setCooldownHours(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Minimum wait between payment reminder SMS to the same patient.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="quiet-hours-enabled">Quiet Hours for Queued Sends</Label>
                <Switch
                  id="quiet-hours-enabled"
                  checked={policies.quietHoursEnabled}
                  onCheckedChange={(checked) =>
                    setPolicies({ ...policies, quietHoursEnabled: checked })
                  }
                  disabled={loading}
                />
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  aria-label="Quiet hours start"
                  value={policies.quietHoursStart}
                  onChange={(e) => setPolicies({ ...policies, quietHoursStart: e.target.value })}
                  disabled={loading || !policies.quietHoursEnabled}
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="time"
                  aria-label="Quiet hours end"
                  value={policies.quietHoursEnd}
                  onChange={(e) => setPolicies({ ...policies, quietHoursEnd: e.target.value })}
                  disabled={loading || !policies.quietHoursEnabled}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                An overnight window (e.g. 20:00 to 08:00) wraps midnight.
              </p>
            </div>
          </div>

          <div className="pt-2">
            <Button onClick={handleSave} disabled={!canSave || saving}>
              {saving ? 'Saving changes…' : 'Save CRM policies'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
